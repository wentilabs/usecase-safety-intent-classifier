"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { DOMAINS } = require("../domains");
const { compose } = require("../lib/compose");
const { validateIntent } = require("../lib/validate");
const { recogniseSystemMessage } = require("../domains/safety/system-messages");
const { handle } = require("../routes");

const safety = DOMAINS.safety;

test("the safety spec is plain JSON — it is served as-is", () => {
  assert.deepStrictEqual(JSON.parse(JSON.stringify(safety)), safety);
});

test("intent ids are unique, and no domain declares its own `other`", () => {
  const ids = safety.intents.map((i) => i.id);
  assert.strictEqual(new Set(ids).size, ids.length);
  assert.ok(!ids.includes("other"));
});

test("every correction maps a live intent to a declared correction intent", () => {
  const live = new Set(safety.intents.map((i) => i.id));
  for (const kind of ["deletion", "edit"]) {
    for (const [from, to] of Object.entries(safety.corrections[kind])) {
      assert.ok(live.has(from), `${kind}: ${from} is not a live intent`);
      assert.ok(safety.corrections.intents[to], `${kind}: ${to} is not declared`);
    }
  }
});

test("every example names a real intent, and every `requires` key is a declared feature", () => {
  const ids = new Set([...safety.intents.map((i) => i.id), "other"]);
  for (const e of safety.examples) assert.ok(ids.has(e.intent), `example uses unknown intent ${e.intent}`);
  for (const i of safety.intents) {
    const keys = [...Object.keys(i.requires?.all || {}), ...(i.requires?.anyOf || []).flatMap(Object.keys)];
    for (const k of keys) assert.ok(k in safety.features, `${i.id} requires undeclared feature ${k}`);
  }
});

test("composing adds exactly one `other`, and qualifies ids by domain", () => {
  const { intents } = compose(["safety"]);
  assert.strictEqual(intents.filter((i) => i.id === "other").length, 1);
  assert.ok(intents.every((i) => i.id === "other" || i.id.startsWith("safety.")));
  assert.throws(() => compose(["safety", "nope"]), /unknown domain/);
  assert.throws(() => compose([]), /at least one domain/);
});

test("validation: unknown facts never refute; known ones do", () => {
  assert.deepStrictEqual(validateIntent("safety.closure", {}), { ok: true, why: null });
  const r = validateIntent("safety.closure", { "message.isReply": true, "message.hasPhoto": true, "message.hasText": true, "quotedIssue.status": "not_an_issue" });
  assert.strictEqual(r.ok, false);
  assert.match(r.why, /quotedIssue.status/);
  assert.strictEqual(validateIntent("safety.deleted_closure", {}).ok, true, "correction intents are derived, never refused");
  assert.strictEqual(validateIntent("safety.new_issue", { "message.kind": "text", "message.hasText": true, "message.hasPhoto": false, "earlierPhoto.unrecorded": false }).ok, false, "anyOf: no photo anywhere");
  assert.strictEqual(validateIntent("safety.new_issue", { "message.kind": "video", "message.hasText": true, "message.hasPhoto": false, "earlierPhoto.unrecorded": false }).ok, true, "a captioned video is the record");
  assert.strictEqual(validateIntent("safety.new_issue", { "message.kind": "text", "message.hasText": true, "message.hasPhoto": false, "earlierPhoto.unrecorded": true }).ok, true);
  assert.strictEqual(validateIntent("other", { anything: 1 }).ok, true);
  assert.strictEqual(validateIntent("safety.made_up", {}).ok, false);
});

test("the desk's own message shapes are recognised", () => {
  assert.deepStrictEqual(recogniseSystemMessage("⚠️ Issue #173 [P3] still open\nLocation: CUT"), { kind: "issue_reminder", issueNumber: "173", severity: "P3" });
  assert.strictEqual(recogniseSystemMessage("⚠️ Issue #9 still open").issueNumber, "9");
  assert.strictEqual(recogniseSystemMessage("hey ⚠️ Issue #9 still open").kind, "message");
  assert.strictEqual(recogniseSystemMessage("Please reply to or attach an image with this message to create a safety issue.").kind, "photo_request");
  assert.strictEqual(recogniseSystemMessage("👤 Who should this safety issue be assigned to?").kind, "pic_question");
});

test("HTTP: domains, one domain, composed spec, errors", async () => {
  assert.strictEqual((await handle("GET", "/domains")).body.domains[0].domain, "safety");
  assert.strictEqual((await handle("GET", "/domains/safety")).body.domain, "safety");
  assert.strictEqual((await handle("GET", "/domains/nope")).status, 404);
  const spec = await handle("GET", "/spec", { domains: "safety" });
  assert.strictEqual(spec.status, 200);
  assert.ok(!spec.body.intents.some((i) => i.id === "safety.deleted_closure"), "corrections are not chosen by the model");
  assert.strictEqual((await handle("GET", "/domains/safety")).body.corrections.deletion.closure, "deleted_closure");
  assert.strictEqual((await handle("GET", "/spec", { domains: "safety,nope" })).status, 400);
});

test("GET /domains/safety/prompt: a self-contained section, nothing generic in it", async () => {
  const r = await handle("GET", "/domains/safety/prompt");
  assert.strictEqual(r.status, 200);
  assert.match(r.body.section, /^## Domain: safety/);
  assert.doesNotMatch(r.body.section, /When none applies|classify tool|scrolling up/, "no role, no other, no answer instruction");
  assert.ok(r.body.intents.includes("safety.closure"));
  assert.ok(!r.body.intents.includes("safety.new_issue_missing_severity"), "project-conditional unless asked");
  assert.ok((await handle("GET", "/domains/safety/prompt", { requiresSeverity: "true" })).body.intents.includes("safety.new_issue_missing_severity"));
  assert.strictEqual(r.body.corrections.deletion.closure, "deleted_closure");
});

test("both wordings of the desk's person-in-charge question are recognised", () => {
  assert.strictEqual(recogniseSystemMessage("👤 Who should this safety issue be assigned to?").kind, "pic_question");
  assert.strictEqual(recogniseSystemMessage("⚠️ Who will be in charge of this safety issue?\n\nPlease *reply to this message*").kind, "pic_question");
});
