import { test } from "node:test";
import assert from "node:assert/strict";
import { signS3Request, EMPTY_SHA256 } from "../lib/sigv4.mjs";

// The worked "GET Object" example from the AWS Signature Version 4 docs for S3
// (sig-v4-header-based-auth). The credentials are AWS's published documentation placeholders.
test("matches the AWS documented signature for a ranged GET", () => {
  const h = signS3Request({
    method: "GET",
    url: "https://examplebucket.s3.amazonaws.com/test.txt",
    region: "us-east-1",
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    headers: { range: "bytes=0-9" },
    payloadHash: EMPTY_SHA256,
    date: new Date(Date.UTC(2013, 4, 24, 0, 0, 0)),
  });
  assert.equal(h["x-amz-date"], "20130524T000000Z");
  assert.equal(
    h.authorization,
    "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request," +
      "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date," +
      "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
  );
});

test("query parameters are sorted and encoded in the canonical request", () => {
  const a = signS3Request({
    method: "GET",
    url: "https://acct.r2.cloudflarestorage.com/bucket?prefix=a%2Fb&list-type=2",
    region: "auto",
    accessKeyId: "AKIDEXAMPLE",
    secretAccessKey: "secretEXAMPLE",
    headers: {},
    payloadHash: EMPTY_SHA256,
    date: new Date(Date.UTC(2026, 0, 1)),
  });
  const b = signS3Request({
    method: "GET",
    url: "https://acct.r2.cloudflarestorage.com/bucket?list-type=2&prefix=a%2Fb",
    region: "auto",
    accessKeyId: "AKIDEXAMPLE",
    secretAccessKey: "secretEXAMPLE",
    headers: {},
    payloadHash: EMPTY_SHA256,
    date: new Date(Date.UTC(2026, 0, 1)),
  });
  assert.equal(a.authorization, b.authorization);
  assert.match(a.authorization, /\/auto\/s3\/aws4_request/);
});
