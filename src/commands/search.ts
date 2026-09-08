import { log } from "../core/log";
import {
  clampSearchLimit,
  normalizeSearchTypes,
  searchSpotify,
  type SpotifySearchResult,
  type SpotifySearchType,
} from "../core/spotify-search";

export interface SearchArgs {
  query: string;
  types: SpotifySearchType[];
  limit: number;
  json: boolean;
}

export function parseSearchArgs(args: string[]): SearchArgs {
  const terms: string[] = [];
  let type = "all";
  let limit = 10;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--type" || arg === "-t") {
      const value = args[++i];
      if (!value || value.startsWith("-")) throw new Error(`${arg} requires a search type`);
      type = value;
    } else if (arg === "--limit" || arg === "-n") {
      const value = args[++i];
      if (!value || !/^\d+$/.test(value)) throw new Error("--limit requires an integer");
      limit = clampSearchLimit(Number.parseInt(value, 10));
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--help" || arg === "-h") {
      throw new Error("__HELP__");
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown search option: ${arg}`);
    } else {
      terms.push(arg);
    }
  }

  const query = terms.join(" ").trim();
  if (!query) throw new Error("Search query is required");
  return { query, types: normalizeSearchTypes(type), limit, json };
}

export function formatSearchResults(results: readonly SpotifySearchResult[], json: boolean): string {
  if (json) return JSON.stringify(results, null, 2);
  if (results.length === 0) return "";
  const typeWidth = Math.max(8, ...results.map((item) => item.type.length));
  return results.map((item) => {
    const type = item.type.toUpperCase().padEnd(typeWidth);
    const subtitle = item.subtitle ? ` — ${item.subtitle}` : "";
    return `${type}  ${item.name}${subtitle}\n${" ".repeat(typeWidth + 2)}${item.uri}`;
  }).join("\n");
}

function printSearchHelp(): void {
  console.error(`Usage: soggfy search [options] <query...>

Search Spotify tracks, artists, and playlists.

Options:
  -t, --type <type>  track, artist, playlist, or all (default: all)
  -n, --limit <n>    Results per selected type, 1-50 (default: 10)
      --json         Emit stable JSON to stdout
  -h, --help         Show this help

Examples:
  soggfy search "rick astley"
  soggfy search --type track --limit 5 "never gonna give you up"
  soggfy search --type playlist --json "discover weekly"
`);
}

export async function searchCommand(args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    printSearchHelp();
    return;
  }
  const parsed = parseSearchArgs(args);
  const results = await searchSpotify(parsed.query, { types: parsed.types, limit: parsed.limit });
  const output = formatSearchResults(results, parsed.json);
  if (output) process.stdout.write(`${output}\n`);
  else log.info(`No Spotify results for: ${parsed.query}`);
}
