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
  const r = await classify({ ...reminderReply, retrieve: false }, m);
  assert.strictEqual(r.intent, "safety.closure");
  const user = m.seen[0].input[1].content;
  assert.match(user, /toolbox at 7\.30/);
  assert.match(user, /plates at CUT not secured/);
  assert.match(user, /desk's own reminder that issue #173 \(P3\)/);
  assert.match(user, /THE MESSAGE TO CLASSIFY:\n  Muthu: "done"  \[media: photo\]/);
  assert.match(user, /currently OPEN/);
});

test("the model can only pick a composed intent, and is forced to answer", async () => {
  const m = fakeModel({ intent: "other", reason: "x", confidence: 50 });
  await classify({ ...reminderReply, retrieve: false }, m);
  const req = m.seen[0];
  assert.deepStrictEqual(req.tool_choice, { type: "function", name: "classify" });
  const allowed = req.tools[0].parameters.properties.intent.enum;
  assert.ok(allowed.includes("safety.deleted_closure") && allowed.includes("other"));
  assert.strictEqual(allowed.filter((x) => x === "other").length, 1);
  assert.ok(!("temperature" in req), "reasoning models are not sent temperature");
});

test("an intent that contradicts a supplied fact becomes other, with the reason", async () => {
  const m = fakeModel({ intent: "safety.closure", reason: "x", confidence: 80 });
  const r = await classify({ ...reminderReply, retrieve: false, facts: { "quotedIssue.status": "not_an_issue" } }, m);
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
  await assert.rejects(() => classify({ ...reminderReply, retrieve: false }, { fetchImpl, apiKey: "t" }), /429/);
});

test("every line carries a media label; only the main photo is sent as an image", async () => {
  const m = fakeModel({ intent: "safety.new_issue", reason: "x", confidence: 90 });
  await classify({
    domains: ["safety"], retrieve: false,
    recent: [{ sender: "A", type: "image", body: "earlier photo caption" }, { sender: "B", body: "plain text" }],
    quoted: { sender: "C", type: "video", body: "a clip" },
    message: { sender: "D", type: "image", body: "open edge", photoDataUrl: "data:image/png;base64,AAAA" },
  }, m);
  const content = m.seen[0].input[1].content;
  assert.ok(Array.isArray(content), "text + one image");
  assert.strictEqual(content.filter((c) => c.type === "input_image").length, 1, "exactly one image");
  const text = content[0].text;
  assert.match(text, /"earlier photo caption"  \[media: photo\]/);
  assert.match(text, /"plain text"  \[media: none\]/);
  assert.match(text, /"a clip"  \[media: video\]/);
  assert.match(text, /its photo is attached below/);
});

test("a photo that cannot be loaded is said so, not guessed", async () => {
  const m = fakeModel({ intent: "other", reason: "x", confidence: 50 });
  await classify({ domains: ["safety"], retrieve: false, message: { type: "image", mediaFilename: "x.jpg", body: "hm" } }, m);
  const content = m.seen[0].input[1].content;
  assert.strictEqual(typeof content, "string", "no image part");
  assert.match(content, /its photo could not be loaded/);
});

test("quotedBody 'false' is the listener saying 'not a reply'", () => {
  const conv = buildConversation({ message: { body: "x", quotedBody: "false", quotedMessageId: "false" } });
  assert.strictEqual(conv.quoted, null);
  assert.strictEqual(conv.message.isReply, false);
});

test("a project-conditional intent is offered only when the project says so", async () => {
  const m = fakeModel({ intent: "other", reason: "x", confidence: 50 });
  await classify({ domains: ["safety"], retrieve: false, message: { body: "x" } }, m);
  assert.ok(!m.seen[0].tools[0].parameters.properties.intent.enum.includes("safety.new_issue_missing_severity"));
  const m2 = fakeModel({ intent: "other", reason: "x", confidence: 50 });
  await classify({ domains: ["safety"], retrieve: false, message: { body: "x" }, facts: { "project.requiresSeverity": true } }, m2);
  assert.ok(m2.seen[0].tools[0].parameters.properties.intent.enum.includes("safety.new_issue_missing_severity"));
});

test("a refused answer gets one reconsideration, told the contradicted fact", async () => {
  const answers = [{ intent: "safety.closure", reason: "a", confidence: 80 }, { intent: "safety.new_issue", reason: "b", confidence: 80 }];
  const seen = [];
  const fetchImpl = async (u, init) => {
    seen.push(JSON.parse(init.body));
    const a = answers[seen.length - 1];
    return { ok: true, json: async () => ({ output: [{ type: "function_call", name: "classify", arguments: JSON.stringify(a) }] }) };
  };
  const r = await classify({ domains: ["safety"], retrieve: false, message: { type: "image", body: "open edge", photoDataUrl: "data:image/png;base64,AA", quotedMessageId: "Q" }, quoted: { body: "hi" }, facts: { "quotedIssue.status": "not_an_issue" } }, { fetchImpl, apiKey: "t" });
  assert.strictEqual(seen.length, 2);
  assert.match(seen[1].input.at(-1).content, /contradicts a known fact: quotedIssue.status/);
  assert.strictEqual(r.intent, "safety.new_issue");
  assert.strictEqual(r.reconsidered.intent, "safety.closure");
});

test("each earlier line says how long before the message it was sent", () => {
  const conv = buildConversation({
    message: { body: "done", timestamp: 1792661336 },
    recent: [{ sender: "A", body: "old", timestamp: 1792661336 - 3 * 3600 - 12 * 60 }, { sender: "B", body: "new", timestamp: 1792661336 - 120 }],
  });
  const text = renderConversation(conv);
  assert.match(text, /3 h 12 min earlier\] A: "old"/);
  assert.match(text, /2 min earlier\] B: "new"/);
});
