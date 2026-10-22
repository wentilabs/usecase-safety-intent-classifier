"use strict";

/**
 * domains/safety/system-messages.js — the shapes of messages the safety desk itself sends.
 *
 * A reply's meaning often depends on WHAT it replies to, and three things it can reply to
 * are the desk's own messages, which have fixed, recognisable forms. Recognising them is
 * reading a format we wrote, not a judgement, so it is done in code and handed to the
 * model as a fact.
 *
 * ⚠️ A format is only trusted when the caller says the quoted message was sent by the
 * desk (`quoted.fromThisSystem === true`). Anyone can type "⚠️ Issue #1 still open".
 *
 * These mirror the Woh Hup base template (usecases/safety/notify.js,
 * issues/reminder-anchor.js, pic/linking-messages.js). A deployment with different
 * wording supplies its own via the request's `systemMessages` override.
 */

const DEFAULT_SYSTEM_MESSAGES = Object.freeze({
  /** First line of an individual open-issue reminder. Captures the issue number. */
  issueReminder: /^⚠️\s*Issue\s*#(\d+)(?:\s*\[([^\]]*)\])?\s+still open\s*$/,
  /** The create gate's request for a photo. Exact text. */
  photoRequest: "Please reply to or attach an image with this message to create a safety issue.",
  /** Every person-in-charge question starts with this. */
  picQuestionPrefix: "👤",
});

/**
 * Recognise one of the desk's own message shapes.
 * @param {string} text
 * @param {object} [formats]
 * @returns {{kind: "issue_reminder"|"photo_request"|"pic_question"|"message", issueNumber?: string, severity?: string|null}}
 */
function recogniseSystemMessage(text, formats = DEFAULT_SYSTEM_MESSAGES) {
  const body = String(text || "");
  const firstLine = body.split(/\r?\n/, 1)[0].trim();
  const reminder = formats.issueReminder.exec(firstLine);
  if (reminder) return { kind: "issue_reminder", issueNumber: reminder[1], severity: reminder[2] || null };
  if (body.trim() === formats.photoRequest) return { kind: "photo_request" };
  if (firstLine.startsWith(formats.picQuestionPrefix)) return { kind: "pic_question" };
  return { kind: "message" };
}

module.exports = { DEFAULT_SYSTEM_MESSAGES, recogniseSystemMessage };
