"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { classify } = require("../lib/classify");
const { buildConversation, renderConversation } = require("../lib/conversation");

/** A fake model: records the request, answers with the given tool call. */
function fakeModel(answer) {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ output: [{ type: "function_call", name: "classify", arguments: JSON.stringify(answer) }] }) };
  };
  return { fetchImpl, seen, apiKey: "test" };
}

const reminderReply = {
  domains: ["safety"],
  recent: [{ sender: "A", body: "toolbox at 7.30" }, { sender: "B", type: "image", body: "" }, { sender: "B", body: "plates at CUT not secured" }],
  quoted: { messageIdSerialized: "true_X", body: "⚠️ Issue #173 [P3] still open\nLocation: CUT" },
  message: { sender: "Muthu", type: "image", mediaFilename: "y.jpg", body: "done", quotedMessageId: "X" },
  facts: { "quotedIssue.status": "open" },
};

test("the model reads the conversation slice: two earlier text messages, the quoted one, the message", async () => {
  const m = fakeModel({ intent: "safety.closure", reason: "fixed", confidence: 90 });
  const r = await classify(reminderReply, m);
  assert.strictEqual(r.intent, "safety.closure");
  const user = m.seen[0].input[1].content;
  assert.match(user, /toolbox at 7\.30/);
  assert.match(user, /plates at CUT not secured/);
  assert.match(user, /desk's own reminder that issue #173 \(P3\)/);
  assert.match(user, /THE MESSAGE TO CLASSIFY:\n  Muthu: a photo with caption "done"/);
  assert.match(user, /currently OPEN/);
});

test("the model can only pick a composed intent, and is forced to answer", async () => {
  const m = fakeModel({ intent: "other", reason: "x", confidence: 50 });
  await classify(reminderReply, m);
  const req = m.seen[0];
  assert.deepStrictEqual(req.tool_choice, { type: "function", name: "classify" });
  const allowed = req.tools[0].parameters.properties.intent.enum;
  assert.ok(allowed.includes("safety.deleted_closure") && allowed.includes("other"));
  assert.strictEqual(allowed.filter((x) => x === "other").length, 1);
  assert.ok(!("temperature" in req), "reasoning models are not sent temperature");
});

test("an intent that contradicts a supplied fact becomes other, with the reason", async () => {
  const m = fakeModel({ intent: "safety.closure", reason: "x", confidence: 80 });
  const r = await classify({ ...reminderReply, facts: { "quotedIssue.status": "not_an_issue" } }, m);
  assert.strictEqual(r.intent, "other");
  assert.strictEqual(r.refused.intent, "safety.closure");
  assert.match(r.refused.why, /quotedIssue.status/);
});

test("only the last two text-bearing messages are used", () => {
  const conv = buildConversation({ message: { body: "same" }, recent: [{ body: "one" }, { body: "two" }, { type: "image", body: "" }, { body: "three" }] });
  assert.deepStrictEqual(conv.recent.map((m) => m.text), ["two", "three"]);
});

test("the desk's own shapes are trusted only when the desk sent them", () => {
  const ours = renderConversation(buildConversation({ message: { body: "done" }, quoted: { messageIdSerialized: "true_1", body: "⚠️ Issue #9 still open" } }));
  const typed = renderConversation(buildConversation({ message: { body: "done" }, quoted: { messageIdSerialized: "false_1", body: "⚠️ Issue #9 still open" } }));
  assert.match(ours, /desk's own reminder/);
  assert.doesNotMatch(typed, /desk's own reminder/);
});

test("a failed model call is an error, not a guess", async () => {
  const fetchImpl = async () => ({ ok: false, status: 429, text: async () => "rate limited" });
  await assert.rejects(() => classify(reminderReply, { fetchImpl, apiKey: "t" }), /429/);
});
