import { describe, expect, test } from "bun:test";
import {
  buildQuestions,
  evaluateDeterministicGates,
  normalizeSystemOneResult,
  validateContract,
  type SupervisionContract,
} from "../src/dev/typesafe-supervision.ts";

const contract: SupervisionContract = {
  version: 1,
  name: "fixture",
  questionSets: {
    plan: {
      coverage: {
        type: "choice",
        instructions: "Does it cover the requirement?",
        criteria: {
          satisfied: "yes",
          violated: "no",
          insufficient_evidence: "unknown",
        },
      },
    },
    close: {
      grounded: {
        type: "noul",
        instructions: "Grounded?",
      },
    },
  },
  deterministicPolicies: {
    gateA: { requiredTrue: ["documented", "restored"] },
    gateB: {
      required: {
        minimumValidPairedBatchRuns: 3,
        minimumMedianImprovementFraction: 0.1,
        everyPairedBatchRunMustImprove: true,
        invalidOrMisattributedOutputsAllowed: 0,
        exactOutputsMustBeStable: true,
        additionalObservedCaptureFailuresAllowed: 0,
        additionalObservedBufferingStallsAllowed: 0,
      },
    },
  },
};

describe("TypeSafe supervision", () => {
  test("validates and namespaces reusable question sets", () => {
    expect(validateContract(contract).name).toBe("fixture");
    const built = buildQuestions(contract, ["plan", "close"]);
    expect(Object.keys(built.questions)).toEqual(["plan.coverage", "close.grounded"]);
    expect(built.questionOrigins["plan.coverage"]).toEqual({ set: "plan", id: "coverage" });
  });

  test("normalizes harmless 0.99 probability rounding", () => {
    const { questions } = buildQuestions(contract, ["plan"]);
    const normalized = normalizeSystemOneResult(questions, {
      model: "jev-fixture",
      usage: { input_tokens: 1, output_tokens: 1 },
      answers: {
        coverage: {
          type: "choice",
          choice: "satisfied",
          confidence: 0.9,
          probabilities: {
            satisfied: 0.7,
            violated: 0.2,
            insufficient_evidence: 0.09,
          },
        },
      },
    });

    expect(normalized.coverage.probabilityDiagnostics?.rawSum).toBeCloseTo(0.99);
    expect(normalized.coverage.probabilityDiagnostics?.renormalized).toBe(true);
    expect(normalized.coverage.warnings).toHaveLength(1);
  });

  test("rejects materially malformed probability distributions", () => {
    const { questions } = buildQuestions(contract, ["plan"]);
    expect(() =>
      normalizeSystemOneResult(questions, {
        model: "jev-fixture",
        usage: { input_tokens: 1, output_tokens: 1 },
        answers: {
          coverage: {
            type: "choice",
            choice: "satisfied",
            confidence: 0.9,
            probabilities: {
              satisfied: 0.5,
              violated: 0.2,
              insufficient_evidence: 0.1,
            },
          },
        },
      }),
    ).toThrow("outside the tolerated");
  });

  test("computes exact GO when every deterministic requirement passes", () => {
    const result = evaluateDeterministicGates(contract, {
      gateA: { documented: true, restored: true },
      gateB: {
        validPairedBatchRuns: 3,
        medianImprovementFraction: 0.12,
        everyPairedBatchRunImproved: true,
        invalidOrMisattributedOutputs: 0,
        exactOutputsStable: true,
        additionalObservedCaptureFailures: 0,
        additionalObservedBufferingStalls: 0,
      },
    });

    expect(result.gateA.decision).toBe("PASS");
    expect(result.gateB.decision).toBe("GO");
    expect(result.productionPhases3To5Authorized).toBe(true);
  });

  test("measured performance failure is NO-GO even if later conjuncts are unknown", () => {
    const result = evaluateDeterministicGates(contract, {
      gateA: { documented: true, restored: true },
      gateB: {
        validPairedBatchRuns: 3,
        medianImprovementFraction: 0.005,
        everyPairedBatchRunImproved: false,
        invalidOrMisattributedOutputs: 1,
        exactOutputsStable: true,
      },
    });

    expect(result.gateB.decision).toBe("NO-GO");
    expect(result.gateB.failures).toContain("notEveryPairedBatchRunImproved");
    expect(result.productionPhases3To5Authorized).toBe(false);
  });

  test("too few valid pairs remains INCONCLUSIVE", () => {
    const result = evaluateDeterministicGates(contract, {
      gateA: { documented: true, restored: true },
      gateB: {
        validPairedBatchRuns: 2,
        medianImprovementFraction: 0.01,
        everyPairedBatchRunImproved: false,
        invalidOrMisattributedOutputs: 1,
        exactOutputsStable: true,
      },
    });

    expect(result.gateB.decision).toBe("INCONCLUSIVE");
    expect(result.productionPhases3To5Authorized).toBe(false);
  });
});
