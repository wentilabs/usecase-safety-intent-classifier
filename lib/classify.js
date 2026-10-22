"use strict";

/**
 * lib/classify.js — one model call: given the conversation slice, what is the intent?
 *
 * The model is forced to answer through one tool whose `intent` is an enum of the
 * composed intents, so it cannot invent one. Its answer is then checked for
 * consistency with any facts the caller supplied (lib/validate.js); a contradiction
 * becomes `other`, with the reason.
 *
 * Uses the OpenAI Responses API through Node's fetch — no SDK, no dependencies.
 * OPENAI_API_KEY is read from the environment; the model can be chosen per request.
 */

const { compose, qualify } = require("./compose");
const { buildInstructions } = require("./prompt");
const { buildConversation, toFeatures, renderConversation } = require("./conversation");
const { validateIntent } = require("./validate");
const { fillContext, fetchDeleted } = require("./context");
const { DOMAINS } = require("../domains");
const { mainPhoto } = require("./media");
const { seededShuffle, seedFor } = require("./order");

/** The model every evaluation of this service has used. Overridable per request (`model`). */
const DEFAULT_MODEL = "gpt-6-luna";

/** gpt-5 and later reject `temperature` and take reasoning effort instead. */
const modelParams = (model) => (/^gpt-([5-9]|\d{2,})/i.test(model) ? { model, reasoning: { effort: "none" } } : { model, temperature: 0 });

function classifyTool(intents, seed) {
  return {
    type: "function",
    name: "classify",
    description: "Record the one intent of the message.",
    parameters: {
      type: "object",
      properties: {
        // Shuffled too — including `other`, which would otherwise always sit last.
        intent: { type: "string", enum: seededShuffle(intents.map((i) => i.id), seed, "enum") },
        reason: { type: "string", description: "One sentence: what the sender means, and why that is this intent." },
        confidence: { type: "integer", minimum: 0, maximum: 100 },
      },
      required: ["intent", "reason", "confidence"],
      additionalProperties: false,
    },
  };
}

/**
 * The slice, read once and shared by every domain: context filled from the archive,
 * the main photo loaded, the conversation rendered.
 */
async function prepare(request, deps) {
  // Fill whatever the caller did not send from the chat archive (read-only).
  // `retrieve: false` classifies from exactly what was sent.
  const filled = request.retrieve === false ? { request, retrieved: [], missed: [] } : await fillContext(request, deps.archive || {});
  request = filled.request;
  const conversation = buildConversation(request);
  // The ONE image: the photo on the message being classified. Everything else is labelled.
  const photo = request.retrieve === false && !request.message?.photoDataUrl ? null : await mainPhoto(request.message, deps.archive || {});
  conversation.photoShown = Boolean(photo);
  return { request, filled, photo, rendered: renderConversation(conversation), features: toFeatures(conversation) };
}

/** One model call over the given domains, checked against the supplied facts. */
async function decide(names, prepared, deps) {
  const { request, photo, rendered, features } = prepared;
  const composed = compose(names, request.facts || {});
  const model = request.model || DEFAULT_MODEL;
  const apiKey = deps.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw Object.assign(new Error("OPENAI_API_KEY is not set"), { status: 500 });

  const seed = seedFor(request);
  const instructions = buildInstructions(composed, qualify, seed);
  const userContent = photo ? [{ type: "input_text", text: rendered }, { type: "input_image", image_url: photo }] : rendered;
  const ask = async (extra) => {
    const res = await (deps.fetchImpl || fetch)("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        ...modelParams(model),
        input: [{ role: "system", content: instructions }, { role: "user", content: userContent }, ...extra],
        tools: [classifyTool(composed.intents, seed)],
        tool_choice: { type: "function", name: "classify" },
        store: false,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw Object.assign(new Error(`model call failed: ${res.status} ${detail.slice(0, 300)}`), { status: 502 });
    }
    const data = await res.json();
    const call = (data.output || []).find((o) => o.type === "function_call" && o.name === "classify");
    if (!call) throw Object.assign(new Error("the model did not answer with the classify tool"), { status: 502 });
    return JSON.parse(call.arguments);
  };

  let args = await ask([]);
  let check = validateIntent(args.intent, features);
  let firstRefusal = null;
  if (!check.ok) {
    // Not a silent fallback: the model is told which supplied fact its answer contradicts,
    // and chooses again. Only a second contradiction becomes `other`.
    firstRefusal = { intent: args.intent, why: check.why };
    args = await ask([
      { role: "user", content: `Your answer "${firstRefusal.intent}" contradicts a known fact: ${check.why}. Choose again, consistent with the facts.` },
    ]);
    check = validateIntent(args.intent, features);
  }
  return {
    intent: check.ok ? args.intent : "other",
    reason: String(args.reason || ""),
    confidence: Number.isFinite(args.confidence) ? args.confidence : null,
    ...(check.ok ? {} : { refused: { intent: args.intent, why: check.why } }),
    ...(firstRefusal ? { reconsidered: firstRefusal } : {}),
  };
}

/**
 * Several domains are judged in two steps. First each domain alone, with its own `other`
 * — no domain's intents crowd another's. Then only the domains that did NOT answer
 * `other` are judged together. None left: `other`. One left: its answer stands.
 *
 * @param {{domains: string[], message: object, recent?: object[], quoted?: object, facts?: object, model?: string}} request
 * @param {{fetchImpl?: Function, apiKey?: string}} [deps]
 */
async function classifyLive(request, deps = {}) {
  const names = [...new Set(request.domains || ["safety"])];
  compose(names, request.facts || {}); // unknown domains fail before any work
  const prepared = await prepare(request, deps);
  const started = Date.now();

  let answer;
  let perDomain;
  if (names.length === 1) {
    answer = await decide(names, prepared, deps);
  } else {
    const firsts = await Promise.all(names.map((n) => decide([n], prepared, deps)));
    perDomain = Object.fromEntries(names.map((n, i) => [n, firsts[i]]));
    const remaining = names.filter((n, i) => firsts[i].intent !== "other");
    if (!remaining.length) answer = { ...firsts[0], reason: "No domain claims this message." };
    else if (remaining.length === 1) answer = perDomain[remaining[0]];
    else answer = await decide(remaining, prepared, deps);
  }

  return {
    ...answer,
    ...(perDomain ? { perDomain } : {}),
    model: request.model || DEFAULT_MODEL,
    ms: Date.now() - started,
    retrieved: prepared.filled.retrieved,
    ...(prepared.filled.missed.length ? { missed: prepared.filled.missed } : {}),
    photoShown: Boolean(prepared.photo),
    conversation: prepared.rendered,
  };
}

const isDeletion = (m) => m && (m.isDeleted === true || m.isDeletion === true);
const isEdit = (m) => m && (m.isEdited === true || m.isEdit === true);
const unqualified = (id) => String(id).replace(/^[a-z0-9_-]+\./, "");

/** The correction intent for an original's intent, qualified like the live ones. */
function corrected(kind, originalIntent, domains) {
  for (const name of domains) {
    const map = DOMAINS[name]?.corrections?.[kind] || {};
    const hit = map[unqualified(originalIntent)];
    if (hit) return `${name}.${hit}`;
  }
  return null;
}

/**
 * Classify a message. Edits and deletions take two passes: the ORIGINAL is rebuilt as
 * it was when sent and classified like any live message — its own text, photo, reply
 * and earlier messages — and its intent is mapped through the domain's `corrections`.
 * The model never chooses a correction intent directly.
 */
async function classify(request, deps = {}) {
  const m = request.message || {};
  const domains = request.domains || ["safety"];
  const live = (msg) =>
    classifyLive({ ...request, message: msg, recent: undefined, quoted: undefined, facts: request.facts || {} }, deps);

  if (isDeletion(m)) {
    const original =
      request.original ||
      (request.retrieve === false ? null : await fetchDeleted(m, deps.archive || {}));
    if (!original) {
      return { intent: "other", reason: "The deleted message could not be found, so what it did is unknown.", confidence: null, correction: "deletion", original: null };
    }
    const first = await live({ ...original, isDeleted: false, isDeletion: false });
    const intent = corrected("deletion", first.intent, domains) || "other";
    return {
      intent,
      reason: intent === "other" ? `The deleted message was "${first.intent}", which recorded nothing — nothing to undo.` : `The deleted message was "${first.intent}"; deleting it undoes that.`,
      confidence: first.confidence,
      correction: "deletion",
      original: { intent: first.intent, reason: first.reason, conversation: first.conversation },
      model: first.model,
      ms: first.ms,
    };
  }

  if (isEdit(m)) {
    const before = request.original || (m.previousBody ? { ...m, body: m.previousBody } : null);
    if (before) {
      const first = await live({ ...before, isEdited: false, isEdit: false });
      const intent = corrected("edit", first.intent, domains);
      if (intent) {
        return {
          intent,
          reason: `The edited message was "${first.intent}"; the edit corrects it.`,
          confidence: first.confidence,
          correction: "edit",
          original: { intent: first.intent, reason: first.reason, conversation: first.conversation },
          model: first.model,
          ms: first.ms,
        };
      }
    }
    // Nothing was recorded from the original (or it is unknown): read the edited text as new.
    const now = await live({ ...m, isEdited: false, isEdit: false });
    return { ...now, correction: "edit", original: before ? { intent: "(recorded nothing)" } : null };
  }

  return classifyLive(request, deps);
}

module.exports = { classify, classifyLive, DEFAULT_MODEL };
