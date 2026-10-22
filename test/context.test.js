"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { fillContext, fetchDeleted, sentByUs } = require("../lib/context");

/** A fake archive: answers each REST read from a list of rows, by the filters it was given. */
function fakeArchive(rows) {
  const reads = [];
  const fetchImpl = async (url) => {
    const q = new URL(url).searchParams;
    reads.push(Object.fromEntries(q));
    const eq = (k) => (q.get(k) || "").replace(/^eq\./, "");
    let out = rows.filter((r) => r.from === eq("from"));
    if (q.get("messageId")) out = out.filter((r) => r.messageId === eq("messageId"));
    if (q.get("messageIdSerialized")) out = out.filter((r) => r.messageIdSerialized === eq("messageIdSerialized"));
    if (q.get("timestamp")) out = out.filter((r) => r.timestamp < Number(q.get("timestamp").replace(/^lt\./, "")));
    if (q.get("order") === "timestamp.desc") out = [...out].sort((a, b) => b.timestamp - a.timestamp);
    return { ok: true, json: async () => out };
  };
  return { deps: { url: "https://x.supabase.co", key: "k", ours: "C1", fetchImpl }, reads };
}

const G = "group@g.us";
const rows = [
  { from: G, messageId: "m1", messageIdSerialized: "false_m1", body: "toolbox 7.30", timestamp: 100, clientIdentifier: "C1" },
  { from: G, messageId: "m2", messageIdSerialized: "false_m2", body: "", type: "image", timestamp: 110, clientIdentifier: "C1" },
  { from: G, messageId: "m3", messageIdSerialized: "false_m3", body: "plates at CUT not secured", timestamp: 120, clientIdentifier: "C1" },
  // the same message as m3, archived by ANOTHER bot's listener — must not count twice
  { from: G, messageId: "m3", messageIdSerialized: "false_m3", body: "plates at CUT not secured", timestamp: 120, clientIdentifier: "OTHER" },
  { from: G, messageId: "m4", messageIdSerialized: "false_m4", body: "oops", timestamp: 125, clientIdentifier: "C1", isDeleted: true },
  // the desk's reminder: true_ on OUR copy; true_ on the other bot's copy means THEY sent their copy
  { from: G, messageId: "r1", messageIdSerialized: "true_r1", body: "⚠️ Issue #173 [P3] still open", timestamp: 90, clientIdentifier: "C1" },
  { from: G, messageId: "r1", messageIdSerialized: "false_r1", body: "⚠️ Issue #173 [P3] still open", timestamp: 90, clientIdentifier: "OTHER" },
  { from: G, messageId: "d0", messageIdSerialized: "false_d0", body: "open edge at L5 no barricade", timestamp: 80, clientIdentifier: "C1" },
];

test("fills the two earlier text messages: oldest first, deduped across listeners, no deletions or empty photos", async () => {
  const { deps } = fakeArchive(rows);
  const { request, retrieved } = await fillContext({ message: { from: G, messageId: "m5", body: "done", timestamp: 130 } }, deps);
  assert.deepStrictEqual(request.recent.map((r) => r.body), ["toolbox 7.30", "plates at CUT not secured"]);
  assert.ok(retrieved.includes("recent"));
});

test("fills the quoted message, judged 'sent by the desk' from OUR copy", async () => {
  const { deps } = fakeArchive(rows);
  const { request } = await fillContext({ message: { from: G, messageId: "m5", body: "done", timestamp: 130, quotedMessageId: "r1" } }, deps);
  assert.strictEqual(request.quoted.fromThisSystem, true);
  assert.match(request.quoted.body, /Issue #173/);
});

test("what the caller sent wins; nothing is read for it", async () => {
  const { deps, reads } = fakeArchive(rows);
  const { request } = await fillContext({ message: { from: G, body: "x", timestamp: 130, quotedMessageId: "r1" }, recent: [], quoted: { body: "given" } }, deps);
  assert.deepStrictEqual(request.recent, []);
  assert.strictEqual(request.quoted.body, "given");
  assert.strictEqual(reads.length, 0);
});

test("a deletion's original is the row its parentMsgKey points at", async () => {
  const { deps } = fakeArchive(rows);
  const row = await fetchDeleted({ from: G, isDeleted: true, parentMsgKey: "false_d0", clientIdentifier: "C1" }, deps);
  assert.strictEqual(row.body, "open edge at L5 no barricade");
  assert.strictEqual(row.timestamp, 80, "its OWN timestamp — so its own earlier messages are read");
});

test("without archive credentials nothing is read, and nothing breaks", async () => {
  const r = await fillContext({ message: { from: G, body: "x", timestamp: 1 } }, { url: "", key: "" });
  assert.deepStrictEqual(r.retrieved, []);
});

test("sentByUs: our row's true_ only", () => {
  assert.strictEqual(sentByUs({ messageIdSerialized: "true_x", clientIdentifier: "C1" }, "C1"), true);
  assert.strictEqual(sentByUs({ messageIdSerialized: "true_x", clientIdentifier: "OTHER" }, "C1"), false);
  assert.strictEqual(sentByUs({ messageIdSerialized: "true_x" }, "C1"), true, "legacy rows without a clientIdentifier");
});

test("the payload's own clientIdentifier decides which listener's copy is 'ours'", async () => {
  const { deps } = fakeArchive(rows);
  delete deps.ours;
  const { request } = await fillContext({ message: { from: G, clientIdentifier: "OTHER", body: "x", timestamp: 130, quotedMessageId: "r1" } }, deps);
  assert.strictEqual(request.quoted.fromThisSystem, false, "from OTHER's point of view, r1 was not sent by it");
});

test("retrieval is best-effort: a failing archive leaves gaps, reports them, never throws", async () => {
  const fetchImpl = async () => ({ ok: false, status: 503, text: async () => "down" });
  const r = await fillContext({ message: { from: G, body: "done", timestamp: 130, quotedMessageId: "r1" } }, { url: "https://x", key: "k", ours: "C1", fetchImpl });
  assert.strictEqual(r.request.recent, undefined);
  assert.strictEqual(r.request.quoted, undefined);
  assert.strictEqual(r.missed.length, 2);
  assert.match(r.missed[0], /503/);
});

test("the desk's own messages are part of the earlier context", async () => {
  const deskAsks = [
    { from: G, messageId: "q1", messageIdSerialized: "true_q1", body: "👤 Who should this safety issue be assigned to?", timestamp: 200, clientIdentifier: "C1" },
  ];
  const { deps } = fakeArchive(deskAsks);
  const { request } = await fillContext({ message: { from: G, messageId: "a1", body: "Mohamed Shafiee 6591234567", timestamp: 210 } }, deps);
  assert.strictEqual(request.recent.length, 1);
  assert.strictEqual(request.recent[0].fromThisSystem, true);
  assert.match(request.recent[0].body, /Who should this safety issue be assigned to/);
});
