import { existsSync } from "fs";

export interface FingerprintResult {
  fingerprint: string;
}

export function getFingerprint(filePath: string, length = 240): FingerprintResult | null {
  if (!existsSync(filePath)) return null;

  try {
    const res = Bun.spawnSync(["fpcalc", "-length", String(length), "-raw", "-plain", filePath]);
    if (res.exitCode !== 0) return null;
    const output = res.stdout.toString().trim();
    if (!output || output.startsWith("ERROR:")) return null;
    return { fingerprint: output };
  } catch {
    return null;
  }
}
