type Event = Record<string, unknown>;

function arg(name: string): string {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`missing ${name}`);
  return process.argv[index + 1]!;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function string(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

const eventsPath = arg("--events");
const outputPath = arg("--output");
const sourceLabelIndex = process.argv.indexOf("--source-label");
const sourceLabel =
  sourceLabelIndex >= 0 && process.argv[sourceLabelIndex + 1]
    ? process.argv[sourceLabelIndex + 1]!
    : "retained natural-execution trace";
const text = await Bun.file(eventsPath).text();
const events = text
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line) as Event);

const identities = new Map<number, Event>();
for (const event of events) {
  if (event.event !== "playback_backend_assign") continue;
  const generation = number(event.pendingSourceGeneration);
  const fileId = string(event.fileId);
  if (!generation || !fileId || !/^[0-9a-f]{40}$/i.test(fileId)) continue;
  if (!identities.has(generation)) identities.set(generation, event);
}

const generations = [...identities.keys()].sort((a, b) => a - b);
const rows = generations.map((generation) => {
  const identity = identities.get(generation)!;
  const source = string(identity.pendingSource);
  const relevant = events.filter((event) => event.sourceGeneration === generation);
  const init = relevant.find((event) => event.event === "source_init");
  const peeks = relevant.filter((event) => event.event === "source_peek");
  const consumes = relevant.filter((event) => event.event === "source_consume");
  const resets = relevant.filter(
    (event) => event.event === "source_reset" || event.event === "source_owner_control",
  );
  const teardown = relevant.find((event) => event.event === "source_teardown");
  const teardownAtMs = teardown ? number(teardown.wallMs) : null;
  const lateOperations = teardownAtMs === null
    ? []
    : relevant.filter((event) => {
        if (event.event !== "source_peek" && event.event !== "source_consume") return false;
        const at = number(event.wallMs);
        return at !== null && at > teardownAtMs;
      });

  const lastPeek = peeks.at(-1);
  const lastConsume = consumes.at(-1);
  const peekCalls = lastPeek ? number(lastPeek.peekCalls) ?? peeks.length : 0;
  const consumeCalls = lastConsume ? number(lastConsume.consumeCalls) ?? consumes.length : 0;
  const bytesOffered = lastPeek ? number(lastPeek.bytesOffered) ?? 0 : 0;
  const bytesConsumed = lastConsume ? number(lastConsume.bytesConsumed) ?? 0 : 0;

  const lifecycleComplete =
    !!init &&
    peeks.length > 0 &&
    consumes.length > 0 &&
    !!teardown &&
    lateOperations.length === 0;

  return {
    generation,
    source,
    fileId: string(identity.fileId),
    identityScopeToken: number(identity.identityScopeToken),
    identityScopeSiteOffset: string(identity.identityScopeSiteOffset),
    lifecycle: {
      init: !!init,
      observedPeek: peeks.length > 0,
      observedConsume: consumes.length > 0,
      resetEvents: resets.length,
      teardown: !!teardown,
      lateOperationsAfterTeardown: lateOperations.length,
      lifecycleComplete,
    },
    observedNaturalConsumption: {
      peekCalls,
      consumeCalls,
      bytesOffered,
      bytesConsumed,
    },
    approachAReady:
      lifecycleComplete &&
      peekCalls > 0 &&
      consumeCalls > 0 &&
      bytesConsumed > 0,
    independentConsumptionProven: false,
  };
});

const ready = rows.filter((row) => row.approachAReady);
const report = {
  generatedAt: new Date().toISOString(),
  purpose: "C3a approach-A readiness from natural execution only",
  sourceEvents: sourceLabel,
  generationsWithExactC2Candidate: rows.length,
  generationsWithCompleteNaturalSourceLifecycle: ready.length,
  approachAReady: ready.length > 0,
  independentConsumptionProven: false,
  rows,
  note:
    "Readiness means the exact-identity-correlated natural source generation exposed bounded peek/consume progress and teardown without late operations. It does not prove the source can be driven independently of ordinary playback and therefore cannot pass C3a.",
};

await Bun.write(outputPath, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({
  ...report,
  rows: rows.map((row) => ({
    generation: row.generation,
    fileId: row.fileId,
    approachAReady: row.approachAReady,
    peekCalls: row.observedNaturalConsumption.peekCalls,
    consumeCalls: row.observedNaturalConsumption.consumeCalls,
    bytesConsumed: row.observedNaturalConsumption.bytesConsumed,
    teardown: row.lifecycle.teardown,
    lateOperationsAfterTeardown: row.lifecycle.lateOperationsAfterTeardown,
  })),
}, null, 2));
