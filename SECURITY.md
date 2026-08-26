# Security Policy

## Supported versions

Only the latest published minor release on the `1.x` line receives security
fixes until a `2.0` major release exists.

## Reporting a vulnerability

Do not open a public GitHub issue for a suspected vulnerability. Instead use
GitHub's private vulnerability reporting ("Security" tab -> "Report a
vulnerability") on this repository, or email the maintainers listed in
`package.json`/`CONTRIBUTING.md`. Include:

- affected CCO version and Claude Code version;
- reproduction steps or a minimal profile/config that triggers the issue;
- impact assessment (what an attacker gains).

Security fixes are prioritized ahead of benchmark/release cadence and are
coordinated privately before disclosure.

## Hard security invariants

These are enforced in code and covered by release-blocking tests
(see `11_SECURITY_PRIVACY_THREAT_MODEL.md`):

- CCO never enables a baseline-disabled plugin without explicit user
  authorization (`FR-009`).
- CCO never writes a `permissions` key into any settings overlay (`ADR-008`).
- CCO never executes third-party extension code during inventory/audit
  scanning.
- CCO does not persist raw prompts or transcript content by default.
- Secrets are redacted before any local telemetry write; nothing is sent to a
  remote analytics service (`ADR-017`).
- Monotonicity property tests on the settings overlay are release-blocking.

Reports that a code path violates one of the invariants above are treated as
security reports, not ordinary bugs.
