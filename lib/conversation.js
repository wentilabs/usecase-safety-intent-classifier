"use strict";

/**
 * lib/conversation.js — the slice of conversation the model reads.
 *
 * The repo's one intention: with the message just sent, the two text messages before
 * it, and whatever it replies to, a model can tell what the sender intends. This file
 * turns the caller's payloads into exactly that slice, described plainly.
 *
 * It accepts listener payloads as the Woh Hup base template receives them (`body`,
 * `type`, `mediaFilename`, `isEdited`, `isDeleted`, `messageIdSerialized`, …) or
 * already-tidy messages (`text`, `kind`, `hasPhoto`, …). Nothing is fetched: what the
 * caller did not send is simply absent.
 */

const { recogniseSystemMessage } = require("../domains/safety/system-messages");

const KINDS = { chat: "text", text: "text", image: "photo", photo: "photo", video: "video", document: "document", audio: "voice", ptt: "voice", voice: "voice", sticker: "sticker" };

/** A reporter-stated P1/P2/P3; rejects P12, CP15, P1A (same boundaries as the base template). */
function statedSeverityOf(text) {
  const m = /(?:^|[^A-Za-z0-9])\(?\s*p\s*-?\s*([123])(?![0-9A-Za-z])/i.exec(text) ||
    /\b(?:severity|priority|sev|risk\s*level)\s*[:\-=]*\s*\(?\s*p?\s*-?\s*([123])(?![0-9A-Za-z])/i.exec(text);
  return m ? `P${m[1]}` : null;
}

/**
 * The listener writes the string "false" (or "") into quotedBody / quotedMessageId when a
 * message is NOT a reply — wa-mirror treats it the same way. Anything else is a real value.
 */
const present = (v) => v !== null && v !== undefined && v !== false && String(v).trim() !== "" && String(v).trim() !== "false";

/** The text of a message, whichever field it arrived in. */
const textOf = (m) => String(m?.text ?? m?.body ?? m?.caption ?? "").trim();

/**
 * One message, normalised.
 * @param {object|null} m A listener payload or a tidy message.
 * @returns {object|null}
 */
function toMessage(m) {
  if (!m || typeof m !== "object") return null;
  const kind = KINDS[String(m.kind || m.type || "chat").toLowerCase()] || String(m.kind || m.type);
  const fromThisSystem =
    typeof m.fromThisSystem === "boolean"
      ? m.fromThisSystem
      : m.messageIdSerialized
        ? String(m.messageIdSerialized).toLowerCase().startsWith("true_")
        : null;
  const text = textOf(m);
  // Our own message shapes count only when we sent them — anyone can type them.
  const system = fromThisSystem === true ? recogniseSystemMessage(text) : { kind: "message" };
  return {
    sender: m.sender || m.senderName || (fromThisSystem ? "Safety desk" : null),
    kind,
    text,
    hasPhoto: m.hasPhoto === true || (kind === "photo" && m.hasPhoto !== false && Boolean(m.mediaFilename || m.photoDataUrl || m.photo)),
    isPhoto: kind === "photo",
    isReply: Boolean(m.isReply === true || present(m.quotedMessageId) || present(m.quotedBody)),
    isEdit: m.isEdit === true || m.isEdited === true,
    isDeletion: m.isDeletion === true || m.isDeleted === true,
    fromThisSystem,
    systemMessage: system.kind,
    issueNumber: system.issueNumber || null,
    issueSeverity: system.severity || null,
    statedSeverity: statedSeverityOf(text),
    mentions: (text.match(/@\S+/g) || []).length,
    at: m.at || m.timestamp || null,
  };
}

/**
 * Build the slice: the message, the two previous messages that carry text, and the
 * quoted message. `recent` may be longer or include photos without text; only the last
 * two text-bearing ones are kept, oldest first.
 */
function buildConversation({ message, recent = [], quoted = null, facts = {} } = {}) {
  const current = toMessage(message);
  if (!current) throw Object.assign(new Error("`message` is required"), { status: 400 });
  // A quoted payload attached to the message itself counts as the quoted message.
  const q = toMessage(quoted) || (message && present(message.quotedBody) ? toMessage({ body: message.quotedBody, fromThisSystem: message.quotedFromThisSystem }) : null);
  const earlier = (Array.isArray(recent) ? recent : []).map(toMessage).filter((m) => m && m.text).slice(-2);
  return { message: current, recent: earlier, quoted: q, facts: facts || {} };
}

/**
 * The flat fact map the domain specs describe — used for the consistency check only.
 * A fact that cannot be known from what was supplied is left out (unknown).
 */
function toFeatures(conv) {
  const m = conv.message;
  const f = {
    "message.kind": m.kind,
    "message.text": m.text,
    "message.hasText": m.text !== "",
    "message.hasPhoto": m.hasPhoto,
    "message.isReply": m.isReply || Boolean(conv.quoted),
    "message.isEdit": m.isEdit,
    "message.isDeletion": m.isDeletion,
    "message.statedSeverity": m.statedSeverity,
    "message.mentions": m.mentions,
  };
  if (conv.quoted) {
    f["quoted.text"] = conv.quoted.text;
    if (conv.quoted.fromThisSystem !== null) f["quoted.fromThisSystem"] = conv.quoted.fromThisSystem;
    if (conv.quoted.fromThisSystem === true) f["quoted.systemMessage"] = conv.quoted.systemMessage;
    if (conv.quoted.issueNumber) f["quoted.issueNumber"] = conv.quoted.issueNumber;
    f["quoted.isPhoto"] = conv.quoted.isPhoto;
    f["quoted.media"] = MEDIA[conv.quoted.kind] || "none";
  }
  // Caller-supplied facts, by their declared names.
  for (const [k, v] of Object.entries(conv.facts || {})) if (v !== undefined) f[k] = v;
  return f;
}

/** HH:MM from epoch seconds, epoch milliseconds or an ISO string. */
function clock(at) {
  const n = Number(at);
  const d = Number.isFinite(n) ? new Date(n < 1e12 ? n * 1000 : n) : new Date(at);
  return Number.isNaN(d.getTime()) ? String(at) : d.toISOString().slice(11, 16);
}

const quote = (t) => `"${String(t).replace(/\s+/g, " ").trim()}"`;

const MEDIA = { photo: "photo", video: "video", document: "document", voice: "voice note", sticker: "sticker" };

/** "[media: photo]" — whether a message carried media, and what kind. */
const mediaLabel = (m) => `[media: ${MEDIA[m.kind] || "none"}]`;

/** Epoch milliseconds from epoch seconds, epoch milliseconds or an ISO string; null if unknown. */
function toMs(at) {
  if (at === null || at === undefined || at === "") return null;
  const n = Number(at);
  const t = Number.isFinite(n) ? (n < 1e12 ? n * 1000 : n) : Date.parse(at);
  return Number.isNaN(t) ? null : t;
}

/** "3 h 12 min", "2 days" — how far apart two messages were. */
function gap(ms) {
  const min = Math.round(ms / 60000);
  if (min < 1) return "moments";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h${min % 60 ? ` ${min % 60} min` : ""}`;
  return `${Math.round(h / 24)} days`;
}

/** One line for one message, as a person reading the chat would see it. */
function line(m, ref = null) {
  const who = m.fromThisSystem ? "Safety desk (this system)" : m.sender || "Someone";
  const t = toMs(m.at);
  const before = ref !== null && t !== null && ref > t ? ` · ${gap(ref - t)} earlier` : "";
  const time = m.at ? `[${clock(m.at)}${before}] ` : "";
  const what = m.isDeletion ? "(deleted this message)" : m.text ? quote(m.text) : "(no text)";
  return `${time}${who}: ${what}  ${m.isDeletion ? "" : mediaLabel(m)}`.trimEnd();
}

/** The conversation, rendered for the model. */
function renderConversation(conv) {
  const out = [];
  // Every earlier line says how long before the message it was sent, so a stale line reads as stale.
  const ref = toMs(conv.message.at);
  if (conv.recent.length) {
    out.push("Earlier in the chat (oldest first):");
    for (const m of conv.recent) out.push(`  ${line(m, ref)}`);
    out.push("");
  }
  if (conv.quoted) {
    out.push("The message it replies to:");
    out.push(`  ${line(conv.quoted, ref)}`);
    if (conv.quoted.systemMessage === "issue_reminder") out.push(`  — this is the desk's own reminder that issue #${conv.quoted.issueNumber}${conv.quoted.issueSeverity ? ` (${conv.quoted.issueSeverity})` : ""} is still open`);
    if (conv.quoted.systemMessage === "photo_request") out.push("  — this is the desk asking the sender for a photo of a safety issue they reported");
    if (conv.quoted.fromThisSystem === true && conv.quoted.isPhoto) out.push("  — a picture the desk itself posted (its register or list pages), not a photo of the site");
    if (conv.quoted.systemMessage === "pic_question") out.push("  — this is the desk asking who is responsible for an issue");
    out.push("");
  }
  const m = conv.message;
  out.push("THE MESSAGE TO CLASSIFY:");
  out.push(`  ${line(m)}${m.isEdit ? "  (an EDIT of an earlier message)" : ""}`);
  if (m.kind === "photo") {
    out.push(conv.photoShown ? "  — its photo is attached below" : "  — its photo could not be loaded");
  }

  const known = describeFacts(conv.facts || {});
  if (known.length) {
    out.push("", "Also known:");
    for (const k of known) out.push(`  - ${k}`);
  }
  return out.join("\n");
}

/** Caller-supplied facts, in plain words. Unknown keys are listed as-is. */
function describeFacts(facts) {
  const out = [];
  const s = facts["quotedIssue.status"];
  if (s === "open" || s === "closed") out.push(`The quoted message is a recorded safety issue, currently ${s.toUpperCase()}.`);
  else if (s === "not_an_issue") out.push("The quoted message is not a recorded safety issue.");
  const effect = facts["original.effect"];
  const effects = { created_issue: "created a safety issue", closed_issue: "closed a safety issue", added_after_photo: "added an after-photo to a closed issue", answered_pic: "named the person responsible for an issue", none: "did not change anything" };
  if (effect) out.push(`The original message (the one edited or deleted) ${effects[effect] || effect}.`);
  if (facts["original.text"]) out.push(`The original message said: ${quote(facts["original.text"])}.`);
  if (facts["earlierPhoto.unrecorded"] === true) out.push("The earlier photo this message refers to has no description and was never recorded.");
  if (facts["project.requiresSeverity"] === true) out.push("This project requires every new report to state a severity (P1, P2 or P3).");
  const described = new Set(["quotedIssue.status", "original.effect", "original.text", "earlierPhoto.unrecorded", "project.requiresSeverity"]);
  for (const [k, v] of Object.entries(facts)) if (!described.has(k) && v !== undefined) out.push(`${k}: ${JSON.stringify(v)}`);
  return out;
}

module.exports = { toMessage, buildConversation, toFeatures, renderConversation, present };
