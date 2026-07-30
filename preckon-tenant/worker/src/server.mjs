// ── The AI worker (§5.1): stateless, NO database access. It consumes a
// JobEnvelope, runs the (stub) agent, and returns a JobResult by calling back to
// Core's /internal endpoint. It cannot write the artifact store — Core
// materializes the proposals. This process has no DB driver and no DB env; the
// trust boundary is structural, not just conventional.
import http from "node:http";
import { computeJobResult } from "./agents.mjs";

const PORT = Number(process.env.PORT ?? 4000);
const CORE_URL = process.env.CORE_URL ?? "http://localhost:3100";
const TOKEN = process.env.INTERNAL_SERVICE_TOKEN ?? "";

async function postResult(result) {
  const url = `${CORE_URL}/api/internal/jobs/${result.job_id}/result`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(result),
    });
    if (!res.ok) console.error(`[worker] callback ${result.job_id} failed: ${res.status}`);
  } catch (err) {
    console.error(`[worker] callback ${result.job_id} error:`, err.message);
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/healthz") {
    res.writeHead(200).end("ok");
    return;
  }
  // The BIM assistant's loop runs in Core (it owns the document), but the API
  // key stays here — Core never sees it. This is a thin, authenticated proxy to
  // Anthropic, nothing more: no project state is read or held.
  if (req.method === "POST" && req.url === "/claude") {
    const auth = req.headers["authorization"]?.replace(/^Bearer\s+/i, "");
    if (!TOKEN || auth !== TOKEN) { res.writeHead(401).end("unauthorized"); return; }
    if (!process.env.ANTHROPIC_API_KEY) {
      res.writeHead(503, { "content-type": "application/json" })
         .end(JSON.stringify({ error: "ANTHROPIC_API_KEY is not set on the worker" }));
      return;
    }
    let body;
    try { body = JSON.parse(await readBody(req)); }
    catch { res.writeHead(400).end("bad json"); return; }
    try {
      const upstream = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: body.model,
          max_tokens: body.maxTokens ?? 2000,
          system: body.system,
          messages: body.messages ?? [],
          ...(body.tools ? { tools: body.tools } : {}),
        }),
      });
      const text = await upstream.text();
      res.writeHead(upstream.status, { "content-type": "application/json" }).end(text);
    } catch (e) {
      res.writeHead(502, { "content-type": "application/json" })
         .end(JSON.stringify({ error: String(e?.message ?? e) }));
    }
    return;
  }

  if (req.method === "POST" && req.url === "/run") {
    const auth = req.headers["authorization"]?.replace(/^Bearer\s+/i, "");
    if (!TOKEN || auth !== TOKEN) {
      res.writeHead(401).end("unauthorized");
      return;
    }
    let envelope;
    try {
      envelope = JSON.parse(await readBody(req));
    } catch {
      res.writeHead(400).end("bad json");
      return;
    }
    // Ack immediately; process + call back asynchronously (§5.4 transport).
    res.writeHead(202).end("accepted");
    setImmediate(async () => {
      try {
        const result = await computeJobResult(envelope);
        await postResult(result);
      } catch (err) {
        await postResult({ job_id: envelope.job_id, status: "failed", error: { message: err.message } });
      }
    });
    return;
  }
  res.writeHead(404).end("not found");
});

server.listen(PORT, () => console.log(`[worker] listening on :${PORT} — Core at ${CORE_URL}`));
