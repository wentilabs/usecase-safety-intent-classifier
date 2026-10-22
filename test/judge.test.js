"use strict";

const test = require("node:test");
const assert = require("node:assert");

// A second domain, so the two-step judgement can be exercised before a real one exists.
const registry = require("../domains");
const manpower = { domain: "manpower", title: "Manpower", summary: "Headcounts.", intents: [{ id: "headcount", meaning: "Reports how many workers are on site.", signals: [], notWhen: [] }], instructions: [], examples: [] };
Object.defineProperty(registry, "DOMAINS", { value: Object.freeze({ ...registry.DOMAINS, manpower }) });
const { classify } = require("../lib/classify");

/** Answers per call by which domains the classify tool offers. */
function fakeModel(pick) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    const offered = body.tools[0].parameters.properties.intent.enum;
    calls.push(offered);
    const intent = pick(offered);
    return { ok: true, json: async () => ({ output: [{ type: "function_call", name: "classify", arguments: JSON.stringify({ intent, reason: "r", confidence: 80 }) }] }) };
  };
  return { calls, fetchImpl };
}
const ask = (fake) => classify({ domains: ["safety", "manpower"], message: { body: "25 pax today" }, retrieve: false }, { apiKey: "k", fetchImpl: fake.fetchImpl });

test("each domain is judged alone first", async () => {
  const fake = fakeModel(() => "other");
  const out = await ask(fake);
  assert.strictEqual(fake.calls.length, 2);
  assert.ok(fake.calls.every((e) => e.filter((i) => i !== "other").every((i, _, a) => a.every((j) => j.split(".")[0] === i.split(".")[0]))));
  assert.strictEqual(out.intent, "other");
});

test("one domain left: its answer stands, no third call", async () => {
  const fake = fakeModel((e) => (e.includes("manpower.headcount") ? "manpower.headcount" : "other"));
  const out = await ask(fake);
  assert.strictEqual(fake.calls.length, 2);
  assert.strictEqual(out.intent, "manpower.headcount");
});

test("two domains left: judged together, over those domains only", async () => {
  const fake = fakeModel((e) => (e.includes("manpower.headcount") ? "manpower.headcount" : "safety.new_issue_missing_photo"));
  const out = await ask(fake);
  assert.strictEqual(fake.calls.length, 3);
  assert.ok(fake.calls[2].includes("manpower.headcount") && fake.calls[2].includes("safety.new_issue_missing_photo"));
  assert.ok(out.perDomain.safety && out.perDomain.manpower);
});
