"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { seededShuffle } = require("../lib/order");
const { classify } = require("../lib/classify");

test("seeded shuffle: same seed, same order; different seeds, different orders; nothing lost", () => {
  const items = Array.from({ length: 11 }, (_, i) => `i${i}`);
  assert.deepStrictEqual(seededShuffle(items, "m1"), seededShuffle(items, "m1"));
  const orders = new Set(["m1", "m2", "m3", "m4", "m5"].map((s) => seededShuffle(items, s).join(",")));
  assert.ok(orders.size >= 4, "different messages see different orders");
  assert.deepStrictEqual([...seededShuffle(items, "m1")].sort(), [...items].sort());
  assert.deepStrictEqual(seededShuffle(items, null), items, "no seed, no shuffle");
});

test("no option holds a fixed position across messages — first place and `other` included", () => {
  const firsts = new Map();
  const otherAt = new Set();
  for (let n = 0; n < 200; n++) {
    const e = seededShuffle(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "other"], `msg-${n}`, "enum");
    firsts.set(e[0], (firsts.get(e[0]) || 0) + 1);
    otherAt.add(e.indexOf("other"));
  }
  assert.strictEqual(firsts.size, 11, "every option leads sometimes");
  for (const [, count] of firsts) assert.ok(count > 5 && count < 40, `roughly even first place (got ${count}/200)`);
  assert.ok(otherAt.size >= 9, "`other` moves around");
});

test("the prompt, examples and enum are ordered per message", async () => {
  const seen = [];
  const fetchImpl = async (u, init) => {
    seen.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ output: [{ type: "function_call", name: "classify", arguments: JSON.stringify({ intent: "other", reason: "x", confidence: 50 }) }] }) };
  };
  for (const id of ["A", "B"]) await classify({ domains: ["safety"], retrieve: false, message: { messageId: id, body: "hi" } }, { fetchImpl, apiKey: "t" });
  await classify({ domains: ["safety"], retrieve: false, message: { messageId: "A", body: "hi" } }, { fetchImpl, apiKey: "t" });
  const enums = seen.map((r) => r.tools[0].parameters.properties.intent.enum.join(","));
  assert.notStrictEqual(enums[0], enums[1], "different messages, different orders");
  assert.strictEqual(enums[0], enums[2], "the same message, the same order");
  assert.notStrictEqual(seen[0].input[0].content, seen[1].input[0].content);
  assert.match(seen[0].input[0].content, /in no particular order/);
});
