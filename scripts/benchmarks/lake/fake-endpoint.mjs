#!/usr/bin/env node
// Local stand-in for ingest + API + an S3 bucket, for the smoke test only. It checks shapes, not auth or signatures.
import { createServer } from "node:http";
import zlib from "node:zlib";

export function startFake({ port = 0, host = "127.0.0.1" } = {}) {
  const stats = { otlp: {}, queries: {}, s3: { put: 0, get: 0, head: 0, del: 0, list: 0 }, rejects: 0 };
  const objects = new Map();
  const traceIds = [];

  const json = (res, status, body) => {
    res.writeHead(status, { "content-type": "application/json", "server-timing": `lake;dur=${(5 + Math.random() * 10).toFixed(1)}` });
    res.end(JSON.stringify(body));
  };
  const read = (req) =>
    new Promise((resolve, reject) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://fake");
    const path = url.pathname;
    const body = await read(req);
    const auth = req.headers.authorization ?? req.headers.cookie ?? "";
    if (!auth) {
      stats.rejects++;
      return json(res, 401, { message: "missing auth" });
    }

    const otlp = /^\/v1\/(logs|traces|metrics)$/.exec(path);
    if (otlp && req.method === "POST") {
      const enc = String(req.headers["content-encoding"] ?? "");
      let raw;
      try {
        raw = enc.includes("gzip") ? zlib.gunzipSync(body) : enc.includes("zstd") ? zlib.zstdDecompressSync(body) : body;
        const doc = JSON.parse(raw.toString("utf8"));
        const root = doc.resourceLogs ?? doc.resourceSpans ?? doc.resourceMetrics;
        if (!Array.isArray(root) || !root.length) throw new Error("empty OTLP body");
        if (otlp[1] === "traces") for (const rs of root.slice(0, 1)) traceIds.push(rs.scopeSpans[0].spans[0].traceId);
      } catch (e) {
        stats.rejects++;
        return json(res, 400, { message: e.message });
      }
      const s = (stats.otlp[otlp[1]] ??= { requests: 0, wireBytes: 0, rawBytes: 0 });
      s.requests++;
      s.wireBytes += body.length;
      s.rawBytes += raw.length;
      return json(res, 200, {});
    }

    const route = `${req.method} ${path.replace(/^\/v1\/trace\/[0-9a-f]+$/, "/v1/trace/:id")}`;
    // Latency grows with the window so the report shows distinct rows per window.
    const delay = (ms) => {
      let minutes = Number(url.searchParams.get("minutes")) || 60;
      try {
        minutes = JSON.parse(body).minutes || minutes;
      } catch {}
      return new Promise((r) => setTimeout(r, ms + Math.log10(minutes) * 3 + Math.random() * 5));
    };
    const queryRoutes = {
      "GET /v1/logs": () => ({ logs: [{ body: "fake" }], offset: 0 }),
      "POST /v1/search/histogram": () => ({ buckets: [{ t: Date.now(), count: 3 }] }),
      "POST /v1/search/traces": () => ({ traces: traceIds.slice(-20).map((traceId) => ({ traceId })), found: traceIds.length }),
      "GET /v1/trace/:id": () => ({ spans: [{ name: "fake" }], totalSpans: 1 }),
      "POST /v1/explorer/query": () => ({ series: [{ group: "checkout", points: [[Date.now(), 12.5]] }] }),
    };
    if (queryRoutes[route]) {
      stats.queries[route] = (stats.queries[route] ?? 0) + 1;
      await delay(5);
      return json(res, 200, queryRoutes[route]());
    }

    // Path-style S3: /<bucket>/<key> and /<bucket>?list-type=2
    const [, bucket, ...rest] = path.split("/");
    const key = rest.map(decodeURIComponent).join("/");
    if (bucket && !key && req.method === "GET" && url.searchParams.get("list-type") === "2") {
      stats.s3.list++;
      const prefix = url.searchParams.get("prefix") ?? "";
      const items = [...objects].filter(([k]) => k.startsWith(prefix));
      res.writeHead(200, { "content-type": "application/xml" });
      return res.end(`<?xml version="1.0"?><ListBucketResult><IsTruncated>false</IsTruncated>${items.map(([k, v]) => `<Contents><Key>${k}</Key><Size>${v.length}</Size></Contents>`).join("")}</ListBucketResult>`);
    }
    if (bucket && key) {
      if (req.method === "PUT") {
        stats.s3.put++;
        objects.set(key, body);
        res.writeHead(200);
        return res.end();
      }
      const obj = objects.get(key);
      if (!obj) {
        res.writeHead(404);
        return res.end();
      }
      if (req.method === "HEAD") {
        stats.s3.head++;
        res.writeHead(200, { "content-length": obj.length });
        return res.end();
      }
      if (req.method === "DELETE") {
        stats.s3.del++;
        objects.delete(key);
        res.writeHead(204);
        return res.end();
      }
      if (req.method === "GET") {
        stats.s3.get++;
        const m = /bytes=(\d+)-(\d+)/.exec(req.headers.range ?? "");
        const part = m ? obj.subarray(Number(m[1]), Number(m[2]) + 1) : obj;
        await delay(2);
        res.writeHead(m ? 206 : 200, { "content-length": part.length });
        return res.end(part);
      }
    }
    json(res, 404, { message: `fake has no ${route}` });
  });

  return new Promise((resolve) => server.listen(port, host, () => resolve({ server, stats, objects, url: `http://${host}:${server.address().port}` })));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const f = await startFake({ port: Number(process.env.PORT ?? 4999) });
  console.log(`fake ingest/API/S3 on ${f.url}`);
}
