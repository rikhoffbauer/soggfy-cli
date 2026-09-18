import {
  evaluateC3aEvidence,
  type C3aEvidence,
} from "../src/dev/native-source-gates.ts";

function valid(): C3aEvidence {
  return {
    processGeneration: 3,
    contextGeneration: 7,
    expectedFileId: "f38702bf00c1b1271576c399dbc5713f2412132a",
    boundFileId: "f38702bf00c1b1271576c399dbc5713f2412132a",
    identityBoundAtMs: 100,
    globalPlaybackIdentityConsulted: false,
    consumptionMode: "independent",
    progress: [
      { atMs: 110, totalEncodedBytes: 4096, pageSequence: 0, granulePosition: 0 },
      { atMs: 120, totalEncodedBytes: 12288, pageSequence: 1, granulePosition: 1024 },
      { atMs: 130, totalEncodedBytes: 14336, pageSequence: 2, granulePosition: 2048 },
    ],
    eosAtMs: 140,
    framingComplete: true,
    expectedSha256: "a".repeat(64),
    actualSha256: "a".repeat(64),
    mediaValidationOk: true,
    teardownAcknowledgedAtMs: 150,
    lateWritesAfterTeardown: 0,
    ordinaryPlaybackUnaffected: true,
  };
}

describe("C3a independent native source gate", () => {
  test("passes only complete exact independent-consumption evidence", () => {
    expect(evaluateC3aEvidence(valid())).toEqual({
      pass: true,
      failures: [],
      summary: {
        progressEvents: 3,
        encodedBytes: 14336,
        firstProgressAtMs: 110,
        lastProgressAtMs: 130,
      },
    });
  });

  const cases: Array<[string, (value: C3aEvidence) => void, string]> = [
    ["wrong exact identity", (v) => { v.boundFileId = "b".repeat(40); }, "file_id_mismatch"],
    ["global playback attribution", (v) => { v.globalPlaybackIdentityConsulted = true; }, "global_playback_identity_dependency"],
    ["ordinary playback consumption", (v) => { v.consumptionMode = "ordinary-playback"; }, "not_independent_consumption"],
    ["no progress", (v) => { v.progress = []; }, "missing_progress"],
    ["late identity binding", (v) => { v.identityBoundAtMs = 111; }, "identity_not_bound_before_progress"],
    ["missing EOS", (v) => { v.eosAtMs = null; }, "missing_eos"],
    ["incomplete framing", (v) => { v.framingComplete = false; }, "incomplete_framing"],
    ["hash mismatch", (v) => { v.actualSha256 = "b".repeat(64); }, "sha256_mismatch"],
    ["failed media validation", (v) => { v.mediaValidationOk = false; }, "media_validation_failed"],
    ["missing teardown", (v) => { v.teardownAcknowledgedAtMs = null; }, "missing_teardown_ack"],
    ["late write", (v) => { v.lateWritesAfterTeardown = 1; }, "late_writes_after_teardown"],
    ["playback regression", (v) => { v.ordinaryPlaybackUnaffected = false; }, "ordinary_playback_regressed"],
  ];

  for (const [name, mutate, expectedFailure] of cases) {
    test(`fails closed on ${name}`, () => {
      const evidence = valid();
      mutate(evidence);
      const result = evaluateC3aEvidence(evidence);
      expect(result.pass).toBe(false);
      expect(result.failures).toContain(expectedFailure);
    });
  }

  test("rejects non-monotonic page/granule progress", () => {
    const evidence = valid();
    evidence.progress[2] = {
      atMs: 125,
      totalEncodedBytes: 1024,
      pageSequence: 0,
      granulePosition: 512,
    };
    expect(evaluateC3aEvidence(evidence).failures).toContain("non_monotonic_progress");
  });

  test("rejects teardown before EOS", () => {
    const evidence = valid();
    evidence.teardownAcknowledgedAtMs = 135;
    expect(evaluateC3aEvidence(evidence).failures).toContain("teardown_before_eos");
  });
});
