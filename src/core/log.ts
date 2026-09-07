const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

function ts() {
  return new Date().toISOString().replace("T", " ").replace(/\..+/, "");
}

export const log = {
  info: (msg: string) => console.error(`${DIM}${ts()}${RESET} ${BLUE}ℹ${RESET} ${msg}`),
  ok: (msg: string) => console.error(`${DIM}${ts()}${RESET} ${GREEN}✓${RESET} ${msg}`),
  warn: (msg: string) => console.error(`${DIM}${ts()}${RESET} ${YELLOW}⚠${RESET} ${msg}`),
  error: (msg: string) => console.error(`${DIM}${ts()}${RESET} ${RED}✗${RESET} ${msg}`),
  step: (n: number, total: number, msg: string) =>
    console.error(`${DIM}${ts()}${RESET} ${CYAN}[${n}/${total}]${RESET} ${msg}`),
  dim: (msg: string) => console.error(`${DIM}${msg}${RESET}`),
  header: (msg: string) => console.error(`\n${BOLD}${BLUE}${msg}${RESET}\n`),
  progress: (label: string, current: number, total: number) => {
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    const filled = Math.min(25, Math.max(0, Math.floor(pct / 4)));
    const empty = Math.max(0, 25 - filled);
    const bar = "█".repeat(filled) + "░".repeat(empty);
    process.stderr.write(`\r${DIM}${ts()}${RESET} ${CYAN}${label}${RESET} ${bar} ${pct}%`);
    if (pct >= 100) process.stderr.write("\n");
  },
};
