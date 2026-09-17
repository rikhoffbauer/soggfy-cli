import { defaultSpotifyRendererDebugPort } from "./spotify-renderer-auth";

export interface SpotifyRendererLibraryPayload {
  account: { id: string; displayName: string };
  likedSongs: { items: unknown[]; totalCount: number };
  playlists: Array<{
    uri: string;
    name: string;
    description?: string;
    owner?: string;
    images?: unknown[];
    snapshotId?: string;
    contentsAvailable: boolean;
    items: unknown[];
    totalCount: number;
  }>;
}

export interface SpotifyRendererLibraryOptions {
  debugPort?: number;
  fetchImpl?: typeof fetch;
  evaluationTimeoutMs?: number;
}

interface CDPTarget {
  type?: string;
  webSocketDebuggerUrl?: string;
}

interface RendererPage {
  items?: unknown[];
  totalLength?: number;
}

const REGISTRY_PRELUDE = String.raw`
  const root = document.querySelector('[data-testid="root"]') || document.body?.firstElementChild;
  if (!root) throw new Error('Spotify renderer root is unavailable');
  const fiberKey = Object.getOwnPropertyNames(root).find((key) => key.startsWith('__reactFiber$'));
  if (!fiberKey) throw new Error('Spotify renderer React tree is unavailable');
  let fiber = root[fiberKey];
  while (fiber?.return) fiber = fiber.return;
  const stack = fiber ? [fiber] : [];
  let registry = null;
  while (stack.length) {
    const current = stack.pop();
    const value = current?.memoizedProps?.value;
    if (value && value._map instanceof Map && typeof value.resolve === 'function') {
      const descriptions = Array.from(value._map.keys())
        .filter((key) => typeof key === 'symbol')
        .map((key) => key.description);
      if (descriptions.includes('LibraryAPI') && descriptions.includes('PlaylistAPI')) {
        registry = value;
        break;
      }
    }
    if (current?.sibling) stack.push(current.sibling);
    if (current?.child) stack.push(current.child);
  }
  if (!registry) throw new Error('Spotify renderer service registry is unavailable');
  const service = (description) => {
    for (const key of registry._map.keys()) {
      if (typeof key === 'symbol' && key.description === description) return registry.resolve(key);
    }
    throw new Error('Spotify renderer service is unavailable: ' + description);
  };
`;

function expression(body: string): string {
  return `(async () => {${REGISTRY_PRELUDE}\n${body}\n})()`;
}

class RendererSession {
  private nextID = 1;
  private readonly pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  private constructor(
    private readonly socket: WebSocket,
    private readonly evaluationTimeoutMs: number,
  ) {
    socket.addEventListener("message", (event) => this.handleMessage(event));
  }

  static async connect(webSocketURL: string, evaluationTimeoutMs: number): Promise<RendererSession> {
    const socket = new WebSocket(webSocketURL);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Spotify renderer connection timed out")), 5_000);
      socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("Could not connect to the Soggfy Spotify renderer"));
      }, { once: true });
    });
    return new RendererSession(socket, evaluationTimeoutMs);
  }

  private handleMessage(event: MessageEvent) {
    let payload: any;
    try { payload = JSON.parse(String(event.data)); } catch { return; }
    const id = Number(payload?.id);
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    if (payload.error || payload?.result?.exceptionDetails) {
      const detail = payload?.result?.exceptionDetails?.exception?.description
        ?? payload?.result?.exceptionDetails?.text
        ?? payload?.error?.message
        ?? "Spotify renderer evaluation failed";
      pending.reject(new Error(detail));
      return;
    }
    pending.resolve(payload?.result?.result?.value);
  }

  async evaluate<T>(source: string): Promise<T> {
    const id = this.nextID++;
    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Spotify renderer library evaluation timed out"));
      }, this.evaluationTimeoutMs);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      this.socket.send(JSON.stringify({
        id,
        method: "Runtime.evaluate",
        params: { expression: source, awaitPromise: true, returnByValue: true },
      }));
    });
  }

  close() {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(new Error("Spotify renderer session closed"));
    }
    this.pending.clear();
    try { this.socket.close(); } catch {}
  }
}

async function rendererTargetURL(debugPort: number, fetchImpl: typeof fetch): Promise<string> {
  const response = await fetchImpl(`http://127.0.0.1:${debugPort}/json/list`);
  if (!response.ok) throw new Error(`Spotify renderer discovery failed with HTTP ${response.status}`);
  const targets = await response.json() as CDPTarget[];
  const target = targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl)
    ?? targets.find((item) => item.webSocketDebuggerUrl);
  if (!target?.webSocketDebuggerUrl) throw new Error("Soggfy Spotify renderer has no debuggable page target");
  return target.webSocketDebuggerUrl;
}

export async function collectRendererPages(
  fetchPage: (offset: number, limit: number) => Promise<RendererPage>,
  limit: number,
): Promise<{ items: unknown[]; totalCount: number }> {
  const items: unknown[] = [];
  let advertisedTotal = 0;
  for (let page = 0; page < 1000; page += 1) {
    const result = await fetchPage(items.length, limit);
    const pageItems = Array.isArray(result?.items) ? result.items : [];
    const total = Number(result?.totalLength);
    if (Number.isFinite(total) && total > 0) advertisedTotal = Math.max(advertisedTotal, total);
    items.push(...pageItems);
    if (pageItems.length === 0) break;
    if (advertisedTotal > 0 && items.length >= advertisedTotal) break;
  }
  return { items, totalCount: Math.max(advertisedTotal, items.length) };
}

function rendererItemIsLocal(item: unknown): boolean {
  if (!item || typeof item !== "object") return false;
  const value = item as { uri?: unknown; isLocal?: unknown };
  return value.isLocal === true
    || (typeof value.uri === "string" && value.uri.startsWith("spotify:local:"));
}

export async function waitForRendererLikedSongsReady(
  fetchPage: (offset: number, limit: number) => Promise<RendererPage>,
  attempts = 8,
  pollMs = 250,
  sleepImpl: (ms: number) => Promise<unknown> = Bun.sleep,
): Promise<RendererPage> {
  const maxAttempts = Math.max(1, attempts);
  let latest: RendererPage = { items: [], totalLength: 0 };
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    latest = await fetchPage(0, 100);
    const items = Array.isArray(latest?.items) ? latest.items : [];
    const localOnly = items.length > 0 && items.every(rendererItemIsLocal);
    if (!localOnly || attempt === maxAttempts - 1) return latest;
    if (pollMs > 0) await sleepImpl(pollMs);
    else await sleepImpl(0);
  }
  return latest;
}

export async function waitForRendererLibraryReady<T>(
  readReadyValue: () => Promise<T>,
  attempts = 60,
  pollMs = 250,
  sleepImpl: (ms: number) => Promise<unknown> = Bun.sleep,
): Promise<T> {
  const maxAttempts = Math.max(1, attempts);
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await readReadyValue();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const notReady = /Spotify renderer (?:root|React tree|service registry|service) is unavailable/i.test(message);
      if (!notReady || attempt === maxAttempts - 1) throw error;
      await sleepImpl(Math.max(0, pollMs));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Spotify renderer library is unavailable");
}

export async function collectRendererLikedSongs(
  fetchTrackPage: (offset: number, limit: number) => Promise<RendererPage>,
  fetchPlaylistPage: (uri: string, offset: number, limit: number) => Promise<RendererPage>,
  likedSongsUri?: string,
  options: {
    readinessAttempts?: number;
    readinessPollMs?: number;
    sleepImpl?: (ms: number) => Promise<unknown>;
  } = {},
): Promise<{ items: unknown[]; totalCount: number }> {
  if (likedSongsUri) {
    try {
      return await collectRendererPages(
        (offset, limit) => fetchPlaylistPage(likedSongsUri, offset, limit),
        100,
      );
    } catch {
      // Older Spotify builds may expose _likedSongsUri without allowing the
      // pseudo-playlist through PlaylistAPI. Fall back to LibraryAPI.getTracks.
    }
  }

  const readyFirstPage = await waitForRendererLikedSongsReady(
    fetchTrackPage,
    options.readinessAttempts ?? 8,
    options.readinessPollMs ?? 250,
    options.sleepImpl ?? Bun.sleep,
  );
  let firstPage: RendererPage | undefined = readyFirstPage;
  return collectRendererPages(async (offset, limit) => {
    if (offset === 0 && firstPage) {
      const page = firstPage;
      firstPage = undefined;
      return page;
    }
    return fetchTrackPage(offset, limit);
  }, 100);
}

export async function fetchSpotifyRendererLibraryPayload(
  options: SpotifyRendererLibraryOptions = {},
): Promise<SpotifyRendererLibraryPayload> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const debugPort = options.debugPort ?? defaultSpotifyRendererDebugPort();
  const session = await RendererSession.connect(
    await rendererTargetURL(debugPort, fetchImpl),
    Math.max(5_000, options.evaluationTimeoutMs ?? 30_000),
  );

  try {
    const libraryPage = (offset: number, limit: number) => session.evaluate<RendererPage>(expression(`
      const library = service('LibraryAPI');
      return await library.getContents({ offset: ${offset}, limit: ${limit} });
    `));
    const likedPage = (offset: number, limit: number) => session.evaluate<RendererPage>(expression(`
      const library = service('LibraryAPI');
      return await library.getTracks({ offset: ${offset}, limit: ${limit} });
    `));

    const identity = await waitForRendererLibraryReady(() =>
      session.evaluate<{ id: string; likedSongsUri?: string }>(expression(`
        const library = service('LibraryAPI');
        return {
          id: typeof library._currentUsername === 'string' && library._currentUsername
            ? library._currentUsername : 'spotify',
          likedSongsUri: typeof library._likedSongsUri === 'string' && library._likedSongsUri
            ? library._likedSongsUri : undefined,
        };
      `)),
    );

    const contents = await collectRendererPages(libraryPage, 100);
    const likedSongs = await collectRendererLikedSongs(
      likedPage,
      (uri, offset, limit) => session.evaluate<RendererPage>(expression(`
        const playlists = service('PlaylistAPI');
        return await playlists.getContents(${JSON.stringify(uri)}, { offset: ${offset}, limit: ${limit} });
      `)),
      identity.likedSongsUri,
    );
    const playlistEntries = contents.items.filter((item: any) => item?.type === "playlist" && item?.uri);
    const playlists: SpotifyRendererLibraryPayload["playlists"] = [];

    for (const entry of playlistEntries as any[]) {
      const uri = String(entry.uri);
      let contentsAvailable = true;
      let playlistContents: { items: unknown[]; totalCount: number } = { items: [], totalCount: 0 };
      try {
        playlistContents = await collectRendererPages(
          (offset, limit) => session.evaluate<RendererPage>(expression(`
            const playlists = service('PlaylistAPI');
            return await playlists.getContents(${JSON.stringify(uri)}, { offset: ${offset}, limit: ${limit} });
          `)),
          100,
        );
      } catch {
        contentsAvailable = false;
      }
      playlists.push({
        uri,
        name: typeof entry.name === "string" && entry.name ? entry.name : "Untitled playlist",
        description: typeof entry.description === "string" ? entry.description : undefined,
        owner: typeof entry.owner?.name === "string" ? entry.owner.name
          : typeof entry.owner?.displayName === "string" ? entry.owner.displayName : undefined,
        images: Array.isArray(entry.images) ? entry.images : [],
        snapshotId: typeof entry.snapshotId === "string" ? entry.snapshotId : undefined,
        contentsAvailable,
        items: playlistContents.items,
        totalCount: playlistContents.totalCount,
      });
    }

    const owned = playlistEntries.find((entry: any) => entry?.isOwnedBySelf && entry?.owner?.name) as any;
    return {
      account: {
        id: identity?.id || "spotify",
        displayName: typeof owned?.owner?.name === "string" && owned.owner.name
          ? owned.owner.name : identity?.id || "spotify",
      },
      likedSongs,
      playlists,
    };
  } finally {
    session.close();
  }
}
