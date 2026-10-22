"use strict";

/** index.js — AWS Lambda handler (API Gateway HTTP API v2). */

const { handle } = require("./routes");

exports.handler = async (event) => {
  const method = event?.requestContext?.http?.method || event?.httpMethod || "GET";
  const path = event?.rawPath || event?.path || "/";
  let body = null;
  if (event?.body) {
    try {
      body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body);
    } catch {
      return { statusCode: 400, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "body is not JSON" }) };
    }
  }
  const { status, body: out } = await handle(method, path, event?.queryStringParameters || {}, body);
  return { statusCode: status, headers: { "Content-Type": "application/json" }, body: JSON.stringify(out) };
};
