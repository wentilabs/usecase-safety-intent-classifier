"use strict";

/**
 * lib/compose.js — combine one or more intent domains into one classification task.
 *
 * A caller says which domains are in play ("safety", or "safety,manpower,qa"); this
 * returns their intents side by side, each prefixed by domain so two domains can never
 * collide, plus exactly ONE `other` — "none of the requested domains applies".
 *
 * `other` belongs to the composition, not to any domain: with three domains requested
 * there is still only one way to say "not ours".
 */

const { DOMAINS } = require("../domains");

const OTHER = Object.freeze({
  id: "other",
  meaning: "The message is not one of the intents above — it belongs to none of the requested domains, or needs no action in them.",
});

/** Qualified id: "safety.closure". `other` stays unqualified. */
const qualify = (domain, id) => `${domain}.${id}`;

/**
 * @param {string[]} names Domain names, e.g. ["safety"].
 * @returns {{domains: object[], intents: Array<{id: string, domain: string|null, meaning: string}>}}
 * @throws when a requested domain is unknown.
 */
function compose(names, facts = {}) {
  const wanted = [...new Set((names || []).map((n) => String(n).trim()).filter(Boolean))];
  if (!wanted.length) throw Object.assign(new Error("ask for at least one domain"), { status: 400 });
  const unknown = wanted.filter((n) => !DOMAINS[n]);
  if (unknown.length) {
    throw Object.assign(new Error(`unknown domain(s): ${unknown.join(", ")}. Known: ${Object.keys(DOMAINS).join(", ")}`), { status: 400 });
  }
  const domains = wanted.map((n) => DOMAINS[n]);
  const intents = [
    ...domains.flatMap((d) =>
      d.intents
        // An intent that only exists under a project setting is offered only when the caller says it applies.
        .filter((i) => !i.offeredOnlyWhen || Object.entries(i.offeredOnlyWhen).every(([k, v]) => facts[k] === v))
        .map((i) => ({ id: qualify(d.domain, i.id), domain: d.domain, meaning: i.meaning })),
    ),
    { id: OTHER.id, domain: null, meaning: OTHER.meaning },
  ];
  return { domains, intents };
}

module.exports = { compose, qualify, OTHER };
