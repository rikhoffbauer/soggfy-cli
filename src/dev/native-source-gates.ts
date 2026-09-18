export type C3aProgressEvent = {
  atMs: number;
  totalEncodedBytes: number;
  pageSequence?: number;
  granulePosition?: number;
};

export type C3aEvidence = {
  processGeneration: number;
  contextGeneration: number;
  expectedFileId: string;
  boundFileId: string;
  identityBoundAtMs: number;
  globalPlaybackIdentityConsulted: boolean;
  consumptionMode: "independent" | "ordinary-playback";

  progress: C3aProgressEvent[];
  eosAtMs: number | null;
  framingComplete: boolean;

  expectedSha256: string;
  actualSha256: string;
  mediaValidationOk: boolean;

  teardownAcknowledgedAtMs: number | null;
  lateWritesAfterTeardown: number;

  ordinaryPlaybackUnaffected: boolean;
};

export type C3aFailure =
  | "missing_process_generation"
  | "missing_context_generation"
  | "invalid_expected_file_id"
  | "invalid_bound_file_id"
  | "file_id_mismatch"
  | "global_playback_identity_dependency"
  | "not_independent_consumption"
  | "missing_progress"
  | "non_monotonic_progress"
  | "identity_not_bound_before_progress"
  | "missing_eos"
  | "eos_before_last_progress"
  | "incomplete_framing"
  | "invalid_expected_sha256"
  | "invalid_actual_sha256"
  | "sha256_mismatch"
  | "media_validation_failed"
  | "missing_teardown_ack"
  | "teardown_before_eos"
  | "late_writes_after_teardown"
  | "ordinary_playback_regressed";

export type C3aGateResult = {
  pass: boolean;
  failures: C3aFailure[];
  summary: {
    progressEvents: number;
    encodedBytes: number;
    firstProgressAtMs: number | null;
    lastProgressAtMs: number | null;
  };
};

const HEX40 = /^[0-9a-f]{40}$/i;
const HEX64 = /^[0-9a-f]{64}$/i;

function isFiniteTimestamp(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function evaluateC3aEvidence(evidence: C3aEvidence): C3aGateResult {
  const failures: C3aFailure[] = [];

  if (!Number.isInteger(evidence.processGeneration) || evidence.processGeneration <= 0) {
    failures.push("missing_process_generation");
  }
  if (!Number.isInteger(evidence.contextGeneration) || evidence.contextGeneration <= 0) {
    failures.push("missing_context_generation");
  }
  if (!HEX40.test(evidence.expectedFileId)) failures.push("invalid_expected_file_id");
  if (!HEX40.test(evidence.boundFileId)) failures.push("invalid_bound_file_id");
  if (
    HEX40.test(evidence.expectedFileId) &&
    HEX40.test(evidence.boundFileId) &&
    evidence.expectedFileId.toLowerCase() !== evidence.boundFileId.toLowerCase()
  ) {
    failures.push("file_id_mismatch");
  }
  if (evidence.globalPlaybackIdentityConsulted) {
    failures.push("global_playback_identity_dependency");
  }
  if (evidence.consumptionMode !== "independent") {
    failures.push("not_independent_consumption");
  }

  const progress = evidence.progress;
  if (progress.length === 0) failures.push("missing_progress");

  let monotonic = true;
  for (let i = 0; i < progress.length; i++) {
    const current = progress[i]!;
    if (
      !Number.isFinite(current.atMs) ||
      current.atMs < 0 ||
      !Number.isFinite(current.totalEncodedBytes) ||
      current.totalEncodedBytes <= 0
    ) {
      monotonic = false;
      continue;
    }
    if (i > 0) {
      const previous = progress[i - 1]!;
      if (current.atMs < previous.atMs) monotonic = false;
      if (current.totalEncodedBytes < previous.totalEncodedBytes) monotonic = false;
      if (
        current.pageSequence !== undefined &&
        previous.pageSequence !== undefined &&
        current.pageSequence < previous.pageSequence
      ) {
        monotonic = false;
      }
      if (
        current.granulePosition !== undefined &&
        previous.granulePosition !== undefined &&
        current.granulePosition < previous.granulePosition
      ) {
        monotonic = false;
      }
    }
  }
  if (progress.length > 0 && !monotonic) failures.push("non_monotonic_progress");

  const firstProgressAtMs = progress.length > 0 ? progress[0]!.atMs : null;
  const lastProgressAtMs = progress.length > 0 ? progress[progress.length - 1]!.atMs : null;
  const encodedBytes = progress.length > 0
    ? Math.max(0, progress[progress.length - 1]!.totalEncodedBytes)
    : 0;

  if (
    firstProgressAtMs !== null &&
    (!isFiniteTimestamp(evidence.identityBoundAtMs) ||
      evidence.identityBoundAtMs > firstProgressAtMs)
  ) {
    failures.push("identity_not_bound_before_progress");
  }

  if (!isFiniteTimestamp(evidence.eosAtMs)) {
    failures.push("missing_eos");
  } else if (lastProgressAtMs !== null && evidence.eosAtMs < lastProgressAtMs) {
    failures.push("eos_before_last_progress");
  }

  if (!evidence.framingComplete) failures.push("incomplete_framing");

  if (!HEX64.test(evidence.expectedSha256)) failures.push("invalid_expected_sha256");
  if (!HEX64.test(evidence.actualSha256)) failures.push("invalid_actual_sha256");
  if (
    HEX64.test(evidence.expectedSha256) &&
    HEX64.test(evidence.actualSha256) &&
    evidence.expectedSha256.toLowerCase() !== evidence.actualSha256.toLowerCase()
  ) {
    failures.push("sha256_mismatch");
  }

  if (!evidence.mediaValidationOk) failures.push("media_validation_failed");

  if (!isFiniteTimestamp(evidence.teardownAcknowledgedAtMs)) {
    failures.push("missing_teardown_ack");
  } else if (isFiniteTimestamp(evidence.eosAtMs) && evidence.teardownAcknowledgedAtMs < evidence.eosAtMs) {
    failures.push("teardown_before_eos");
  }

  if (
    !Number.isInteger(evidence.lateWritesAfterTeardown) ||
    evidence.lateWritesAfterTeardown !== 0
  ) {
    failures.push("late_writes_after_teardown");
  }

  if (!evidence.ordinaryPlaybackUnaffected) {
    failures.push("ordinary_playback_regressed");
  }

  return {
    pass: failures.length === 0,
    failures,
    summary: {
      progressEvents: progress.length,
      encodedBytes,
      firstProgressAtMs,
      lastProgressAtMs,
    },
  };
}
