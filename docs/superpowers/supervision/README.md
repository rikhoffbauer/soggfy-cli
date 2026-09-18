# TypeSafe supervision tooling

This directory contains derived semantic supervision contracts for development work. The original specification and implementation plan remain authoritative; the contract turns selected requirements into reusable TypeSafe/System One questions and deterministic policies so an agent or developer can audit plans, actions, evidence, trajectories, and completion without reinterpreting the prose on every turn.

## Current contract

- `2026-09-18-single-instance-prefetch.json`
- authoritative sources:
  - `../specs/2026-09-18-single-instance-prefetch-design.md`
  - `../plans/2026-09-18-single-instance-prefetch.md`
- live evidence state:
  - `../../../investigations/spotify-1.3.0.277-streamer/supervision-state.json`

The contract is deliberately split into two layers:

1. **Semantic questions** answer narrow fuzzy questions such as whether a proposed action violates an invariant, whether an interpretation overclaims the observed evidence, or whether a trajectory is thrashing.
2. **Deterministic policies** evaluate facts that ordinary code can establish exactly, such as the 10% Gate B threshold, valid-pair count, invalid-output count, hashes, and phase authorization.

TypeSafe does not override deterministic gates.

## CLI

The repository includes the developer-only supervision CLI:

```sh
bun run supervise -- help
```

It uses `@typesafe-ai/sdk` and the following environment variables supported by the SDK:

- `TYPESAFE_API_KEY`
- `TYPESAFE_DEFAULT_MODEL`
- `TYPESAFE_BASE_URL`
- `TYPESAFE_LOG_LEVEL`

Bun loads the repository `.env` automatically. Do not commit API keys or print their values in audit records.

### Evaluate deterministic gates

```sh
bun run supervise -- gates
```

This does not call TypeSafe. It loads the contract and supervision state and returns Gate A, Gate B, and whether production phases 3–5 are authorized.

### Run a semantic question set

```sh
bun run supervise -- audit \
  --set plan_preflight \
  --context spec=docs/superpowers/specs/2026-09-18-single-instance-prefetch-design.md \
  --context plan=docs/superpowers/plans/2026-09-18-single-instance-prefetch.md
```

Available question sets in the current contract are:

- `plan_preflight`
- `action_guard`
- `result_interpretation`
- `trajectory_audit`
- `closure_audit`

Multiple `--set` arguments are allowed. When multiple sets are used, question IDs are namespaced in the request and audit output.

### Attach arbitrary evidence

Repeated `--context label=path` arguments add source material under `state.context[label]`. JSON files are parsed as structured data; other files are supplied as text. Each attached source is SHA-256 fingerprinted in the audit record.

Examples:

```sh
bun run supervise -- audit \
  --set result_interpretation \
  --context result=investigations/spotify-1.3.0.277-streamer/results/phase2-live-probes-20260918.json
```

```sh
bun run supervise -- audit \
  --set trajectory_audit \
  --context trajectory=/tmp/current-agent-turn.json
```

This allows a full coding-agent turn, current diff, test transcript, or other evidence bundle to be audited without adding task-specific code.

### Persist an audit

```sh
bun run supervise -- audit \
  --set closure_audit \
  --context spec=docs/superpowers/specs/2026-09-18-single-instance-prefetch-design.md \
  --context plan=docs/superpowers/plans/2026-09-18-single-instance-prefetch.md \
  --context results=investigations/spotify-1.3.0.277-streamer/RESULTS.md \
  --out investigations/spotify-1.3.0.277-streamer/audits/closure.json
```

The record includes:

- TypeSafe request ID, model and token usage;
- contract/state/context paths and SHA-256 hashes;
- deterministic gate result;
- raw semantic answers;
- locally normalized probability diagnostics;
- warnings for harmless response-rounding inconsistencies.

### Dry run

```sh
bun run supervise -- audit --set action_guard --dry-run
```

This emits the exact request and deterministic gate state without calling the API.

## Response handling

Live experiments with TypeSafe exposed small rounding inconsistencies such as a choice distribution summing to `0.99` and a score differing by `0.01` from its probability-weighted value. The project harness therefore:

- preserves the raw API answer;
- accepts only a narrow ±0.02 probability-sum rounding envelope;
- normalizes those probabilities locally for diagnostics;
- reports score/probability discrepancies as warnings;
- rejects materially malformed responses.

This normalization is for diagnostics only. It does not turn semantic probabilities into calibrated correctness probabilities.

## Usage discipline

Use semantic supervision when the question is inherently interpretive, for example:

- does this plan cover the material preservation requirements?
- does this action remain within the authorized phase?
- does this interpretation actually follow from the tool result?
- has a hypothesis silently become an asserted fact?
- is the trajectory making meaningful progress or thrashing?
- do the final claims stay within the evidence?

Use deterministic code instead when the answer is exact, for example:

- did a command exit successfully?
- what is the executable SHA-256?
- is the daemon PID the owner of the Spotify child?
- are there at least three valid pairs?
- is the measured median improvement at least 10%?
- did every required test pass?

For destructive/state-changing operations, TypeSafe can contribute an alignment/ownership judgment, but explicit ownership and deterministic safety checks remain authoritative.
