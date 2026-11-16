import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Accepts `--name=value`, `--name value` and bare `--flag` (true). */
export function flag(name, fallback, argv = process.argv.slice(2)) {
  const i = argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i === -1) return fallback;
  if (argv[i].includes("=")) return argv[i].slice(argv[i].indexOf("=") + 1);
  const next = argv[i + 1];
  return next === undefined || next.startsWith("--") ? true : next;
}

export function env(...names) {
  for (const n of names) {
    const v = process.env[n]?.trim();
    if (v) return v;
  }
  return "";
}

export function requireEnv(...names) {
  const v = env(...names);
  if (!v) die(`Set ${names.join(" or ")} in the environment`);
  return v;
}

export function die(msg) {
  console.error(msg);
  process.exit(2);
}

// The gate is measured on staging; a 10 TB/month load generator pointed at production by accident is an incident.
const PRODUCTION_HOSTS = [/^(api|ingest|app|console)\.owlpane\.com$/i, /^owlpane\.com$/i];

export function guardHost(url, label) {
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    die(`${label} is not a URL: ${url}`);
  }
  if (PRODUCTION_HOSTS.some((re) => re.test(host)) && process.env.OWLPANE_BENCH_ALLOW_PRODUCTION !== "1") {
    die(`${label} points at production (${host}). This harness is for staging; set OWLPANE_BENCH_ALLOW_PRODUCTION=1 only with explicit sign-off.`);
  }
  return url.replace(/\/+$/, "");
}

export function runId(now = new Date()) {
  return now.toISOString().replace(/[-:]/g, "").replace(".", "-");
}

export function writeReport(outDir, name, json, markdown) {
  mkdirSync(outDir, { recursive: true });
  const base = join(outDir, name);
  writeFileSync(`${base}.json`, `${JSON.stringify(json, null, 2)}\n`);
  writeFileSync(`${base}.md`, markdown);
  return { json: `${base}.json`, md: `${base}.md` };
}

export const fmtBytes = (n) => {
  if (n == null) return "-";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1000 && i < u.length - 1) {
    v /= 1000;
    i++;
  }
  return `${v.toFixed(i ? 2 : 0)} ${u[i]}`;
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
