# P0 Correctness Hardening Design

**Date:** 2026-08-27  
**Status:** Implemented
**Scope:** P0-1 through P0-5 correctness hardening. No new product features.

## Goal

Make optimization fail open to Claude's native behavior whenever relevance, input
freshness, or benchmark applicability is uncertain. The governing invariant is:

> UNKNOWN is not IRRELEVANT.

An optimization may remove a capability only when the current inputs positively
establish irrelevance or when compatible qualification evidence authorizes the
exact candidate semantics. Missing, partial, stale, legacy, or incompatible data
must never authorize removal.

## Non-goals

- Expanding the classifier taxonomy or adding new routing features.
- Broad repository cleanup unrelated to the five P0 findings.
- Treating historical evidence as compatible by inference.
- Following symlinks or storing repository contents in optimizer state.

## 1. Semantic certainty and structural pruning

`CapabilityNode` will represent three independent facts:

- `metadataParseConfidence`: whether plugin metadata was read successfully.
- `semanticCoverage`: how much of the plugin/component description was assigned
  a recognized semantic meaning.
- `semanticClassificationConfidence`: confidence in the recognized meaning.

Token-cost knowledge is deliberately excluded from semantic certainty. The graph
builder will classify plugin descriptions, names, and component names as separate
semantic units and aggregate recognized tags over the plugin envelope.

Structural pruning is allowed only when all of the following are true:

1. Inventory and repository inputs are complete and current.
2. The graph matches those exact inputs and the current graph algorithm version.
3. The plugin envelope has positive semantic coverage and meets the configured
   semantic-confidence threshold.
4. The recognized semantics have no affinity with the current task/repository.

No recognized tags means `KEEP_UNCERTAIN`, regardless of metadata readability or
known token cost. Recognized child-component semantics count toward the plugin
envelope, so useful details are not discarded.

## 2. Inventory cache identity

Every load performs the inexpensive live plugin-list probe before consulting the
details cache. The normalized baseline state is canonically sorted and includes
all available state that can affect capability availability:

- canonical plugin ID and display name;
- enabled state and version;
- source type and managed state;
- scope and last-updated value when the adapter supplies them.

`baselineStateHash` is computed from that normalized structure. Cache identity
includes schema version, Claude version family, working directory, and the state
hash. Cached plugin details are reused only on an exact match.

Legacy snapshots remain readable for diagnostics but cannot satisfy the new cache
contract. An empty or failed live listing produces a partial inventory.

## 3. Repository fingerprint identity and containment

Repository identity will include bounded content digests in addition to paths:

- JSON manifests are parsed and hashed from canonical JSON.
- Text manifests are hashed from the bounded bytes actually inspected.
- The aggregate input hash is built from sorted relative-path/digest pairs.

No raw manifest content or absolute path is persisted. `lstat` is used before
reading candidates; symbolic links are skipped. Resolved candidates must remain
inside the repository root. A skipped input, byte cap, file cap, parse failure, or
containment failure marks the result partial when the missing information could
affect classification.

Repository limits from configuration are passed through every CLI execution path.
The currently inert `deepScan` option is removed from the public contract rather
than being given speculative semantics. Legacy configuration containing it is
accepted and ignored during migration.

## 4. Versioned evidence applicability

Evidence authorization is centralized in one pure function:

`evaluateEvidenceApplicability(record, context) -> { eligible, reasons[] }`

The versioned evidence contract explicitly records:

- capability IDs and task families;
- Claude version family and model;
- optimizer, graph, and classifier algorithm versions;
- candidate profile identity and candidate semantics hash;
- suite/qualification grade, status, and trial count;
- statistical method and tolerance policy;
- deterministic-regression result.

All required dimensions must match the current context. `suiteId` text is never
parsed to infer applicability. Legacy evidence is still listable/exportable but
is rejected with `LEGACY_SCHEMA` and cannot influence compilation, routing,
quality gates, or tuning.

Evidence applies atomically to its explicit capability set. The compiler builds
the candidate represented by that set, closes dependencies, computes its semantic
hash, and accepts the evidence only if the resulting identity matches exactly.
This avoids circular or per-capability evidence reuse across different profiles.

## 5. Central fail-open preflight

Before pruning, the compiler validates:

- current inventory schema, completeness, and baseline-state hash;
- repository completeness;
- graph schema and algorithm version;
- graph inventory/repository fingerprints;
- current optimizer/classifier versions.

Failure returns a zero-delta native profile with machine-readable fallback reasons.
The CLI then launches without an overlay. Strict mode exits with an explicit error
instead. Analyze reports the fallback, and benchmark refuses to promote a native
fallback as an optimized candidate.

Existing profile-integrity validation remains in force. Hook and normal CLI paths
use the same core compiler and validators; the plugin bundle only packages those
shared implementations.

## 6. Schema and compatibility strategy

The affected contracts move to schema version 2 and the changed algorithms receive
new version identifiers. Canonical JSON Schemas are generated from the maintained
schema generator and aligned with the actual TypeScript structures, including a
new evidence schema.

Migration is intentionally conservative:

- v1 inventory caches: readable, never cache-authoritative;
- v1 evidence: readable, never optimization-authoritative;
- v1 profiles/artifacts: integrity-checkable, never reused as current inputs;
- legacy `deepScan`: accepted and ignored;
- no implicit upgrade fabricates missing certainty or applicability.

## 7. Verification strategy

Each P0 begins with a failing regression test and ends with a focused passing test:

- P0-1: builder-to-compiler tests for unknown plugin, known semantic plugin,
  component-derived semantics, and known-token/unknown-semantic separation.
- P0-2: mutable adapter test proving list changes invalidate cached details and
  stable canonical ordering preserves identity.
- P0-3: content-change identity, canonical JSON stability, symlink rejection,
  root containment, byte/file caps, and privacy assertions.
- P0-4: one mismatch test per applicability dimension plus an exact-match positive
  case; legacy evidence must be rejected.
- P0-5: partial inventory, partial repository, stale graph, version mismatch, and
  invalid integrity all produce native fallback or strict failure.

After focused tests pass, qualification runs the full lint, build, unit/integration
suite, schema generation/diff, plugin build, release packaging/verification, and
real CLI smoke scenarios. Claims and benchmark documentation will state only what
fresh evidence proves.

## Acceptance criteria

- All five supplied reproductions fail safely.
- No unknown, partial, stale, legacy, or incompatible input can authorize pruning.
- Valid complete inputs retain useful structural optimization.
- Compatible qualification evidence can authorize only its exact candidate.
- Core CLI and plugin hook decisions are identical for the same inputs.
- All existing and new quality gates pass from a clean checkout-compatible state.
