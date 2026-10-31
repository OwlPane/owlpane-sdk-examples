#!/usr/bin/env node
/**
 * Creates dogfood console projects + ingest keys (same flow as Projects & keys → New project).
 *
 *   node scripts/onboard-dogfood.mjs --write-env
 *
 * Env:
 *   OWLPANE_API_URL          default http://127.0.0.1:4100 (SaaS: see .env.saas.example)
 *   OWLPANE_INGEST_URL       OTLP gateway (console Setup or OWLPANE_PUBLIC_INGEST_URL on API)
 *   OWLPANE_ONBOARD_EMAIL    default scale@owlpane.test
 *   OWLPANE_ONBOARD_PASSWORD default owlpane
 *   OWLPANE_ORG_SLUG         default scale
 *   OWLPANE_INGEST_URL       written to .env (default http://127.0.0.1:4318)
 *   OWLPANE_ENVIRONMENT      default development
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dir = dirname(fileURLToPath(import.meta.url));
const examplesRoot = join(__dir, "..");
const manifest = JSON.parse(
  readFileSync(join(examplesRoot, "dogfood.manifest.json"), "utf8"),
);

const API = (process.env.OWLPANE_API_URL ?? "http://127.0.0.1:4100").replace(/\/+$/, "");
const EMAIL = process.env.OWLPANE_ONBOARD_EMAIL ?? "scale@owlpane.test";
const PASSWORD = process.env.OWLPANE_ONBOARD_PASSWORD ?? "owlpane";
const ORG_SLUG = (process.env.OWLPANE_ORG_SLUG ?? "scale").trim().toLowerCase();
const ENVIRONMENT = process.env.OWLPANE_ENVIRONMENT ?? "development";
const API_IS_REMOTE = !/127\.0\.0\.1|localhost/.test(API);
const DEFAULT_INGEST = API_IS_REMOTE
  ? (process.env.OWLPANE_SAAS_INGEST_LOCAL_URL ?? "http://127.0.0.1:14318")
  : "http://127.0.0.1:4318";
const INGEST_URL = (process.env.OWLPANE_INGEST_URL ?? DEFAULT_INGEST).replace(/\/+$/, "");
const writeEnv = process.argv.includes("--write-env");
const rotateKeys = process.argv.includes("--rotate-keys");
const statusOnly = process.argv.includes("--status");

function loadExamplesEnv() {
  const envPath = join(examplesRoot, ".env");
  const out = {};
  try {
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* no .env yet */
  }
  return out;
}

/** True when ingest accepts this key (does not mutate first_event_at). */
async function ingestKeyWorks(key) {
  if (!key || !/^owl_ing_[a-f0-9]{48}$/.test(key)) return false;
  try {
    const res = await fetch(`${INGEST_URL}/v1/traces`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ resourceSpans: [] }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 401 || res.status === 403) return false;
    if (res.status === 503) return false;
    return res.ok;
  } catch {
    return false;
  }
}

/** Update ingest URL, environment, and per-app keys without dropping SaaS login / API URLs. */
function mergeWriteEnv(envPath, patch) {
  let text = "";
  try {
    text = readFileSync(envPath, "utf8");
  } catch {
    text = "";
  }
  const lines = text.split("\n");
  const setKey = (key, value) => {
    const line = `${key}=${value}`;
    const i = lines.findIndex((l) => l.startsWith(`${key}=`));
    if (i >= 0) lines[i] = line;
    else lines.push(line);
  };
  for (const [key, value] of Object.entries(patch)) setKey(key, value);
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  writeFileSync(envPath, `${lines.join("\n")}\n`, "utf8");
}

async function api(path, { method = "GET", token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "User-Agent": "owlpane-sdk-dogfood-onboard/1.0",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const msg = data?.message ?? data?.error ?? text ?? res.statusText;
    throw new Error(`${method} ${path} → ${res.status}: ${msg}`);
  }
  return data;
}

async function main() {
  const login = await api("/v1/auth/login", {
    method: "POST",
    body: { email: EMAIL, password: PASSWORD },
  });
  const token = login.sessionToken;
  if (!token) {
    throw new Error(
      "Login did not return sessionToken (MFA enabled?). Set OWLPANE_SESSION_TOKEN from the console.",
    );
  }

  const { orgs } = await api("/v1/me", { token });
  const org =
    orgs.find((o) => o.slug?.toLowerCase() === ORG_SLUG) ??
    orgs.find((o) => o.name?.toLowerCase() === ORG_SLUG) ??
    orgs[0];
  if (!org) throw new Error("No organization on this account");

  const { projects } = await api(`/v1/orgs/${org.id}/projects`, { token });
  const envFile = loadExamplesEnv();

  if (statusOnly) {
    console.log(`Org: ${org.name} (${org.slug}) · API ${API} · ingest ${INGEST_URL} · env ${ENVIRONMENT}\n`);
    for (const app of manifest.apps) {
      const project = projects.find(
        (p) => p.name === app.project && p.environment === ENVIRONMENT,
      );
      const keyFromEnv = envFile[app.ingestKeyEnv] ?? "";
      const keyOk = project ? await ingestKeyWorks(keyFromEnv) : false;
      if (!project) {
        console.log(`  MISSING  ${app.project} (${ENVIRONMENT})`);
      } else {
        const seen = project.firstEventAt ? "RECEIVING" : "no events yet";
        console.log(
          `  OK       ${app.project} · ${seen} · .env key ${keyOk ? "valid" : "missing/invalid"}`,
        );
      }
    }
    console.log("\nCreate missing: node scripts/onboard-dogfood.mjs --write-env");
    console.log("Rotate keys:    node scripts/onboard-dogfood.mjs --write-env --rotate-keys");
    return;
  }

  const keysOut = {};

  for (const app of manifest.apps) {
    const name = app.project;
    let project = projects.find(
      (p) => p.name === name && p.environment === ENVIRONMENT,
    );
    let ingestKey;

    if (!project) {
      const created = await api(`/v1/orgs/${org.id}/projects`, {
        method: "POST",
        token,
        body: { name, environment: ENVIRONMENT },
      });
      project = created.project;
      ingestKey = created.ingestKey;
      console.log(`Created project ${name} (${ENVIRONMENT})`);
    } else {
      const existing = envFile[app.ingestKeyEnv] ?? "";
      if (!rotateKeys && (await ingestKeyWorks(existing))) {
        ingestKey = existing;
        console.log(`Project ${name} exists — reusing key from .env`);
      } else {
        const keyRes = await api(`/v1/projects/${project.id}/keys`, {
          method: "POST",
          token,
          body: { name: "sdk-dogfood-examples" },
        });
        ingestKey = keyRes.key;
        console.log(
          rotateKeys
            ? `Project ${name} exists — rotated ingest key (--rotate-keys)`
            : `Project ${name} exists — issued new ingest key (.env key invalid)`,
        );
      }
    }

    keysOut[app.ingestKeyEnv] = ingestKey;
  }

  if (writeEnv) {
    const envPath = join(examplesRoot, ".env");
    const patch = {
      OWLPANE_INGEST_URL: INGEST_URL,
      OWLPANE_ENVIRONMENT: ENVIRONMENT,
      ...Object.fromEntries(manifest.apps.map((a) => [a.ingestKeyEnv, keysOut[a.ingestKeyEnv]])),
    };
    mergeWriteEnv(envPath, patch);
    console.log(`Updated ${envPath} (merged keys; kept existing OWLPANE_API_URL / login vars)`);
    if (API_IS_REMOTE && INGEST_URL.includes("14318")) {
      console.log("Remote API: run ./scripts/saas-ingest-port-forward.sh start before emit/verify.");
    }
    const check = spawnSync(process.execPath, [join(examplesRoot, "scripts/check-saas-ingest.mjs")], {
      stdio: "pipe",
      encoding: "utf8",
    });
    if (check.status !== 0) {
      console.warn("WARN: check-saas-ingest.mjs failed (non-fatal after onboard):");
      console.warn(check.stderr || check.stdout || "unknown");
    }
  } else {
    console.log("\nIngest keys (also use --write-env to update examples/.env):\n");
    for (const app of manifest.apps) {
      console.log(`  ${app.project}: ${keysOut[app.ingestKeyEnv]}`);
    }
  }

  console.log(`\nOrg: ${org.name} (${org.slug}) · open Projects & keys to verify.`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
