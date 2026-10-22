"use strict";

/**
 * lib/prompt.js — the instructions the model reads, built from the requested domains.
 *
 * Written as a briefing for a sensible, experienced person, not as rules for a parser:
 * the job, how to read the conversation, then each domain's intents, guidance and
 * worked examples, then the one `other`. Everything domain-specific comes from the
 * domain specs, so adding a domain needs no change here.
 */

const ROLE = `You read a construction site's group chat and say what the sender of one message intends.

You are given the message to classify, the two messages with text that came just before it, and the message it replies to (if any). Read them the way a person scrolling up the chat would: the earlier lines often explain the newest one — a photo's description sent a moment later, a "same" that only makes sense after the line above, the question an answer is answering.

Each earlier line says how long before the message it was sent. A line from minutes ago is usually part of the same exchange; one from hours or days ago may be unrelated. Weigh it accordingly — the gap is a consideration, not a cut-off.

Every message is labelled with the media it carried, e.g. [media: photo] or [media: none]. Only the message you are classifying has its photo attached for you to look at; for the others you know a photo was there, not what it shows.

Treat that photo as SUPPORTING evidence, never as the deciding one. Site photos often show things you will not fully understand — equipment, work in progress, conditions that only someone on site can judge. What the sender writes, and the conversation around it, decide the intent:
- If the words say there is a problem (a stated priority, "housekeeping", "unsafe", "do better", a named area flagged), do not dismiss it because the photo looks harmless or unclear to you.
- If the words say nothing about a problem, do not make one up from the photo.
- Do not rest your reason on what you think the photo shows; rest it on what the sender said.

Sometimes you are also told facts the system already knows (for example, that the quoted message is a recorded issue that is still open). Those facts are true. Anything you are not told is unknown — do not assume it either way.

People write fast, in fragments, with typos, Singlish, mixed languages and @mentions. Read for meaning, not grammar. Choose exactly one intent.`;

function renderDomain(d, qualify, offered) {
  const intents = d.intents
    .filter((i) => offered.has(qualify(d.domain, i.id)))
    .map((i) => {
      const parts = [`- ${qualify(d.domain, i.id)}: ${i.meaning}`];
      if (i.signals?.length) parts.push(`    Usually: ${i.signals.join("; ")}.`);
      if (i.notWhen?.length) parts.push(`    Not when: ${i.notWhen.join("; ")}.`);
      return parts.join("\n");
    })
    .join("\n");
  const examples = d.examples
    .filter((e) => e.intent === "other" || offered.has(qualify(d.domain, e.intent)))
    .map((e) => `- ${e.message}${e.facts ? ` [${e.facts}]` : ""} → ${e.intent === "other" ? "other" : qualify(d.domain, e.intent)} — ${e.why}`)
    .join("\n");
  return [
    `## Domain: ${d.domain} — ${d.title}`,
    d.summary,
    `### Intents\n${intents}`,
    `### How to read messages for this domain\n${d.instructions.map((x) => `- ${x}`).join("\n")}`,
    `### Worked examples\n${examples}`,
  ].join("\n\n");
}

/**
 * @param {{domains: object[], intents: object[]}} composed from lib/compose.js
 * @param {(domain: string, id: string) => string} qualify
 */
function buildInstructions(composed, qualify) {
  const other = composed.intents.find((i) => i.id === "other");
  return [
    ROLE,
    ...composed.domains.map((d) => renderDomain(d, qualify, new Set(composed.intents.map((i) => i.id)))),
    `## When none applies\n- other: ${other.meaning}`,
    "Answer by calling the classify tool once.",
  ].join("\n\n");
}

module.exports = { buildInstructions };
