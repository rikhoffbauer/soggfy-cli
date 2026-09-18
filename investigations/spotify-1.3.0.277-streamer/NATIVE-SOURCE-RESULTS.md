# Independent native source investigation — final result

Date: 2026-09-18  
Decision: **NO-GO beyond C1; stop at Gate C2**

This document closes the bounded feasibility investigation described in
`docs/superpowers/plans/2026-09-18-independent-native-source-consumption.md`.
The optimized sequential capture path remains authoritative.

## What was established

The retained native traces support Gate C1:

- the encoded source/read boundary and decoder boundary were distinguished;
- logical source generations were recorded independently of raw pointer reuse;
- source creation, reads, teardown, and owner destruction were observed through
  natural Spotify execution;
- repeated A -> B -> A runs preserved the same ownership relationships while
  allowing object addresses to be reused only after teardown;
- the source owner, parent, higher playback context, and decoder were correlated
  within each source generation.

The playback identity path was also narrowed independently:

- native Playback Esperanto `GetPlaybackInfo` was observed returning the exact
  expected canonical fixture identity;
- its identity backend was compared with the bounded source/owner/parent/higher
  context graph;
- no direct pointer relationship connected that backend to the bounded source
  graph;
- the remaining opaque owner-constructor inputs were resolved to parent-owned
  dependencies rather than incidental registers;
- bounded scans of those dependencies did not expose the canonical fixture
  `fileId` or canonical `audioId` directly.

## Why C2 does not pass

Gate C2 requires exact variant identity for a native stream without consulting
global active playback. The evidence does not provide that binding.

One constructor dependency changes with the selected track, but track variance
alone is not identity. Treating timing, pointer variation, or global active-track
state as the binding would violate the plan's attribution requirements.

The next investigative step would be recursive reconstruction of child object
graphs and additional private playback/metadata managers. That is no longer a
small source-construction/read/teardown integration surface, so the investigation
stops under the predeclared boundedness rule.

## Gates

| Gate | Result | Reason |
|---|---|---|
| C1 | PASS / supported | Native source ownership, reads, generation, and teardown are understood within the investigated boundary. |
| C2 | NO-GO | No exact `fileId` binding from a source generation independent of global playback was established. |
| C3a | NOT RUN | Blocked by C2. |
| C3b | NOT RUN | Blocked by C2/C3a. |
| C4 | NOT RUN | Two-context work remains unjustified. |

The planned seek/restart identity adversarial test is intentionally not run as a
substitute for C2: without an exact identity binding, it could only demonstrate
lifecycle behavior, not correct variant attribution.

## Production consequence

No production concurrency change follows from this investigation. Keep the
existing single-runtime, prefetched sequential implementation and its exact-build
feature gates. A future concurrency design needs a different, independently
verifiable identity boundary rather than extending this private object graph.

## Runtime restoration

The isolated Spotify 1.3.0.277 source-probe runtime was stopped at closure. The
normal Soggfy daemon was restarted with the default home/configuration and
verified responsive through both Spotify IPC and the local web/API health check.
