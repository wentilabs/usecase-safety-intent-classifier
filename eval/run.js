#!/usr/bin/env node
"use strict";

/**
 * eval/run.js — run the classifier over a scenario set and compare with the labels.
 *
 *   node --env-file=.env eval/run.js <decision-cases.json> [--today <today.json>] [--only id,id] [--seeds N]
 *
 * The scenario set is the human-labelled evaluation set kept in the base template
 * (tests/fixtures/decision-cases.json). Its labels use the base template's action names;
 * they are mapped onto this service's intents below. Labels are never changed here.
 *
 * Photos are stand-ins: the scenario's `photo.shows` sentence drawn on a grey image
 * (macOS qlmanage), identical in spirit to the base template's replay harness.
 *
 * Output goes to eval-runs/ (gitignored): it can contain real site messages.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const { classify } = require("../lib/classify");

const args = process.argv.slice(2);
const casesPath = args.find((a) => a.endsWith(".json") && !a.includes("today"));
const flag = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
const todayPath = flag("--today");
const only = flag("--only") ? new Set(flag("--only").split(",")) : null;
const SEEDS = Math.max(1, Number(flag("--seeds") || 1));
if (!casesPath) { console.error("usage: eval/run.js <decision-cases.json> [--today today.json]"); process.exit(2); }

/** Which of this service's intents count as matching each base-template label. */
const ACCEPTS = {
  create_issue: ["new_issue", "new_issue_missing_pic", "good_observation"], // good observations were filed as issues
  ask_for_photo: ["new_issue_missing_photo"],
  close_issue: ["closure", "closure_missing_photo", "closure_missing_description", "late_after_photo"],
  copy_issue: ["recurrence"],
  no_action: ["other"],
  log_workforce: ["other"], // workforce is not a safety intent here; scored separately
};
const bare = (id) => String(id).replace(/^safety\./, "");

const xml = (t) => String(t).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]);
function standIn(shows) {
  const dir = path.join(os.tmpdir(), "decision-scenario-photos");
  const key = crypto.createHash("sha1").update(String(shows || "A photo.")).digest("hex").slice(0, 16);
  const png = path.join(dir, `${key}.svg.png`);
  try {
    if (!fs.existsSync(png)) {
      fs.mkdirSync(dir, { recursive: true });
      const svg = path.join(dir, `${key}.svg`);
      fs.writeFileSync(svg, `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640"><rect width="640" height="640" fill="#7d8287"/><text x="24" y="52" font-family="Helvetica" font-size="20" fill="#eef">TEST PHOTO — stand-in for a real site photo</text><foreignObject x="24" y="84" width="592" height="540"><div xmlns="http://www.w3.org/1999/xhtml" style="font:30px Helvetica;color:#fff;line-height:1.3">${xml(shows || "A photo.")}</div></foreignObject></svg>`);
      execFileSync("qlmanage", ["-t", "-s", "640", "-o", dir, svg], { stdio: "ignore" });
    }
    return `data:image/png;base64,${fs.readFileSync(png).toString("base64")}`;
  } catch {
    return null;
  }
}

/** A real photo saved next to a set built from the archive (`photo.file`, relative to the set). */
function realPhoto(file) {
  try {
    const p = path.join(path.dirname(casesPath), file);
    const type = /\.png$/i.test(p) ? "png" : /\.webp$/i.test(p) ? "webp" : "jpeg";
    return `data:image/${type};base64,${fs.readFileSync(p).toString("base64")}`;
  } catch {
    return null;
  }
}

/** A scenario as a classify request: the message, what it quotes, and the facts it states. */
function toRequest(c) {
  const m = c.message || {};
  const quotedText = (c.quoted && c.quoted.text) || m.quotedBody || "";
  const isReply = Boolean(quotedText || c.quoted || c.quotedIssue !== undefined || c.deferredAnchor);
  const facts = {};
  if (c.quotedIssue !== undefined) facts["quotedIssue.status"] = c.quotedIssue === null ? "not_an_issue" : String(c.quotedIssue.Status).toLowerCase();
  if (c.deferredAnchor) facts["earlierPhoto.unrecorded"] = true;
  return {
    domains: ["safety"],
    retrieve: false,
    message: {
      messageId: c.id, sender: "Site staff", type: m.type || "chat", body: m.body || "",
      ...(isReply ? { quotedMessageId: "Q" } : {}),
      ...(c.photo ? { photoDataUrl: c.photo.file ? realPhoto(c.photo.file) : standIn(c.photo.shows) } : {}),
      ...(c.payload ? { timestamp: c.payload.timestamp, from: c.payload.from || c.payload.chatId, clientIdentifier: c.payload.clientIdentifier } : {}),
    },
    ...(isReply
      ? { quoted: c.deferredAnchor
          ? { sender: "Site staff", type: "image", body: "" }
          : { sender: c.quoted && c.quoted.fromThisSystem ? "Safety desk" : "Supervisor", body: quotedText, type: c.quoted && c.quoted.photo ? "image" : "chat", fromThisSystem: c.quoted ? c.quoted.fromThisSystem ?? null : null } }
      : { quoted: null }),
    recent: (c.recent || []).map((r, i) => ({ sender: r.sender || "Site staff", type: r.type || "chat", body: r.body || "", ...(r.fromThisSystem ? { fromThisSystem: true } : {}) })),
    facts,
  };
}

(async () => {
  const { cases } = JSON.parse(fs.readFileSync(casesPath, "utf8"));
  const today = todayPath ? JSON.parse(fs.readFileSync(todayPath, "utf8")).cases : {};
  const rows = [];
  const todo = cases.filter((c) => !only || only.has(c.id));
  // a few at a time
  for (let i = 0; i < todo.length; i += 6) {
    await Promise.all(todo.slice(i, i + 6).map(async (c) => {
      const answers = [];
      for (let s = 0; s < SEEDS; s++) {
        try {
          const r = await classify({ ...toRequest(c), orderSeed: `${c.id}#${s}` });
          answers.push({ intent: bare(r.intent), reason: r.reason, reconsidered: r.reconsidered && bare(r.reconsidered.intent) });
        } catch (e) {
          answers.push({ intent: "ERROR", reason: e.message });
        }
      }
      const t = today[c.id];
      const ok = (intent) => (c.expected ? (ACCEPTS[c.expected] || []).includes(intent) : null);
      rows.push({ id: c.id, source: c.source, shape: c.shape, expected: c.expected || null, vetted: Boolean(c.vetting), answers, newOk: c.expected ? answers.every((a) => ok(a.intent)) : null, stable: new Set(answers.map((a) => a.intent)).size === 1, today: t ? t.today : null, todayOk: t && c.expected ? t.today === c.expected : null, text: (m => `${m.type === "image" ? "📷 " : ""}${m.body || ""}`)(c.message || {}) });
      process.stderr.write(".");
    }));
  }
  process.stderr.write("\n");
  rows.sort((a, b) => cases.findIndex((c) => c.id === a.id) - cases.findIndex((c) => c.id === b.id));
  fs.mkdirSync("eval-runs", { recursive: true });
  const out = `eval-runs/run-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  fs.writeFileSync(out, JSON.stringify(rows, null, 2));
  console.log(out);
})();
