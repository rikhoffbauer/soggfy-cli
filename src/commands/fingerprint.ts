import { existsSync } from "fs";
import { log } from "../core/log";
import { getFingerprint } from "../core/fingerprint";

export async function fingerprintCommand(args: string[]): Promise<void> {
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.error(`
Usage: soggfy fingerprint <audio-file> [length]

Generate audio fingerprint using fpcalc -length 240 -raw -plain.

Options:
  length      Fingerprint duration length in seconds (default: 240)
  -h, --help  Show help
`);
    process.exit(0);
  }

  const filePath = args[0];
  const length = args[1] ? Number(args[1]) : 240;
  if (!Number.isInteger(length) || length <= 0) {
    log.error(`Invalid fingerprint length: ${args[1]}`);
    process.exit(1);
  }

  if (!existsSync(filePath)) {
    log.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  log.info(`Fingerprinting ${filePath} (length=${length}s)...`);
  const result = getFingerprint(filePath, length);

  if (!result) {
    log.error(`Failed to calculate fingerprint for ${filePath}`);
    process.exit(1);
  }

  log.ok(`Fingerprint generated successfully:`);
  console.log(result.fingerprint);
}
