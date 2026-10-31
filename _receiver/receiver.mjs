// Throwaway local OTLP/HTTP receiver for the examples. Listens on 127.0.0.1 (random port), never forwards anywhere.
// Usage: node receiver.mjs --port-file <file> --service <service.name> --span <span name> [--timeout 60]
// Exits 0 once a POST /v1/traces arrives with `Authorization: Bearer owl_ing_...`, a decodable body,
// resource service.name == --service and a span named --span. Exits 1 on timeout.
import http from "node:http";
import zlib from "node:zlib";
import fs from "node:fs";

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith("--") ? [...a, [x.slice(2), all[i + 1]]] : a), []));
const timeout = Number(args.timeout ?? 60) * 1000;

// Minimal protobuf wire reader: returns [{f, w, v}] where v is a Buffer for length-delimited fields.
function fields(buf) {
  const out = []; let i = 0;
  const varint = () => { let r = 0n, s = 0n, b; do { b = buf[i++]; r |= BigInt(b & 127) << s; s += 7n; } while (b & 128); return r; };
  while (i < buf.length) {
    const k = Number(varint()), f = k >> 3, w = k & 7;
    if (w === 0) out.push({ f, w, v: varint() });
    else if (w === 1) { out.push({ f, w, v: buf.subarray(i, i + 8) }); i += 8; }
    else if (w === 5) { out.push({ f, w, v: buf.subarray(i, i + 4) }); i += 4; }
    else if (w === 2) { const n = Number(varint()); out.push({ f, w, v: buf.subarray(i, i + n) }); i += n; }
    else throw new Error("bad wire type " + w);
  }
  return out;
}
const sub = (b, f) => fields(b).filter((x) => x.f === f).map((x) => x.v);

function decodeProto(buf) { // ExportTraceServiceRequest
  const res = [];
  for (const rs of sub(buf, 1)) {
    const attrs = {};
    for (const r of sub(rs, 1)) for (const kv of sub(r, 1)) {
      const key = sub(kv, 1)[0]?.toString(); const val = sub(kv, 2)[0];
      if (key && val) attrs[key] = sub(val, 1)[0]?.toString() ?? "(non-string)";
    }
    const spans = [];
    for (const ss of sub(rs, 2)) for (const sp of sub(ss, 2)) spans.push(sub(sp, 5)[0]?.toString());
    res.push({ attrs, spans });
  }
  return res;
}
function decodeJson(text) {
  return (JSON.parse(text).resourceSpans ?? []).map((rs) => ({
    attrs: Object.fromEntries((rs.resource?.attributes ?? []).map((a) => [a.key, a.value?.stringValue])),
    spans: (rs.scopeSpans ?? []).flatMap((s) => (s.spans ?? []).map((x) => x.name)),
  }));
}

const server = http.createServer((req, rq) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    let body = Buffer.concat(chunks);
    const auth = req.headers.authorization ?? "";
    const enc = req.headers["content-encoding"];
    const ct = req.headers["content-type"] ?? "";
    let rs = null, err = null;
    try {
      if (enc === "gzip") body = zlib.gunzipSync(body);
      if (req.method === "POST" && req.url === "/v1/traces") rs = /json/.test(ct) ? decodeJson(body.toString()) : decodeProto(body);
    } catch (e) { err = e.message; }
    console.log(`${req.method} ${req.url} content-type=${ct} encoding=${enc ?? "none"} bytes=${body.length}`);
    console.log(`  Authorization: ${auth.replace(/(owl_ing_.{4}).*/, "$1...")} (Bearer owl_ing_ prefix ok: ${/^Bearer owl_ing_\S+$/.test(auth)})`);
    if (rs) console.log(`  decoded: ${JSON.stringify(rs.map((r) => ({ "service.name": r.attrs["service.name"], "deployment.environment.name": r.attrs["deployment.environment.name"], "service.version": r.attrs["service.version"], spans: r.spans })))}`);
    if (err) console.log("  decode error: " + err);
    rq.writeHead(200, { "content-type": "application/json" }); rq.end("{}");
    const ok = /^Bearer owl_ing_\S+$/.test(auth) && rs?.some((r) => r.attrs["service.name"] === args.service && r.spans.includes(args.span));
    if (ok) { console.log(`RECEIVER OK: service.name=${args.service} span=${args.span} with Bearer owl_ing_ header`); setTimeout(() => process.exit(0), 50); }
  });
});
server.listen(0, "127.0.0.1", () => fs.writeFileSync(args["port-file"], String(server.address().port)));
setTimeout(() => { console.log("RECEIVER TIMEOUT: expected span not seen"); process.exit(1); }, timeout);
