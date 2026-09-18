import type {
  IndependentCaptureResult,
  ParallelCaptureOverlap,
} from "./independent-ogg-pipeline.ts";

export type SurrogateGateResult<Failure extends string> = {
  pass: boolean;
  failures: Failure[];
};

export type SurrogateC3aFailure =
  | "capture_not_completed"
  | "missing_progress"
  | "missing_eos"
  | "incomplete_framing"
  | "hash_mismatch"
  | "media_validation_failed"
  | "teardown_before_eos"
  | "late_writes_after_teardown";

export function evaluateSurrogateC3a(
  capture: IndependentCaptureResult,
  options: {
    expectedSha256: string;
    mediaValidationOk: boolean;
  },
): SurrogateGateResult<SurrogateC3aFailure> {
  const failures: SurrogateC3aFailure[] = [];
  if (capture.state !== "completed") failures.push("capture_not_completed");
  if (capture.progress.length === 0) failures.push("missing_progress");
  if (capture.eosAtMs === null) failures.push("missing_eos");
  if (!capture.framingComplete) failures.push("incomplete_framing");
  if (capture.sha256.toLowerCase() !== options.expectedSha256.toLowerCase()) {
    failures.push("hash_mismatch");
  }
  if (!options.mediaValidationOk) failures.push("media_validation_failed");
  if (capture.eosAtMs !== null && capture.teardownAtMs < capture.eosAtMs) {
    failures.push("teardown_before_eos");
  }
  if (capture.lateWritesAfterTeardown !== 0) {
    failures.push("late_writes_after_teardown");
  }
  return { pass: failures.length === 0, failures };
}

export type RecoverableLifecycleCase =
  | "cancel_startup"
  | "cancel_consuming"
  | "source_read_failure"
  | "writer_failure"
  | "timeout_no_progress"
  | "late_callback";

export type SurrogateC3bEvidence = {
  recoverable: Record<RecoverableLifecycleCase, {
    contained: boolean;
    teardownComplete: boolean;
    noLateWrites: boolean;
    peerUnaffected: boolean;
  }>;
  processRestart: {
    completedArtifactsPreserved: boolean;
    incompleteArtifactsUnpublished: boolean;
    liveContextsInvalidated: boolean;
    cleanRequeueSupported: boolean;
  };
};

export type SurrogateC3bFailure =
  | `recoverable_not_contained:${RecoverableLifecycleCase}`
  | `recoverable_teardown_incomplete:${RecoverableLifecycleCase}`
  | `recoverable_late_writes:${RecoverableLifecycleCase}`
  | `recoverable_peer_regression:${RecoverableLifecycleCase}`
  | "restart_completed_artifact_lost"
  | "restart_incomplete_artifact_published"
  | "restart_live_context_not_invalidated"
  | "restart_requeue_unavailable";

export function evaluateSurrogateC3b(
  evidence: SurrogateC3bEvidence,
): SurrogateGateResult<SurrogateC3bFailure> {
  const failures: SurrogateC3bFailure[] = [];
  for (const [name, result] of Object.entries(evidence.recoverable) as Array<
    [RecoverableLifecycleCase, SurrogateC3bEvidence["recoverable"][RecoverableLifecycleCase]]
  >) {
    if (!result.contained) failures.push(`recoverable_not_contained:${name}`);
    if (!result.teardownComplete) failures.push(`recoverable_teardown_incomplete:${name}`);
    if (!result.noLateWrites) failures.push(`recoverable_late_writes:${name}`);
    if (!result.peerUnaffected) failures.push(`recoverable_peer_regression:${name}`);
  }
  if (!evidence.processRestart.completedArtifactsPreserved) {
    failures.push("restart_completed_artifact_lost");
  }
  if (!evidence.processRestart.incompleteArtifactsUnpublished) {
    failures.push("restart_incomplete_artifact_published");
  }
  if (!evidence.processRestart.liveContextsInvalidated) {
    failures.push("restart_live_context_not_invalidated");
  }
  if (!evidence.processRestart.cleanRequeueSupported) {
    failures.push("restart_requeue_unavailable");
  }
  return { pass: failures.length === 0, failures };
}

export type SurrogateC4Failure =
  | "context_a_not_completed"
  | "context_b_not_completed"
  | "context_a_hash_mismatch"
  | "context_b_hash_mismatch"
  | "no_overlapping_progress"
  | "zero_overlap_interval"
  | "context_a_late_writes"
  | "context_b_late_writes";

export function evaluateSurrogateC4(
  captures: [IndependentCaptureResult, IndependentCaptureResult],
  overlap: ParallelCaptureOverlap,
  expectedSha256: [string, string],
): SurrogateGateResult<SurrogateC4Failure> {
  const failures: SurrogateC4Failure[] = [];
  const [a, b] = captures;
  if (a.state !== "completed") failures.push("context_a_not_completed");
  if (b.state !== "completed") failures.push("context_b_not_completed");
  if (a.sha256.toLowerCase() !== expectedSha256[0].toLowerCase()) {
    failures.push("context_a_hash_mismatch");
  }
  if (b.sha256.toLowerCase() !== expectedSha256[1].toLowerCase()) {
    failures.push("context_b_hash_mismatch");
  }
  if (!overlap.bothMadeProgress) failures.push("no_overlapping_progress");
  if (overlap.overlapMs <= 0) failures.push("zero_overlap_interval");
  if (a.lateWritesAfterTeardown !== 0) failures.push("context_a_late_writes");
  if (b.lateWritesAfterTeardown !== 0) failures.push("context_b_late_writes");
  return { pass: failures.length === 0, failures };
}
