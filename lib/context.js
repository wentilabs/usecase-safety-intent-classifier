"use strict";

/**
 * lib/context.js — fill in the conversation slice from the chat archive.
 *
 * A caller may send only the message. This reads the rest from the listener's archive
 * (Supabase `whatsapp_listener`): the two earlier messages with text, the message it
 * replies to, and — for an edit or a deletion — the original message. READ-ONLY.
 *
 * Whatever the caller DID send wins: retrieval only fills gaps.
 *
 * ⚠️ Several bots can sit in one group, and each bot's listener archives every message,
 * so one message can appear as several rows. Rows are deduplicated by messageId,
 * preferring this deployment's own copy (clientIdentifier). "Did the desk send this"
 * is judged from OUR copy: `true_` in messageIdSerialized means "sent by the bot whose
 * listener recorded this row", so on another bot's row it means THAT bot sent it.
 *
 * Uses Supabase's REST endpoint through fetch — no dependencies.
 */

const { present } = require("./conversation");

const COLUMNS = "messageId,messageIdSerialized,body,type,sender,timestamp,created_at,clientIdentifier,isDeleted,mediaFilename,quotedMessageId,previousBody";

/** Was this archive row written by THIS deployment's bot? */
function sentByUs(row, ours) {
  if (!row) return null;
  const fromMe = String(row.messageIdSerialized || "").toLowerCase().startsWith("true_");
  const rowClient = String(row.clientIdentifier || "").trim();
  if (!rowClient) return fromMe; // older rows predate per-listener archiving
  return fromMe && rowClient === ours;
}

/** One row per message, preferring our own listener's copy. */
function dedupe(rows, ours) {
  const byId = new Map();
  for (const row of rows || []) {
    const id = row.messageId || row.messageIdSerialized;
    const have = byId.get(id);
    if (!have || (have.clientIdentifier !== ours && row.clientIdentifier === ours)) byId.set(id, row);
  }
  return [...byId.values()];
}

/** An archive row as a message for lib/conversation.js. */
const asMessage = (row, ours) =>
  row && { ...row, fromThisSystem: sentByUs(row, ours), at: row.created_at || row.timestamp };

function client({ url, key, fetchImpl }) {
  const base = String(url || "").replace(/\/+$/, "");
  return async (params) => {
    const qs = new URLSearchParams({ select: COLUMNS, ...params });
    const res = await (fetchImpl || fetch)(`${base}/rest/v1/whatsapp_listener?${qs}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!res.ok) throw new Error(`archive read failed: ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
    return res.json();
  };
}

/**
 * @param {object} request { message, recent?, quoted?, facts? }
 * @param {{url?: string, key?: string, ours?: string, fetchImpl?: Function}} [deps]
 * @returns {Promise<{request: object, retrieved: string[]}>} the request with gaps filled, and what was read
 */
async function fillContext(request, deps = {}) {
  const url = deps.url ?? process.env.SUPABASE_URL;
  const key = deps.key ?? process.env.SUPABASE_SECRET_KEY;
  const m = request.message || {};
  // "Ours" = the listener that delivered THIS message (the payload's clientIdentifier).
  const ours = String(deps.ours ?? m.clientIdentifier ?? "").trim();
  const chat = m.from || m.chatId;
  const retrieved = [];
  if (!url || !key || !chat) return { request, retrieved };

  const read = client({ url, key, fetchImpl: deps.fetchImpl });
  const out = { ...request, facts: { ...(request.facts || {}) } };

  // ── the two earlier messages with text ──
  if (request.recent === undefined && m.timestamp != null) {
    const rows = await read({ from: `eq.${chat}`, timestamp: `lt.${m.timestamp}`, order: "timestamp.desc", limit: "40" });
    out.recent = dedupe(rows, ours)
      .filter((r) => r.messageId !== m.messageId && !r.isDeleted && String(r.body || "").trim())
      .slice(0, 2)
      .reverse()
      .map((r) => asMessage(r, ours));
    retrieved.push("recent");
  }

  // ── the message it replies to ──
  if (request.quoted === undefined && present(m.quotedMessageId)) {
    const rows = await read({ from: `eq.${chat}`, messageId: `eq.${m.quotedMessageId}`, order: "created_at.desc", limit: "10" });
    const row = dedupe(rows, ours)[0];
    if (row) {
      out.quoted = asMessage(row, ours);
      retrieved.push("quoted");
    }
  }

  // ── an edit: the listener keeps the text before the edit ──
  const isEdit = m.isEdited === true || m.isEdit === true;
  if (isEdit && out.facts["original.text"] === undefined && m.previousBody) {
    out.facts["original.text"] = m.previousBody;
    retrieved.push("original (edit)");
  }

  // ── a deletion: the original is the row the deletion points at ──
  const isDeletion = m.isDeleted === true || m.isDeletion === true;
  if (isDeletion && out.facts["original.text"] === undefined && m.parentMsgKey) {
    const rows = await read({ from: `eq.${chat}`, messageIdSerialized: `eq.${m.parentMsgKey}`, order: "created_at.desc", limit: "5" });
    const row = rows && rows[0];
    if (row && String(row.body || "").trim()) {
      out.facts["original.text"] = row.body;
      retrieved.push("original (deletion)");
    }
  }

  return { request: out, retrieved };
}

module.exports = { fillContext, sentByUs, dedupe };
