#!/usr/bin/env python3
"""Reject committed Owlpane ingest tokens that look like live keys.

Allowed placeholders:
  owl_ing_EXAMPLE
  owl_ing_ followed by 48 zero digits
  tokens that contain REPLACE or EXAMPLE (documentation fillers)

Any other owl_ing_ token of 6 or more characters fails the build.
Real ingest keys are owl_ing_ plus 48 hex digits, so this allowlist
cannot hide one.
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOKEN_RE = re.compile(r"owl_ing_([A-Za-z0-9_]+)")
ZERO = "0" * 48
MIN_LEN = 6


def classify(token: str) -> str:
    upper = token.upper()
    if token == ZERO or "EXAMPLE" in upper or "REPLACE" in upper:
        return "ok"
    if len(token) >= MIN_LEN:
        return "reject"
    return "ok"


def self_test() -> None:
    expect = {
        "EXAMPLE": "ok",
        ZERO: "ok",
        "REPLACE_WITH_CONSOLE_KEY_48_HEX_CHARS________": "ok",
        "test_local_" + "key": "reject",
        "0123456789abcdef" * 3: "reject",
        "deadbeef" * 2: "reject",
        "abc": "ok",
    }
    failed = [f"{token} -> {classify(token)}, expected {want}" for token, want in expect.items() if classify(token) != want]
    if failed:
        print("placeholder policy self-test failed:", *failed, sep="\n", file=sys.stderr)
        sys.exit(1)


def scan_tree() -> list[str]:
    listed = subprocess.check_output(["git", "ls-files", "-z"], cwd=ROOT)
    findings: list[str] = []
    for raw in listed.split(b"\0"):
        if not raw:
            continue
        rel = raw.decode()
        path = ROOT / rel
        if not path.is_file():
            continue
        data = path.read_bytes()
        if b"\0" in data:
            continue
        text = data.decode("utf-8", "replace")
        for lineno, line in enumerate(text.splitlines(), 1):
            for match in TOKEN_RE.finditer(line):
                token = match.group(1)
                if classify(token) == "reject":
                    findings.append(f"{rel}:{lineno}: owl_ing_ token is not an obvious placeholder")
    return findings


def allowlist_is_tight() -> None:
    """The gitleaks allowlist may name owl_ing_EXAMPLE and nothing that hides a real key."""
    path = ROOT / ".gitleaks.toml"
    if not path.is_file():
        print("missing .gitleaks.toml", file=sys.stderr)
        sys.exit(1)
    text = path.read_text()
    if re.search(r"(?m)^paths\s*=", text):
        print(".gitleaks.toml path allowlist would hide future secrets", file=sys.stderr)
        sys.exit(1)
    patterns = re.findall(r"'''(.+?)'''", text, re.S)
    if not patterns:
        print(".gitleaks.toml has no allowlist regex", file=sys.stderr)
        sys.exit(1)
    realistic = "owl_ing_" + ("abcdef0123456789" * 3)
    for pattern in patterns:
        compiled = re.compile(pattern)
        if compiled.search(realistic):
            print(f"allowlist matches a realistic ingest key: {pattern}", file=sys.stderr)
            sys.exit(1)
        if pattern != r"^owl_ing_EXAMPLE$":
            print(f"unexpected allowlist regex: {pattern}", file=sys.stderr)
            sys.exit(1)


def main() -> None:
    self_test()
    allowlist_is_tight()
    findings = scan_tree()
    if findings:
        print("Committed ingest placeholders must be obvious fakes.", file=sys.stderr)
        print("\n".join(findings), file=sys.stderr)
        sys.exit(1)
    print("OK placeholder secrets")


if __name__ == "__main__":
    main()
