type Event = Record<string, unknown>;

const A_FILE_ID = "f38702bf00c1b1271576c399dbc5713f2412132a";
const B_FILE_ID = "6c3230af2542446176eb71f54ed0c66000420ef8";

function arg(name: string): string {
  const i = process.argv.indexOf(name);
  if (i < 0 || !process.argv[i + 1]) throw new Error(`missing ${name}`);
  return process.argv[i + 1]!;
}

async function readEvents(path: string): Promise<Event[]> {
  const text = await Bun.file(path).text();
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Event);
}

function number(e: Event, key: string): number {
  const value = e[key];
  if (typeof value !== "number") throw new Error(`expected number ${key}`);
  return value;
}

function string(e: Event, key: string): string {
  const value = e[key];
  if (typeof value !== "string") throw new Error(`expected string ${key}`);
  return value;
}

function candidates(events: Event[]) {
  const byGeneration = new Map<number, Event>();
  for (const event of events) {
    if (event.event !== "playback_backend_assign") continue;
    if (typeof event.pendingSourceGeneration !== "number") continue;
    if (typeof event.fileId !== "string") continue;
    if (!byGeneration.has(event.pendingSourceGeneration)) {
      byGeneration.set(event.pendingSourceGeneration, event);
    }
  }
  return [...byGeneration.values()].sort(
    (a, b) => number(a, "pendingSourceGeneration") - number(b, "pendingSourceGeneration"),
  );
}

const repeatPath = arg("--repeat-events");
const scopePath = arg("--scope-events");
const outputPath = arg("--output");

const repeatEvents = await readEvents(repeatPath);
const scopeEvents = await readEvents(scopePath);
const repeatCandidates = candidates(repeatEvents);
const scopeCandidates = candidates(scopeEvents);

let aba: Event[] | null = null;
for (let i = 0; i + 2 < repeatCandidates.length; i++) {
  const group = repeatCandidates.slice(i, i + 3);
  if (
    string(group[0]!, "fileId") === A_FILE_ID &&
    string(group[1]!, "fileId") === B_FILE_ID &&
    string(group[2]!, "fileId") === A_FILE_ID
  ) {
    aba = group;
  }
}
if (!aba) throw new Error("A->B->A identity sequence not found");

const [a1, b, a2] = aba;
const bGeneration = number(b!, "pendingSourceGeneration");
const a2Generation = number(a2!, "pendingSourceGeneration");
const pointerReuse =
  string(b!, "pendingSource") === string(a2!, "pendingSource");
const teardownB = repeatEvents.find(
  (e) => e.event === "source_teardown" && e.sourceGeneration === bGeneration,
);
const initA2 = repeatEvents.find(
  (e) => e.event === "source_init" && e.sourceGeneration === a2Generation,
);
const teardownBeforeReuse =
  !!teardownB &&
  !!initA2 &&
  number(teardownB, "wallMs") <= number(initA2, "wallMs");

const seekGeneration = repeatCandidates
  .filter((e) =>
    number(e, "pendingSourceGeneration") > a2Generation &&
    string(e, "fileId") === A_FILE_ID
  )
  .map((e) => number(e, "pendingSourceGeneration"))
  .at(0);
if (!seekGeneration) throw new Error("post-repeat A generation for seek test not found");
const seekResets = repeatEvents.filter(
  (e) => e.event === "source_reset" && e.sourceGeneration === seekGeneration,
);
const seekWrongAssignments = repeatCandidates.filter(
  (e) =>
    number(e, "pendingSourceGeneration") === seekGeneration &&
    string(e, "fileId") !== A_FILE_ID,
);

const scoped = scopeCandidates.filter(
  (e) =>
    typeof e.identityScopeToken === "number" &&
    typeof e.identityScopeSiteOffset === "string",
);
const scopeSites = [...new Set(scoped.map((e) => string(e, "identityScopeSiteOffset")))];
const scopeTokens = [...new Set(scoped.map((e) => number(e, "identityScopeToken")))];
const scopedCanonical = scoped.every(
  (e) => /^[0-9a-f]{40}$/i.test(string(e, "fileId")),
);
const bothKnownScopeSites =
  scopeSites.includes("0xc9cdd4") &&
  scopeSites.includes("0x656d1c");

const report = {
  generatedAt: new Date().toISOString(),
  gate: "C2",
  exactFileIds: { A: A_FILE_ID, B: B_FILE_ID },
  repeatPointerReuse: {
    pass: pointerReuse && teardownBeforeReuse,
    sequence: aba.map((e) => ({
      generation: number(e, "pendingSourceGeneration"),
      fileId: string(e, "fileId"),
      source: string(e, "pendingSource"),
      wallMs: number(e, "wallMs"),
    })),
    pointerReuse,
    teardownBeforeReuse,
  },
  seekRestart: {
    pass: seekResets.length >= 2 && seekWrongAssignments.length === 0,
    generation: seekGeneration,
    resetCount: seekResets.length,
    wrongIdentityAssignments: seekWrongAssignments.length,
  },
  dynamicConstructionScope: {
    pass:
      scoped.length >= 2 &&
      scopeTokens.length >= 2 &&
      bothKnownScopeSites &&
      scopedCanonical,
    candidates: scoped.map((e) => ({
      generation: number(e, "pendingSourceGeneration"),
      source: string(e, "pendingSource"),
      fileId: string(e, "fileId"),
      scopeToken: number(e, "identityScopeToken"),
      scopeSiteOffset: string(e, "identityScopeSiteOffset"),
      sharedCallerOffset: e.sharedCallerOffset ?? null,
    })),
    distinctTokens: scopeTokens,
    distinctSites: scopeSites,
    bothKnownScopeSites,
  },
};

const pass =
  report.repeatPointerReuse.pass &&
  report.seekRestart.pass &&
  report.dynamicConstructionScope.pass;

const finalReport = {
  ...report,
  pass,
  note:
    "Evidence is compositional: the retained repeat/pointer-reuse/seek trace predates transition tokens; a later natural-execution trace validates tokens on both transition branches. The fail-closed binding predicate is verified separately by the native fixture.",
};

await Bun.write(outputPath, JSON.stringify(finalReport, null, 2) + "\n");
console.log(JSON.stringify(finalReport, null, 2));
if (!pass) process.exit(1);
