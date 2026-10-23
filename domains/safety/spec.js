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
 * `offeredOnlyWhen` keeps an intent out of the choice entirely unless the caller supplied
 * those facts — for intents that only exist under a project setting (a required severity).
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
        "a photo or video is available (on this message, or an earlier undescribed photo this message describes)",
        "names or @mentions who should act on it",
      ],
      notWhen: [
        "the words only acknowledge, ask, schedule, or promise",
        "a photo alone with no words",
        "it is about an issue already recorded (that is a closure, recurrence or edit)",
      ],
      requires: { all: { "message.hasText": true }, anyOf: [{ "message.hasPhoto": true }, { "message.kind": "video" }, { "earlierPhoto.unrecorded": true }] },
    },
    {
      id: "new_issue_missing_pic",
      meaning: "A new safety issue, complete except that nobody is named as responsible for fixing it. The photo may be the one it replies to.",
      signals: ["everything that makes a new_issue, but no person is named or @mentioned as responsible"],
      notWhen: ["it is missing a photo (that is new_issue_missing_photo)"],
      requires: { all: { "message.hasText": true }, anyOf: [{ "message.hasPhoto": true }, { "message.kind": "video" }, { "earlierPhoto.unrecorded": true }] },
    },
    {
      id: "new_issue_missing_photo",
      meaning: "Clearly a new safety issue being reported, but no photo is available anywhere to record it with — none on the message, and none in the message it replies to.",
      signals: ["describes an unsafe condition in words", "no photo on the message, and it does not reply to a photo that shows the problem"],
      notWhen: [
        "it is chatter, a question or a reminder rather than a report",
        "a video is attached — a captioned video is recorded like a photo",
        "a document or voice note is attached — the sender did attach something",
        "it replies to a photo that shows the problem — that photo is the record's photo",
      ],
      requires: { all: { "message.hasText": true, "message.hasPhoto": false, "earlierPhoto.unrecorded": false } },
    },
    {
      id: "new_issue_missing_severity",
      meaning: "A new safety issue on a project that requires every report to state a severity (P1, P2 or P3), and none was stated.",
      signals: ["a new issue in every other respect", "this project requires a stated severity", "no P1/P2/P3 is stated"],
      notWhen: ["the project does not require a severity"],
      requires: { all: { "project.requiresSeverity": true, "message.statedSeverity": null, "message.hasText": true } },
      // Configuration, not meaning: only offered when the caller says the project requires a severity.
      offeredOnlyWhen: { "project.requiresSeverity": true },
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
      meaning: "Says a recorded issue has happened again ('same', 'same again', 'this one again'). Rare: choose it only when the words say the same problem is back and nothing else fits.",
      signals: ["replies to a recorded issue (open or closed)", "says it is the same problem, again"],
      notWhen: ["the same KIND of hazard at a different place, with its own description — judge that as a new issue"],
      requires: { all: { "message.isReply": true, "message.hasText": true }, anyOf: [{ "quotedIssue.status": "open" }, { "quotedIssue.status": "closed" }] },
    },
    {
      id: "pic_answer",
      meaning: "Answers the desk's question about who is responsible for an issue: by naming or @mentioning someone, or by the sender taking it on themselves.",
      signals: [
        "replies to the desk's person-in-charge question",
        "names a person, often with a phone number, or @mentions them",
        "or the sender takes charge — 'I'll handle it', 'I'll update the photos once done' — which makes the sender the person responsible",
      ],
      notWhen: ["nobody is named and the sender does not take it on (a question back, 'noted', a complaint)"],
      requires: { all: { "message.isReply": true, "quoted.systemMessage": "pic_question" } },
    },


  ],

  /**
   * CORRECTIONS — edits and deletions, decided in two passes, never by the model directly.
   *
   * A deletion undoes whatever the original message meant; an edit corrects it. So the
   * ORIGINAL is rebuilt as it was when sent (its own text, photo, reply and earlier
   * messages) and classified like any live message. Its intent is then mapped here.
   *
   * Deletion: an original that changed nothing (it only prompted the sender, or was not
   * a safety intent) maps to "other".
   * Edit: an original that recorded something maps to an edit intent; otherwise the
   * edited text is classified as a new message, because nothing was recorded to correct.
   *
   * ⚠️ This says what the original was MEANT to do, not proof that it was done (a closure
   * the close handler rejected still classifies as a closure). Whoever acts checks.
   */
  corrections: {
    deletion: {
      new_issue: "deleted_new_issue",
      new_issue_missing_pic: "deleted_new_issue",
      recurrence: "deleted_new_issue",
      closure: "deleted_closure",
      late_after_photo: "deleted_after_photo",
      pic_answer: "deleted_pic_answer",
    },
    edit: {
      new_issue: "edited_new_issue",
      new_issue_missing_pic: "edited_new_issue",
      recurrence: "edited_new_issue",
      closure: "edited_closure",
    },
    intents: {
      deleted_new_issue: "Deletes a message that created an issue (including a 'same' copy). Undo the issue.",
      deleted_closure: "Deletes a message that closed an issue. Undo the closure.",
      deleted_after_photo: "Deletes a message that added an after-photo to a closed issue. Undo the photo.",
      deleted_pic_answer: "Deletes a message that named the person responsible. Undo the assignment.",
      edited_new_issue: "Edits a message that created an issue. The record follows the corrected text.",
      edited_closure: "Edits a message that closed an issue.",
    },
  },

  instructions: [
    "Judge a reply by what it SAYS, not by the fact that it is a reply. Replying is just how people talk in a group chat.",
    "A reply about a recorded issue is about that issue — closing it, sending its after-photo, saying it happened again. Only treat it so when the facts say the quoted message is a recorded issue.",
    "A reply can still carry a NEW issue: when it answers the desk's request for a photo; when it reports a problem shown in the photo it replies to, and that photo was not already reported (no caption, or a caption that reported nothing, like 'housekeeping photos') — that photo is then the issue's photo; or when it brings its own photo and words describing a different hazard. A reply that only presses on a photo already reported as a problem is not a new issue.",
    "The words decide, not the photo. A real report names the safety situation or the remedy in its words. Length and format never decide: two words can be a report ('@person FE stand', 'P1 housekeeping area'), and a filled report template is not one when its description names nothing. A place, a route or a label alone ('from Gate-1', 'level 3 corridor') is not a report, however the photo looks, even with arrows or markings drawn on it.",
    "A short reply is read with the conversation around it. The same fragment can caption an earlier photo — naming what is missing or what to do — or answer a question someone just asked. Let the earlier messages decide which.",
    "A promise, an acknowledgement or a question is never a closure. Only words that claim the work is done.",
    "People write fast, in fragments, with typos, Singlish, mixed languages and @mentions. Read for meaning, not grammar.",
    "A safety issue observes a condition on site that someone must put right. Records of work done well — housekeeping done, an inspection witnessed, a drill held, a good observation — are not safety issues; they may belong to another team (housekeeping), so they are other. Messages that schedule, announce, recap, track or log are not — progress digests, weather advisories, facility status, patrol logs, reminders about tracked items, attendance records, who came and went, workforce numbers, greetings and chatter — even with a photo and urgent words.",
    "A request asks for something to be provided — manpower, a delivery, access, a permit — and stays a request, even when it is about safety; it is not an issue for someone to rectify. A directive to put right something shown wrong is the sender reporting it.",
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
    { message: '"I\'ll update the photos once the cutting is done"', facts: "replies to the desk's '⚠️ Who will be in charge of this safety issue?'", intent: "pic_answer", why: "The sender takes it on, so the sender is the person responsible." },
    { message: '"will settle by tmr"', facts: "replies to a recorded OPEN issue", intent: "other", why: "A promise is not a fix." },
    { message: 'Photo: "CGW night shift housekeeping done, area cleared"', facts: "fresh message, photo attached", intent: "other", why: "A record of work done, not a condition to put right; another team may take it." },
    { message: '"Lightning alert CAT 1 now. Stop all lifting, all workers take shelter"', facts: "fresh message, no photo", intent: "other", why: "An advisory about the weather, not a condition on site." },
    { message: '"hang up fire extinguisher"', facts: "replies to a picture the desk itself posted", intent: "other", why: "The desk posts its register pages; this is follow-up on an item already tracked." },
    { message: 'Photo: "Here I need a access for lifting team"', facts: "fresh message, photo attached", intent: "other", why: "A request for access to be provided, not something wrong to be rectified." },
    { message: 'Photo: "@Ah Seng arrange to send out ur hardcore bro"', facts: "fresh message, photo of rubble on a walkway", intent: "new_issue", why: "A directive to clear something that should not be there." },
    { message: 'Photo: "TOL 2 Carpark Full"', facts: "fresh message, photo attached", intent: "other", why: "A capacity notice; nothing is unsafe." },
    { message: 'Photo: "P1 pump room housekeeping area"', facts: "fresh message, photo attached, nobody named", intent: "new_issue_missing_pic", why: "A stated priority on a named area flags a problem; the photo may not make it obvious to an outsider, and does not need to." },
  ],

  /** What the classifier understands. All optional; anything absent is unknown. */
  features: {
    "message.kind": "text | photo | video | document | voice | sticker",
    "message.text": "the message's text or caption",
    "message.hasText": "true when there is any text after trimming",
    "message.hasPhoto": "a readable photo is attached to this message",
    "message.isReply": "this message quotes an earlier one",
    "message.statedSeverity": "P1 | P2 | P3 when the sender wrote one, else null",
    "message.mentions": "number of @mentions",
    "quoted.text": "the quoted message's text",
    "quoted.fromThisSystem": "the quoted message was sent by the safety desk itself",
    "quoted.systemMessage": "issue_reminder | photo_request | pic_question | message — only when sent by the desk",
    "quoted.issueNumber": "for a desk reminder, the issue it names",
    "quoted.isPhoto": "the quoted message is itself a photo",
    "quoted.media": "photo | video | document | voice note | sticker | none — what the quoted message carried",
    "quotedIssue.status": "open | closed | not_an_issue — the register's answer about the quoted message",
    "earlierPhoto.unrecorded": "this message describes an earlier photo that had no description and was never recorded",
    "project.requiresSeverity": "this project requires every new report to state P1/P2/P3",
  },
};

module.exports = { SAFETY_DOMAIN };
