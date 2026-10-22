"use strict";

/**
 * domains/safety/spec.js — the safety intent domain, as data.
 *
 * Everything a classifier needs to recognise safety intents, and nothing about what
 * happens before (how features were gathered) or after (who acts on the intent). This
 * object is served as-is from GET /domains/safety, so it must stay plain JSON: no
 * functions, no regexes.
 *
 * Composition: a caller may ask for several domains at once (safety, manpower, QA …).
 * Each domain contributes its intents, instructions and examples; ONE `other` intent is
 * added by the composer (lib/compose.js), never by a domain.
 *
 * `requires` lists the FACTS an intent cannot exist without. lib/validate.js uses it to
 * refuse an intent the facts contradict. A fact the caller did not supply is "unknown"
 * and never refutes anything — the model's judgement stands.
 *
 * Fixing a wrong reading: add an EXAMPLE, not a rule. A rule has to stay consistent with
 * every other rule; an example only has to be true.
 */

const SAFETY_DOMAIN = {
  domain: "safety",
  version: "0.1.0",
  title: "Safety issues on site",
  summary:
    "Messages in a construction site's group chat that report, close, correct or retract a safety issue — a hazard, deficiency, unsafe act, near miss, incident, or a notable safety observation.",

  intents: [
    // ── new issues ──────────────────────────────────────────────────────────
    {
      id: "new_issue",
      meaning: "A new safety issue, complete: a description of the condition and a photo of it, and the person responsible is named.",
      signals: [
        "describes an unsafe condition, act, near miss, incident, or a safety observation worth recording",
        "a photo is available (on this message, or an earlier undescribed photo this message describes)",
        "names or @mentions who should act on it",
      ],
      notWhen: [
        "the words only acknowledge, ask, schedule, or promise",
        "a photo alone with no words",
        "it is about an issue already recorded (that is a closure, recurrence or edit)",
      ],
      requires: { all: { "message.hasText": true, "message.isDeletion": false }, anyOf: [{ "message.hasPhoto": true }, { "earlierPhoto.unrecorded": true }] },
    },
    {
      id: "new_issue_missing_pic",
      meaning: "A new safety issue, complete except that nobody is named as responsible for fixing it.",
      signals: ["everything that makes a new_issue, but no person is named or @mentioned as responsible"],
      notWhen: ["it is missing a photo (that is new_issue_missing_photo)"],
      requires: { all: { "message.hasText": true, "message.isDeletion": false }, anyOf: [{ "message.hasPhoto": true }, { "earlierPhoto.unrecorded": true }] },
    },
    {
      id: "new_issue_missing_photo",
      meaning: "Clearly a new safety issue being reported, but no photo is available to record it with.",
      signals: ["describes an unsafe condition in words", "no photo on the message and no earlier undescribed photo"],
      notWhen: [
        "it is chatter, a question or a reminder rather than a report",
        "something other than a photo was attached (a video, document or voice note) — the sender did attach something",
      ],
      requires: { all: { "message.hasText": true, "message.hasPhoto": false, "message.isDeletion": false, "earlierPhoto.unrecorded": false } },
    },
    {
      id: "new_issue_missing_severity",
      meaning: "A new safety issue on a project that requires every report to state a severity (P1, P2 or P3), and none was stated.",
      signals: ["a new issue in every other respect", "this project requires a stated severity", "no P1/P2/P3 is stated"],
      notWhen: ["the project does not require a severity"],
      requires: { all: { "project.requiresSeverity": true, "message.statedSeverity": null, "message.hasText": true, "message.isDeletion": false } },
    },

    // ── closing ─────────────────────────────────────────────────────────────
    {
      id: "closure",
      meaning: "Reports that a recorded, still-open issue is fixed, with an after-photo and words claiming the work is done.",
      signals: ["replies to a recorded open issue, or to the desk's reminder about one", "words claim completion: done, rectified, settled, cleared", "has a photo"],
      notWhen: ["a promise ('will do tomorrow')", "an acknowledgement ('noted')", "a question"],
      requires: { all: { "message.isReply": true, "message.hasPhoto": true, "message.hasText": true, "quotedIssue.status": "open" } },
    },
    {
      id: "closure_missing_photo",
      meaning: "Claims a recorded, still-open issue is fixed, in words only — no after-photo.",
      signals: ["replies to a recorded open issue", "words claim completion", "no photo"],
      notWhen: ["a promise, acknowledgement or question"],
      requires: { all: { "message.isReply": true, "message.hasPhoto": false, "message.hasText": true, "quotedIssue.status": "open" } },
    },
    {
      id: "closure_missing_description",
      meaning: "Sends an after-photo for a recorded, still-open issue, with no words at all.",
      signals: ["replies to a recorded open issue", "a photo", "no text"],
      notWhen: [],
      requires: { all: { "message.isReply": true, "message.hasPhoto": true, "message.hasText": false, "quotedIssue.status": "open" } },
    },
    {
      id: "late_after_photo",
      meaning: "Sends an after-photo for an issue that is already closed — the evidence of the fix, arriving late.",
      signals: ["replies to a recorded issue that is already CLOSED", "a photo of the fixed condition"],
      notWhen: ["the closed issue has already happened again ('same' — that is a recurrence)"],
      requires: { all: { "message.isReply": true, "message.hasPhoto": true, "quotedIssue.status": "closed" } },
    },

    // ── follow-ups ──────────────────────────────────────────────────────────
    {
      id: "recurrence",
      meaning: "Says a recorded issue has happened again ('same', 'same again', 'this one again').",
      signals: ["replies to a recorded issue (open or closed)", "says it is the same problem, again"],
      notWhen: ["the same KIND of hazard at a different place, with its own description — judge that as a new issue"],
      requires: { all: { "message.isReply": true, "message.hasText": true }, anyOf: [{ "quotedIssue.status": "open" }, { "quotedIssue.status": "closed" }] },
    },
    {
      id: "pic_answer",
      meaning: "Answers the desk's question about who is responsible for an issue, by naming or @mentioning a person.",
      signals: ["replies to the desk's person-in-charge question", "names a person, often with a phone number, or @mentions them"],
      notWhen: ["it does not name anyone"],
      requires: { all: { "message.isReply": true, "quoted.systemMessage": "pic_question" } },
    },

    // ── corrections: edits ──────────────────────────────────────────────────
    {
      id: "edited_new_issue",
      meaning: "Edits a message that created a recorded issue — the record should follow the corrected text.",
      signals: ["this message is an edit", "the original message created an issue"],
      notWhen: ["the original created nothing — then judge the edited text as if it were new"],
      requires: { all: { "message.isEdit": true, "original.effect": "created_issue" } },
    },
    {
      id: "edited_closure",
      meaning: "Edits a message that closed an issue.",
      signals: ["this message is an edit", "the original message closed an issue"],
      notWhen: [],
      requires: { all: { "message.isEdit": true, "original.effect": "closed_issue" } },
    },

    // ── corrections: deletions — each says what the deleted message had done ──
    {
      id: "deleted_new_issue",
      meaning: "Deletes a message that created a recorded issue (including a description sent for an earlier photo, or a 'same' copy). The issue it created should be undone.",
      signals: ["this message is a deletion", "the deleted message created an issue"],
      notWhen: [],
      requires: { all: { "message.isDeletion": true, "original.effect": "created_issue" } },
    },
    {
      id: "deleted_closure",
      meaning: "Deletes a message that closed an issue. The closure it made should be undone.",
      signals: ["this message is a deletion", "the deleted message closed an issue"],
      notWhen: [],
      requires: { all: { "message.isDeletion": true, "original.effect": "closed_issue" } },
    },
    {
      id: "deleted_after_photo",
      meaning: "Deletes a message that added an after-photo to an already-closed issue. That photo should be undone.",
      signals: ["this message is a deletion", "the deleted message added a late after-photo"],
      notWhen: [],
      requires: { all: { "message.isDeletion": true, "original.effect": "added_after_photo" } },
    },
    {
      id: "deleted_pic_answer",
      meaning: "Deletes a message that named the person responsible for an issue. That assignment should be undone.",
      signals: ["this message is a deletion", "the deleted message answered the person-in-charge question"],
      notWhen: [],
      requires: { all: { "message.isDeletion": true, "original.effect": "answered_pic" } },
    },
  ],

  instructions: [
    "Judge a reply by what it SAYS, not by the fact that it is a reply. Replying is just how people talk in a group chat.",
    "A reply about a recorded issue is about that issue — closing it, sending its after-photo, saying it happened again. Only treat it so when the facts say the quoted message is a recorded issue.",
    "A reply can still carry a NEW issue: when it answers the desk's request for a photo, when it describes an earlier photo that has no description yet, or when it reports a different hazard of its own.",
    "The words decide, not the photo. A hazardous-looking photo with 'good morning' is not a report; a terse '@person FE stand' under a photo of a fire extinguisher on the floor is.",
    "A promise, an acknowledgement or a question is never a closure. Only words that claim the work is done.",
    "Deletions and edits are decided by what the ORIGINAL message did, given in the facts. A deletion of a message that did nothing is not a safety intent.",
    "People write fast, in fragments, with typos, Singlish, mixed languages and @mentions. Read for meaning, not grammar.",
    "If the message is about something else entirely — workforce numbers, scheduling, greetings, other teams' business — it is not a safety intent.",
  ],

  examples: [
    { message: 'Photo: "Worker at slab edge without harness, open edge not barricaded. @Ah Kow pls rectify"', facts: "fresh message, photo attached", intent: "new_issue", why: "A described hazard, photographed, with someone named to act." },
    { message: 'Photo: "Trailer parked without wheel chock??"', facts: "fresh message, photo attached, nobody named", intent: "new_issue_missing_pic", why: "A complete report except for who should act." },
    { message: '"Scaffold at block B missing toe board"', facts: "fresh message, no photo", intent: "new_issue_missing_photo", why: "Clearly a report, but nothing to record it with." },
    { message: 'Photo: "Open edge at grid D7"', facts: "replies to the desk's request for a photo", intent: "new_issue_missing_pic", why: "Completing the report the desk asked for; still no one named." },
    { message: '"that one is an open riser at grid C4"', facts: "replies to an earlier photo with no description, never recorded", intent: "new_issue_missing_pic", why: "Supplies the description for an unrecorded hazard photo." },
    { message: 'Photo: "done, barricade installed"', facts: "replies to a recorded OPEN issue", intent: "closure", why: "Claims completion, with evidence." },
    { message: 'Photo: "done"', facts: "replies to the desk's reminder '⚠️ Issue #173 [P3] still open'; issue #173 is OPEN", intent: "closure", why: "Answering a reminder with a photo and 'done' closes that issue." },
    { message: '"rectified already"', facts: "replies to a recorded OPEN issue, no photo", intent: "closure_missing_photo", why: "A completion claim without the after-photo." },
    { message: "Photo, no words", facts: "replies to a recorded OPEN issue", intent: "closure_missing_description", why: "An after-photo with nothing said about it." },
    { message: 'Photo: "settled"', facts: "replies to a recorded CLOSED issue", intent: "late_after_photo", why: "Evidence for an issue that was closed without it." },
    { message: '"same again"', facts: "replies to a recorded CLOSED issue", intent: "recurrence", why: "The same problem has come back." },
    { message: '"Mohamed Shafiee 6591234567"', facts: "replies to the desk's '👤 Who should this safety issue be assigned to?'", intent: "pic_answer", why: "Names the person responsible." },
    { message: "(deleted)", facts: "deletion; the deleted message created issue #12", intent: "deleted_new_issue", why: "Withdrawing the report undoes the issue." },
    { message: "(deleted)", facts: "deletion; the deleted message closed issue #7", intent: "deleted_closure", why: "Withdrawing the closure reopens the issue." },
    { message: '"will settle by tmr"', facts: "replies to a recorded OPEN issue", intent: "other", why: "A promise is not a fix." },
    { message: 'Photo: "TOL 2 Carpark Full"', facts: "fresh message, photo attached", intent: "other", why: "A capacity notice; nothing is unsafe." },
  ],

  /** What the classifier understands. All optional; anything absent is unknown. */
  features: {
    "message.kind": "text | photo | video | document | voice | sticker",
    "message.text": "the message's text or caption",
    "message.hasText": "true when there is any text after trimming",
    "message.hasPhoto": "a readable photo is attached to this message",
    "message.isReply": "this message quotes an earlier one",
    "message.isEdit": "this message is an edit of an earlier one",
    "message.isDeletion": "this message is a deletion of an earlier one",
    "message.statedSeverity": "P1 | P2 | P3 when the sender wrote one, else null",
    "message.mentions": "number of @mentions",
    "quoted.text": "the quoted message's text",
    "quoted.fromThisSystem": "the quoted message was sent by the safety desk itself",
    "quoted.systemMessage": "issue_reminder | photo_request | pic_question | message — only when sent by the desk",
    "quoted.issueNumber": "for a desk reminder, the issue it names",
    "quoted.isPhoto": "the quoted message is itself a photo",
    "quotedIssue.status": "open | closed | not_an_issue — the register's answer about the quoted message",
    "earlierPhoto.unrecorded": "this message describes an earlier photo that had no description and was never recorded",
    "original.effect": "for an edit or deletion: created_issue | closed_issue | added_after_photo | answered_pic | none",
    "original.text": "for an edit or deletion: the original message's text",
    "project.requiresSeverity": "this project requires every new report to state P1/P2/P3",
  },
};

module.exports = { SAFETY_DOMAIN };
