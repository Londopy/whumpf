# Security Policy

## Supported versions

WHUMPF is pre-release. Only `main` receives fixes.

## Reporting a vulnerability

Please report security issues privately through
[GitHub Security Advisories](https://github.com/Londopy/whumpf/security/advisories/new)
rather than opening a public issue.

Include what you can: affected component, reproduction steps, and impact. We
aim to acknowledge within 7 days.

## Scope

In scope:

- The Flask API (`api/`) — injection, SSRF via bulletin fetching, cache
  poisoning, resource exhaustion
- The pipeline (`pipeline/`) — path traversal, unsafe deserialisation, command
  injection via config values reaching `subprocess`
- The Rust kernel (`crates/whumpf-runout`) — memory safety, panics reachable
  from untrusted input
- Credential leakage in committed files or CI logs

Out of scope:

- Vulnerabilities in upstream data providers (USGS, LINZ, Planetary Computer,
  avalanche.org, NZAA)
- Issues requiring a compromised local machine
- Missing hardening headers on a development server

## Data-integrity issues are security issues here

This project displays public-safety information. A bug that causes a **stale
bulletin to render as current**, an **expired forecast to lose its warning
banner**, or **terrain to be filtered against the wrong parameters** should be
reported through this process even though it is not a conventional
vulnerability. Those failures are the ones that could actually hurt someone.

## Secrets

No API keys or tokens belong in the repository. `.env` is gitignored; use
`.env.example` as the template. If you commit a credential, rotate it
immediately — removing the commit is not sufficient.
