import { chmodSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { dirname, join, relative, resolve, sep } from "path";
import { replaceDirectoryAtomically } from "./atomic-directory";

export interface AuthSnapshotV2 {
  version: 2;
  exportedAt: string;
  files: Record<string, string>;
}

function safeRelativePath(root: string, relPath: string): string {
  if (!relPath || relPath.startsWith("/") || relPath.includes("\0")) {
    throw new Error(`Invalid auth entry path: ${relPath}`);
  }
  const resolvedRoot = resolve(root);
  const fullPath = resolve(resolvedRoot, relPath);
  const prefix = `${resolvedRoot}${sep}`;
  if (!fullPath.startsWith(prefix)) throw new Error(`Refusing auth path outside state root: ${relPath}`);
  return fullPath;
}

export function exportAuthSnapshot(root: string): AuthSnapshotV2 {
  const files: Record<string, string> = {};
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files[relative(root, path)] = readFileSync(path).toString("base64");
    }
  };
  visit(root);
  return { version: 2, exportedAt: new Date().toISOString(), files };
}export function importAuthSnapshot(root: string, snapshot: AuthSnapshotV2): void {
  if (snapshot.version !== 2 || !snapshot.files || typeof snapshot.files !== "object") {
    throw new Error("Unsupported auth snapshot format");
  }
  const stage = `${root}.import-${process.pid}-${Date.now()}`;
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true, mode: 0o700 });
  try {
    for (const [relPath, base64] of Object.entries(snapshot.files)) {
      if (typeof base64 !== "string") throw new Error(`Invalid auth entry: ${relPath}`);
      const fullPath = safeRelativePath(stage, relPath);
      mkdirSync(dirname(fullPath), { recursive: true, mode: 0o700 });
      writeFileSync(fullPath, Buffer.from(base64, "base64"), { mode: 0o600 });
      chmodSync(fullPath, 0o600);
    }
    replaceDirectoryAtomically(stage, root);
  } catch (error) {
    rmSync(stage, { recursive: true, force: true });
    throw error;
  }
}

export function importLegacyAuthSnapshot(root: string, snapshot: any): void {
  if (snapshot?.version !== 1) throw new Error(`Unsupported auth snapshot version: ${snapshot?.version}`);
  const files: Record<string, string> = {};
  if (typeof snapshot.prefs === "string") files.prefs = Buffer.from(snapshot.prefs).toString("base64");
  if (snapshot.users && typeof snapshot.users === "object") {
    for (const [relPath, base64] of Object.entries(snapshot.users)) {
      if (typeof base64 !== "string") throw new Error(`Invalid auth entry: ${relPath}`);
      files[`Users/${relPath}`] = base64;
    }
  }
  importAuthSnapshot(root, { version: 2, exportedAt: new Date().toISOString(), files });
}