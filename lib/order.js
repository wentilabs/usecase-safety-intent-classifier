"use strict";

/**
 * lib/order.js — present options in an order that favours none of them.
 *
 * Models lean toward options by position (often the first, sometimes the last). Every
 * list the model chooses from — intents, the answer enum, worked examples, domain
 * sections — is therefore shuffled, SEEDED by the message: the same message always sees
 * the same order (reproducible, debuggable), while across messages no option holds a
 * fixed position.
 */

/** A 32-bit hash of a string (FNV-1a). */
function hash(text) {
  let h = 0x811c9dc5;
  for (const ch of String(text)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** A small deterministic generator (mulberry32). */
function generator(seed) {
  let a = hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A copy of `items` in an order fixed by `seed` (Fisher–Yates). `salt` gives each list its
 * own order, so the intents and the examples are not shuffled in lockstep.
 */
function seededShuffle(items, seed, salt = "") {
  const out = [...items];
  if (seed === null || seed === undefined) return out;
  const next = generator(`${seed}|${salt}`);
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** The seed for a request: an explicit one, else the message's identity, else its text. */
const seedFor = (request) =>
  request.orderSeed ?? request.message?.messageId ?? request.message?.messageIdSerialized ?? JSON.stringify(request.message ?? "");

module.exports = { seededShuffle, seedFor, hash };
