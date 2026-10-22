"use strict";

/**
 * lib/media.js — the ONE image the model sees: the photo on the message being classified.
 *
 * Every other message in the slice (the two earlier ones, the quoted one) is described
 * with a media label instead — "[media: photo]" — so the model knows a photo was there
 * without paying to look at it. One image per classification, by design.
 *
 * The listener archive stores media in Supabase Storage: bucket = the group's chat id,
 * object = mediaFilename. The photo is DOWNLOADED with the service key and sent to the
 * model inline, so no shareable link is ever created.
 *
 * Never throws: a photo that cannot be loaded returns null, and the conversation says
 * the photo could not be loaded.
 */

const MAX_BYTES = 8 * 1024 * 1024;

/**
 * @param {object} message the payload being classified
 * @param {{url?: string, key?: string, fetchImpl?: Function}} [deps]
 * @returns {Promise<string|null>} a data: URL, or null
 */
async function mainPhoto(message, deps = {}) {
  if (!message) return null;
  // The caller may hand the photo over directly.
  if (message.photoDataUrl) return message.photoDataUrl;
  const type = String(message.type || message.kind || "").toLowerCase();
  if (!["image", "photo"].includes(type) || !message.mediaFilename) return null;

  const url = String(deps.url ?? process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
  const key = deps.key ?? process.env.SUPABASE_SECRET_KEY;
  const bucket = message.from || message.chatId;
  if (!url || !key || !bucket) return null;

  try {
    const objectPath = String(message.mediaFilename).split("/").map(encodeURIComponent).join("/");
    const res = await (deps.fetchImpl || fetch)(`${url}/storage/v1/object/${encodeURIComponent(bucket)}/${objectPath}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!res.ok) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_BYTES) return null;
    const mime = message.mediaMimeType || res.headers.get("content-type") || "image/jpeg";
    return `data:${mime};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

module.exports = { mainPhoto };
