"use strict";

/**
 * lib/validate.js — refuse an intent the facts contradict.
 *
 * The model decides what a message MEANS. It does not get to contradict a fact: a
 * closure of a message the register says is not an issue, a deletion intent on a
 * message that was not deleted. Each intent's `requires` (in its domain spec) lists
 * the facts it cannot exist without.
 *
 * ⚠️ A fact the caller did not supply is UNKNOWN and never refutes. The service is
 * agnostic to what came before it; it only holds the model to what it was told.
 *
 * A refused intent becomes `other`, with the reason — never a silent swap to another
 * intent. Choosing the right intent is the model's job; this only says "not that".
 */

const { DOMAINS } = require("../domains");

/** A single fact matches when unknown, or when equal to the required value. */
const factHolds = (features, key, want) => {
  if (!Object.prototype.hasOwnProperty.call(features, key) || features[key] === undefined) return true;
  return features[key] === want;
};

const allHold = (features, req = {}) =>
  Object.entries(req).filter(([k, v]) => !factHolds(features, k, v)).map(([k, v]) => `${k} is ${JSON.stringify(features[k])}, not ${JSON.stringify(v)}`);

/**
 * @param {string} qualifiedId e.g. "safety.closure", or "other"
 * @param {object} features flat feature map (see each domain's `features`)
 * @returns {{ok: boolean, why: string|null}}
 */
function validateIntent(qualifiedId, features) {
  if (qualifiedId === "other") return { ok: true, why: null };
  const [domain, id] = String(qualifiedId).split(".");
  const spec = DOMAINS[domain];
  if (spec && spec.corrections && spec.corrections.intents && spec.corrections.intents[id]) return { ok: true, why: null };
  const intent = spec && spec.intents.find((i) => i.id === id);
  if (!intent) return { ok: false, why: `"${qualifiedId}" is not an intent of any requested domain` };

  const req = intent.requires || {};
  const failed = allHold(features, req.all);
  if (req.anyOf && req.anyOf.length && !req.anyOf.some((alt) => allHold(features, alt).length === 0)) {
    failed.push(`none of: ${req.anyOf.map((alt) => Object.entries(alt).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" & ")).join(" | ")}`);
  }
  return failed.length ? { ok: false, why: failed.join("; ") } : { ok: true, why: null };
}

module.exports = { validateIntent };
