import {
  evaluateC3aEvidence,
  type C3aEvidence,
} from "../../../src/dev/native-source-gates.ts";

function arg(name: string): string {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`missing ${name}`);
  return process.argv[index + 1]!;
}

const inputPath = arg("--evidence");
const outputPath = arg("--output");
const evidence = await Bun.file(inputPath).json() as C3aEvidence;
const result = evaluateC3aEvidence(evidence);

const report = {
  generatedAt: new Date().toISOString(),
  gate: "C3a",
  evidence,
  ...result,
};

await Bun.write(outputPath, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
if (!result.pass) process.exit(1);
