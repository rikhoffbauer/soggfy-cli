import type { Questions, SystemOneResult } from "@typesafe-ai/sdk";

export type JsonValue =
  | string | number | boolean | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type ContractQuestion =
  | { type: "noul"; instructions?: JsonValue; criteria?: { true?: JsonValue; false?: JsonValue } | null }
  | { type: "choice"; instructions?: JsonValue; criteria: Record<string, JsonValue> }
  | { type: "score"; instructions?: JsonValue; criteria: [JsonValue, JsonValue, ...JsonValue[]] };

export interface SupervisionContract {
  version: number;
  name: string;
  typesafe?: { model?: string; timeoutMs?: number; rules?: string[] };
  questionSets: Record<string, Record<string, ContractQuestion>>;
  deterministicPolicies?: {
    gateA?: { requiredTrue?: string[] };
    gateB?: {
      required?: {
        minimumValidPairedBatchRuns?: number;
        minimumMedianImprovementFraction?: number;
        everyPairedBatchRunMustImprove?: boolean;
        invalidOrMisattributedOutputsAllowed?: number;
        exactOutputsMustBeStable?: boolean;
        additionalObservedCaptureFailuresAllowed?: number;
        additionalObservedBufferingStallsAllowed?: number;
      };
    };
  };
}

export interface NormalizedAnswer {
  raw: unknown;
  probabilityDiagnostics?: {
    rawSum: number;
    normalized: Record<string, number>;
    renormalized: boolean;
  };
  derivedScore?: number;
  warnings: string[];
}

export interface GateResult {
  gateA: { decision: "PASS" | "INCOMPLETE"; missing: string[] };
  gateB: { decision: "GO" | "NO-GO" | "INCONCLUSIVE"; failures: string[]; unknown: string[] };
  productionPhases3To5Authorized: boolean;
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

export function validateContract(value: unknown): SupervisionContract {
  const contract = asObject(value, "contract");
  if (!Number.isInteger(contract.version) || Number(contract.version) < 1) {
    throw new Error("contract.version must be a positive integer");
  }
  if (typeof contract.name !== "string" || !contract.name.trim()) {
    throw new Error("contract.name must be a non-empty string");
  }
  const sets = asObject(contract.questionSets, "contract.questionSets");
  if (!Object.keys(sets).length) throw new Error("contract.questionSets must not be empty");

  for (const [setName, rawSet] of Object.entries(sets)) {
    const set = asObject(rawSet, `contract.questionSets.${setName}`);
    if (!Object.keys(set).length) throw new Error(`Question set "${setName}" must not be empty`);
    for (const [id, rawQuestion] of Object.entries(set)) {
      const q = asObject(rawQuestion, `contract.questionSets.${setName}.${id}`);
      if (!["noul", "choice", "score"].includes(String(q.type))) {
        throw new Error(`Invalid question type for ${setName}.${id}`);
      }
      if (q.type === "choice" && Object.keys(asObject(q.criteria, `${setName}.${id}.criteria`)).length < 2) {
        throw new Error(`Choice ${setName}.${id} needs at least two criteria`);
      }
      if (q.type === "score" && (!Array.isArray(q.criteria) || q.criteria.length < 2)) {
        throw new Error(`Score ${setName}.${id} needs at least two criteria`);
      }
    }
  }
  return value as SupervisionContract;
}

export function buildQuestions(contract: SupervisionContract, setNames: string[]) {
  if (!setNames.length) throw new Error("At least one question set is required");
  const questions: Record<string, ContractQuestion> = {};
  const origins: Record<string, { set: string; id: string }> = {};
  const namespace = setNames.length > 1;

  for (const setName of setNames) {
    const set = contract.questionSets[setName];
    if (!set) {
      throw new Error(`Unknown question set "${setName}". Available: ${Object.keys(contract.questionSets).sort().join(", ")}`);
    }
    for (const [id, question] of Object.entries(set)) {
      const key = namespace ? `${setName}.${id}` : id;
      if (questions[key]) throw new Error(`Duplicate question id "${key}"`);
      questions[key] = question;
      origins[key] = { set: setName, id };
    }
  }
  return { questions: questions as Questions, questionOrigins: origins };
}

function probabilityDiagnostics(probabilities: unknown, expectedKeys: string[], label: string) {
  const source = asObject(probabilities, `${label}.probabilities`);
  const values: Record<string, number> = {};
  for (const key of expectedKeys) {
    const value = finiteNumber(source[key], `${label}.probabilities.${key}`);
    if (value < 0 || value > 1) throw new Error(`${label}.probabilities.${key} must be between 0 and 1`);
    values[key] = value;
  }
  const extras = Object.keys(source).filter(key => !expectedKeys.includes(key));
  if (extras.length) throw new Error(`${label}.probabilities has unexpected keys: ${extras.join(", ")}`);

  const rawSum = Object.values(values).reduce((sum, value) => sum + value, 0);
  if (rawSum <= 0) throw new Error(`${label}.probabilities sum must be positive`);
  // Live/MCP testing observed harmless totals such as 0.99 due to output rounding.
  if (Math.abs(rawSum - 1) > 0.02) {
    throw new Error(`${label}.probabilities sum ${rawSum} is outside the tolerated ±0.02 rounding window`);
  }
  return {
    rawSum,
    normalized: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value / rawSum])),
    renormalized: Math.abs(rawSum - 1) > 1e-9,
  };
}

export function normalizeSystemOneResult(
  questions: Questions,
  result: SystemOneResult<Questions> | Record<string, unknown>,
): Record<string, NormalizedAnswer> {
  const answers = asObject(asObject(result, "result").answers, "result.answers");
  const normalized: Record<string, NormalizedAnswer> = {};

  for (const [id, question] of Object.entries(questions)) {
    const answer = asObject(answers[id], `result.answers.${id}`);
    const warnings: string[] = [];
    if (answer.type !== question.type) {
      throw new Error(`result.answers.${id}.type expected ${question.type}, got ${String(answer.type)}`);
    }

    if (question.type === "noul") {
      const value = finiteNumber(answer.noul, `result.answers.${id}.noul`);
      if (value < 0 || value > 1) throw new Error(`result.answers.${id}.noul must be between 0 and 1`);
      normalized[id] = { raw: answer, warnings };
      continue;
    }

    const keys = question.type === "choice"
      ? Object.keys(question.criteria)
      : question.criteria.map((_, index) => String(index));
    const diagnostics = probabilityDiagnostics(answer.probabilities, keys, `result.answers.${id}`);
    if (diagnostics.renormalized) {
      warnings.push(`probabilities summed to ${diagnostics.rawSum}; normalized locally for diagnostics`);
    }

    if (question.type === "choice") {
      if (typeof answer.choice !== "string" || !keys.includes(answer.choice)) {
        throw new Error(`result.answers.${id}.choice is not one of the contract options`);
      }
      normalized[id] = { raw: answer, probabilityDiagnostics: diagnostics, warnings };
      continue;
    }

    const rawScore = finiteNumber(answer.score, `result.answers.${id}.score`);
    const derivedScore = Object.entries(diagnostics.normalized)
      .reduce((sum, [key, probability]) => sum + Number(key) * probability, 0);
    if (Math.abs(rawScore - derivedScore) > 0.02) {
      warnings.push(`reported score ${rawScore} differs from probability-derived score ${derivedScore} by more than 0.02`);
    } else if (Math.abs(rawScore - derivedScore) > 1e-9) {
      warnings.push(`reported score ${rawScore} differs slightly from probability-derived score ${derivedScore}`);
    }
    normalized[id] = { raw: answer, probabilityDiagnostics: diagnostics, derivedScore, warnings };
  }

  const extras = Object.keys(answers).filter(id => !(id in questions));
  if (extras.length) throw new Error(`Response contains unexpected answers: ${extras.join(", ")}`);
  return normalized;
}

const optionalNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
const optionalBoolean = (value: unknown) =>
  typeof value === "boolean" ? value : undefined;

export function evaluateDeterministicGates(
  contract: SupervisionContract,
  stateValue: unknown,
): GateResult {
  const state = asObject(stateValue, "state");
  const a = asObject(state.gateA ?? {}, "state.gateA");
  const b = asObject(state.gateB ?? {}, "state.gateB");

  const requiredA = contract.deterministicPolicies?.gateA?.requiredTrue ?? [];
  const missing = requiredA.filter(key => a[key] !== true);
  const gateA = {
    decision: (missing.length ? "INCOMPLETE" : "PASS") as "PASS" | "INCOMPLETE",
    missing,
  };

  const req = contract.deterministicPolicies?.gateB?.required ?? {};
  const failures: string[] = [];
  const unknown: string[] = [];

  const minPairs = req.minimumValidPairedBatchRuns ?? 3;
  const validPairs = optionalNumber(b.validPairedBatchRuns ?? b.validPairs);
  const enoughPairs = validPairs !== undefined && validPairs >= minPairs;
  if (validPairs === undefined) unknown.push("validPairedBatchRuns");
  else if (!enoughPairs) unknown.push(`validPairedBatchRuns=${validPairs}<${minPairs}`);

  const minImprovement = req.minimumMedianImprovementFraction ?? 0.1;
  const improvement = optionalNumber(b.medianImprovementFraction);
  if (improvement === undefined) unknown.push("medianImprovementFraction");
  else if (improvement < minImprovement) failures.push(`medianImprovementFraction=${improvement}<${minImprovement}`);

  if (req.everyPairedBatchRunMustImprove ?? true) {
    const allImproved = optionalBoolean(b.everyPairedBatchRunImproved ?? b.allPairsImproved);
    if (allImproved === undefined) unknown.push("everyPairedBatchRunImproved");
    else if (!allImproved) failures.push("notEveryPairedBatchRunImproved");
  }

  const invalidAllowed = req.invalidOrMisattributedOutputsAllowed ?? 0;
  const invalid = optionalNumber(b.invalidOrMisattributedOutputs ?? b.invalidTrials);
  if (invalid === undefined) unknown.push("invalidOrMisattributedOutputs");
  else if (invalid > invalidAllowed) failures.push(`invalidOrMisattributedOutputs=${invalid}>${invalidAllowed}`);

  if (req.exactOutputsMustBeStable ?? true) {
    const stable = optionalBoolean(b.exactOutputsStable);
    if (stable === undefined) unknown.push("exactOutputsStable");
    else if (!stable) failures.push("exactOutputsUnstable");
  }

  const captureAllowed = req.additionalObservedCaptureFailuresAllowed ?? 0;
  const captureFailures = optionalNumber(b.additionalObservedCaptureFailures);
  if (captureFailures === undefined) unknown.push("additionalObservedCaptureFailures");
  else if (captureFailures > captureAllowed) failures.push(`additionalObservedCaptureFailures=${captureFailures}>${captureAllowed}`);

  const stallsAllowed = req.additionalObservedBufferingStallsAllowed ?? 0;
  const stalls = optionalNumber(b.additionalObservedBufferingStalls);
  if (stalls === undefined) unknown.push("additionalObservedBufferingStalls");
  else if (stalls > stallsAllowed) failures.push(`additionalObservedBufferingStalls=${stalls}>${stallsAllowed}`);

  let decision: "GO" | "NO-GO" | "INCONCLUSIVE";
  if (!enoughPairs) decision = "INCONCLUSIVE";
  else if (failures.length) decision = "NO-GO";
  else if (unknown.length) decision = "INCONCLUSIVE";
  else decision = "GO";

  return {
    gateA,
    gateB: { decision, failures, unknown },
    productionPhases3To5Authorized: gateA.decision === "PASS" && decision === "GO",
  };
}
