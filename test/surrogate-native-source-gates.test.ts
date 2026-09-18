import {
  evaluateSurrogateC3a,
  evaluateSurrogateC3b,
  evaluateSurrogateC4,
  type SurrogateC3bEvidence,
} from "../src/dev/surrogate-native-source-gates.ts";
import type {
  IndependentCaptureResult,
  ParallelCaptureOverlap,
} from "../src/dev/independent-ogg-pipeline.ts";

function capture(id: number, hash = "a".repeat(64)): IndependentCaptureResult {
  return {
    contextId: id,
    sourceId: `source-${id}`,
    state: "completed",
    stateHistory: [],
    startedAtMs: 1,
    firstProgressAtMs: 2,
    lastProgressAtMs: 8,
    eosAtMs: 9,
    teardownAtMs: 10,
    totalEncodedBytes: 100,
    sha256: hash,
    framingComplete: true,
    pages: [],
    progress: [{
      contextId: id,
      sourceId: `source-${id}`,
      atMs: 2,
      totalEncodedBytes: 100,
    }],
    lateWritesAfterTeardown: 0,
  };
}

function c3b(): SurrogateC3bEvidence {
  const ok = {
    contained: true,
    teardownComplete: true,
    noLateWrites: true,
    peerUnaffected: true,
  };
  return {
    recoverable: {
      cancel_startup: { ...ok },
      cancel_consuming: { ...ok },
      source_read_failure: { ...ok },
      writer_failure: { ...ok },
      timeout_no_progress: { ...ok },
      late_callback: { ...ok },
    },
    processRestart: {
      completedArtifactsPreserved: true,
      incompleteArtifactsUnpublished: true,
      liveContextsInvalidated: true,
      cleanRequeueSupported: true,
    },
  };
}

describe("surrogate independent-source gates", () => {
  test("surrogate C3a passes exact complete local-fixture evidence", () => {
    expect(evaluateSurrogateC3a(capture(1), {
      expectedSha256: "a".repeat(64),
      mediaValidationOk: true,
    })).toEqual({ pass: true, failures: [] });
  });

  test("surrogate C3a fails closed on integrity and lifecycle errors", () => {
    const value = capture(1, "b".repeat(64));
    value.lateWritesAfterTeardown = 1;
    const result = evaluateSurrogateC3a(value, {
      expectedSha256: "a".repeat(64),
      mediaValidationOk: false,
    });
    expect(result.pass).toBe(false);
    expect(result.failures).toContain("hash_mismatch");
    expect(result.failures).toContain("media_validation_failed");
    expect(result.failures).toContain("late_writes_after_teardown");
  });

  test("surrogate C3b passes the full bounded lifecycle matrix", () => {
    expect(evaluateSurrogateC3b(c3b())).toEqual({ pass: true, failures: [] });
  });

  test("surrogate C3b identifies the exact failed lifecycle invariant", () => {
    const evidence = c3b();
    evidence.recoverable.writer_failure.peerUnaffected = false;
    evidence.processRestart.cleanRequeueSupported = false;
    const result = evaluateSurrogateC3b(evidence);
    expect(result.pass).toBe(false);
    expect(result.failures).toContain("recoverable_peer_regression:writer_failure");
    expect(result.failures).toContain("restart_requeue_unavailable");
  });

  test("surrogate C4 requires real positive-duration overlapping progress", () => {
    const overlap: ParallelCaptureOverlap = {
      contextIds: [1, 2],
      overlapStartMs: 3,
      overlapEndMs: 7,
      overlapMs: 4,
      bothMadeProgress: true,
    };
    expect(evaluateSurrogateC4(
      [capture(1), capture(2, "b".repeat(64))],
      overlap,
      ["a".repeat(64), "b".repeat(64)],
    )).toEqual({ pass: true, failures: [] });

    const zero = evaluateSurrogateC4(
      [capture(1), capture(2, "b".repeat(64))],
      { ...overlap, overlapEndMs: 3, overlapMs: 0 },
      ["a".repeat(64), "b".repeat(64)],
    );
    expect(zero.pass).toBe(false);
    expect(zero.failures).toContain("zero_overlap_interval");
  });
});
