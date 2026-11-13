# Security policy

## Reporting a vulnerability

Please report security problems privately to **security@owlpane.com**. Do not open a public issue or pull request.

Include what you found, the affected repository and version or commit, and steps to reproduce. We aim to acknowledge a report within 3 working days and to tell you what we plan to do within 10 working days. We will credit you in the release notes if you want that.

A suspected cross-tenant data exposure is treated as the highest severity and handled through the incident process in the platform documentation.

## Scope

Code and configuration in this repository: for example authentication or authorization flaws, leaked credentials, unsafe data capture, injection, or dependency problems we ship.

Out of scope: social engineering, physical attacks, denial-of-service testing against hosted services, and findings that need a compromised device or cluster-admin rights.

## Supported versions

Only the latest release (or the `main` branch for services we operate) receives security fixes.

## Our own controls

Dependency updates are proposed by Dependabot, and secret scanning and static analysis run in CI (`.github/workflows/security-scan.yml`). Changes to this repository require review by the owners listed in `.github/CODEOWNERS`.
