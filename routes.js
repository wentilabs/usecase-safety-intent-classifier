"use strict";

/**
 * routes.js — the HTTP surface, shared by the Lambda (index.js) and the local server (app.js).
 *
 *   GET  /domains                    the domains this service knows
 *   GET  /domains/:name              one domain's spec, as-is
 *   GET  /domains/:name/prompt       that domain's prompt SECTION, ready to sit beside other domains'
 *                                    (no role, no `other` — those belong to the composer)
 *   GET  /spec?domains=safety,…      the composed task: intents of every requested domain + one `other`
 *   POST /classify                   { domains, message, recent, quoted, facts, model? } → one intent
 */

const { DOMAINS } = require("./domains");
const { compose } = require("./lib/compose");
const { classify } = require("./lib/classify");
const { renderSection } = require("./lib/prompt");

const json = (status, body) => ({ status, body });
const domainList = (q) => String(q || "").split(",").map((s) => s.trim()).filter(Boolean);

async function route(method, path, query, body) {
  if (method === "GET" && path === "/domains") {
    return json(200, { domains: Object.values(DOMAINS).map((d) => ({ domain: d.domain, version: d.version, title: d.title, intents: d.intents.length })) });
  }
  const section = /^\/domains\/([a-z0-9_-]+)\/prompt$/.exec(path);
  if (method === "GET" && section) {
    const spec = DOMAINS[section[1]];
    if (!spec) return json(404, { error: `unknown domain "${section[1]}"` });
    // ?seed=… shuffles intents and examples; a composer should shuffle per message (no ordering bias).
    const { text, intents } = renderSection(spec, { "project.requiresSeverity": query.requiresSeverity === "true" }, query.seed ?? null);
    return json(200, {
      domain: spec.domain,
      version: spec.version,
      intents,                               // the ids to add to the composer's answer enum
      section: text,                         // place beside other domains' sections
      corrections: spec.corrections,         // how edits and deletions map, applied after classifying the original
      chars: text.length,
    });
  }
  const one = /^\/domains\/([a-z0-9_-]+)$/.exec(path);
  if (method === "GET" && one) {
    const spec = DOMAINS[one[1]];
    return spec ? json(200, spec) : json(404, { error: `unknown domain "${one[1]}"` });
  }
  if (method === "GET" && path === "/spec") {
    const { domains, intents } = compose(domainList(query.domains));
    return json(200, {
      domains: domains.map((d) => ({ domain: d.domain, version: d.version, summary: d.summary, instructions: d.instructions, examples: d.examples, features: d.features })),
      intents,
    });
  }
  if (method === "POST" && path === "/classify") {
    if (!body || typeof body !== "object") return json(400, { error: "send a JSON body: { domains, message, recent, quoted, facts }" });
    return json(200, await classify(body));
  }
  return json(404, { error: "not found" });
}

/** Wrap route() so a thrown error with a status becomes that response, anything else a 500. */
async function handle(method, path, query = {}, body = null) {
  try {
    return await route(method, path, query, body);
  } catch (error) {
    return json(error.status || 500, { error: String(error.message || error) });
  }
}

module.exports = { handle };
