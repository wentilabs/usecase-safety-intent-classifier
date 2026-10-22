"use strict";

/** app.js — local server. `npm start`, or `node app.js --port 4400`. */

const http = require("http");
const { handle } = require("./routes");

const args = process.argv.slice(2);
const PORT = Number(args.includes("--port") ? args[args.indexOf("--port") + 1] : 4400);

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    let raw = "";
    for await (const chunk of req) raw += chunk;
    let body = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "body is not JSON" }));
    }
    const { status, body: out } = await handle(req.method, url.pathname, Object.fromEntries(url.searchParams), body);
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(out, null, 2));
  })
  .listen(PORT, "127.0.0.1", () => console.log(`safety intent classifier: http://127.0.0.1:${PORT}`));
