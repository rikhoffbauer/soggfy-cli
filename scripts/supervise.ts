#!/usr/bin/env bun
import { TypeSafeClient, type Questions } from "@typesafe-ai/sdk";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import {
  buildQuestions,
  evaluateDeterministicGates,
  normalizeSystemOneResult,
  validateContract,
  type JsonValue,
} from "../src/dev/typesafe-supervision.ts";

const DEFAULT_CONTRACT =
  "docs/superpowers/supervision/2026-09-18-single-instance-prefetch.json";
const DEFAULT_STATE =
  "investigations/spotify-1.3.0.277-streamer/supervision-state.json";

interface Args {
  command: "audit" | "gates" | "models" | "help";
  contract: string;
  state: string;
  sets: string[];
  contexts: Array<{ label: string; path: string }>;
  out?: string;
  dryRun: boolean;
  model?: string;
  timeoutMs?: number;
}

function printUsage(): void {
  console.error(`Usage:
  bun run supervise -- audit --set <question-set> [--set ...] [options]
  bun run supervise -- gates [options]
  bun run supervise -- models
  bun run supervise -- help

Options:
  --contract <path>       Contract JSON (default: ${DEFAULT_CONTRACT})
  --state <path>          Base JSON state (default: ${DEFAULT_STATE})
  --set <name>            Question set to run; repeatable
  --context <label=path>  Attach JSON/text context under state.context[label]; repeatable
  --out <path>            Persist the full audit record
  --dry-run               Print request/gate data without calling TypeSafe
  --model <name>          Override contract/TYPESAFE_DEFAULT_MODEL
  --timeout-ms <ms>       Override contract timeout`);
}

function failUsage(message?: string): never {
  if (message) console.error(message);
  printUsage();
  process.exit(2);
}

function parseArgs(argv: string[]): Args {
  const command = (argv[0] ?? "help") as Args["command"];
  if (!["audit", "gates", "models", "help"].includes(command)) {
    failUsage(`Unknown command: ${command}`);
  }

  const args: Args = {
    command,
    contract: DEFAULT_CONTRACT,
    state: DEFAULT_STATE,
    sets: [],
    contexts: [],
    dryRun: false,
  };

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (!value) throw new Error(`${arg} requires a value`);
      return value;
    };

    switch (arg) {
      case "--contract":
        args.contract = next();
        break;
      case "--state":
        args.state = next();
        break;
      case "--set":
        args.sets.push(next());
        break;
      case "--context": {
        const value = next();
        const equals = value.indexOf("=");
        if (equals <= 0 || equals === value.length - 1) {
          throw new Error("--context must use label=path");
        }
        args.contexts.push({
          label: value.slice(0, equals),
          path: value.slice(equals + 1),
        });
        break;
      }
      case "--out":
        args.out = next();
        break;
      case "--model":
        args.model = next();
        break;
      case "--timeout-ms": {
        const value = Number(next());
        if (!Number.isFinite(value) || value <= 0) {
          throw new Error("--timeout-ms must be a positive number");
        }
        args.timeoutMs = value;
        break;
      }
      case "--dry-run":
        args.dryRun = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (command === "audit" && !args.sets.length) {
    throw new Error("audit requires at least one --set");
  }
  return args;
}

async function readText(path: string): Promise<string> {
  return Bun.file(resolve(path)).text();
}

async function readJson(path: string): Promise<unknown> {
  const text = await readText(path);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Failed to parse JSON ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function readContext(path: string): Promise<JsonValue> {
  const text = await readText(path);
  if (path.endsWith(".json")) {
    try {
      return JSON.parse(text) as JsonValue;
    } catch {
      // Malformed JSON can still be useful evidence when the auditor is asked about it.
    }
  }
  return text;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

async function loadInputs(args: Args) {
  const [contractText, stateText] = await Promise.all([
    readText(args.contract),
    readText(args.state),
  ]);
  const contract = validateContract(JSON.parse(contractText));
  const baseState = JSON.parse(stateText) as JsonValue;
  const context: Record<string, JsonValue> = {};
  const contextProvenance: Record<string, { path: string; sha256: string }> = {};

  for (const item of args.contexts) {
    const absolute = resolve(item.path);
    const text = await readText(absolute);
    context[item.label] = await readContext(absolute);
    contextProvenance[item.label] = {
      path: absolute,
      sha256: sha256(text),
    };
  }

  const state =
    Object.keys(context).length
    && typeof baseState === "object"
    && baseState !== null
    && !Array.isArray(baseState)
      ? { ...baseState, context }
      : baseState;

  return {
    contract,
    state,
    provenance: {
      contractPath: resolve(args.contract),
      contractSha256: sha256(contractText),
      statePath: resolve(args.state),
      stateSha256: sha256(stateText),
      contexts: contextProvenance,
    },
  };
}

async function writeOutput(path: string, value: unknown) {
  const absolute = resolve(path);
  await mkdir(dirname(absolute), { recursive: true });
  await Bun.write(absolute, JSON.stringify(value, null, 2) + "\n");
}

function createClient(): TypeSafeClient {
  // Keep stdout machine-readable even when TYPESAFE_LOG_LEVEL=info/debug.
  const logger = {
    debug: (message: string, ...args: unknown[]) => console.error(message, ...args),
    info: (message: string, ...args: unknown[]) => console.error(message, ...args),
    warn: (message: string, ...args: unknown[]) => console.error(message, ...args),
    error: (message: string, ...args: unknown[]) => console.error(message, ...args),
  };
  return new TypeSafeClient({ logger });
}

async function main() {
  const args = parseArgs(Bun.argv.slice(2));

  if (args.command === "help") {
    printUsage();
    return;
  }

  if (args.command === "models") {
    const client = createClient();
    console.log(JSON.stringify(await client.models.list(), null, 2));
    return;
  }

  const { contract, state, provenance } = await loadInputs(args);
  const gates = evaluateDeterministicGates(contract, state);

  if (args.command === "gates") {
    console.log(JSON.stringify({ contract: contract.name, provenance, gates }, null, 2));
    return;
  }

  const { questions, questionOrigins } = buildQuestions(contract, args.sets);
  const model = args.model ?? contract.typesafe?.model;
  const timeout = args.timeoutMs ?? contract.typesafe?.timeoutMs ?? 60_000;
  const request = { state, questions, ...(model ? { model } : {}) };

  if (args.dryRun) {
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          contract: contract.name,
          provenance,
          sets: args.sets,
          questionOrigins,
          gates,
          request,
        },
        null,
        2,
      ),
    );
    return;
  }

  const client = createClient();
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const response = await client.systemOne(request, { timeout }).withResponse();
  const durationMs = performance.now() - started;
  const normalized = normalizeSystemOneResult(
    questions as Questions,
    response.data,
  );

  const record = {
    version: 1,
    kind: "typesafe-supervision-audit",
    contract: contract.name,
    startedAt,
    durationMs,
    requestId: response.requestId ?? null,
    model: response.data.model,
    usage: response.data.usage,
    provenance,
    sets: args.sets,
    questionOrigins,
    gates,
    answers: response.data.answers,
    normalized,
  };

  if (args.out) await writeOutput(args.out, record);
  console.log(JSON.stringify(record, null, 2));
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
