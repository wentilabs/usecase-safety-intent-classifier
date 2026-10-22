"use strict";

/**
 * routes.js — the HTTP surface, shared by the Lambda (index.js) and the local server (app.js).
 *
 *   GET  /domains                    the domains this service knows
 *   GET  /domains/:name              one domain's spec, as-is
 *   GET  /spec?domains=safety,…      the composed task: intents of every requested domain + one `other`
 *   POST /classify                   (added with the classifier)
 */

const { DOMAINS } = require("./domains");
const { compose } = require("./lib/compose");

const json = (status, body) => ({ status, body });
const domainList = (q) => String(q || "").split(",").map((s) => s.trim()).filter(Boolean);

async function route(method, path, query, body) {
  if (method === "GET" && path === "/domains") {
    return json(200, { domains: Object.values(DOMAINS).map((d) => ({ domain: d.domain, version: d.version, title: d.title, intents: d.intents.length })) });
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
