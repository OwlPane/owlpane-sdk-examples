import { createHash, createHmac } from "node:crypto";

export const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
export const sha256Hex = (data) => createHash("sha256").update(data).digest("hex");
const hmac = (key, data) => createHmac("sha256", key).update(data).digest();

// RFC 3986 encoding as SigV4 wants it: encodeURIComponent leaves !'()* alone.
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** SigV4 headers for one S3-compatible request (R2 uses region "auto"). Returns the headers to send, `authorization` included. */
export function signS3Request({ method, url, region, accessKeyId, secretAccessKey, headers = {}, payloadHash = EMPTY_SHA256, date = new Date() }) {
  const u = new URL(url);
  const amzDate = date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const all = { ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()])), host: u.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  const names = Object.keys(all).sort();
  const canonicalQuery = [...u.searchParams.entries()]
    .map(([k, v]) => [enc(k), enc(v)])
    .sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const canonicalPath = u.pathname.split("/").map((seg) => enc(decodeURIComponent(seg))).join("/") || "/";
  const canonical = [method.toUpperCase(), canonicalPath, canonicalQuery, names.map((n) => `${n}:${all[n]}\n`).join(""), names.join(";"), payloadHash].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonical)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), "s3"), "aws4_request");
  const signature = createHmac("sha256", key).update(toSign).digest("hex");
  const { host, ...rest } = all;
  return { ...rest, authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope},SignedHeaders=${names.join(";")},Signature=${signature}` };
}
