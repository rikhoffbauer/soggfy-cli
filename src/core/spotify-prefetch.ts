import { getAuthenticatedSpotifyWebToken } from "./spotify-renderer-auth";
import { isSpotifyPrefetchSupported } from "./spotify-compatibility";

export interface PrefetchVariant {
  trackUri: string;
  fileId: string;
  formatEnum: number;
  bitrate: number;
}

export interface PrefetchPolicy {
  formatEnum: number;
  bitrate: number;
}

export interface CurrentPrefetchSelection {
  trackUri: string;
  fileId: string;
  fileBitrate?: number;
  policy: PrefetchPolicy;
}

export interface PrefetchResult {
  variant: PrefetchVariant;
  alreadyCached: boolean;
  cached: boolean;
  totalBytes: number;
  transferredBytes: number;
  networkBytes: number;
  cachedBytes: number;
  events: number;
  elapsedMs: number;
}

export type PrefetchSkipReason =
  | "unsupported-build"
  | "unknown-policy"
  | "ambiguous-variant"
  | "renderer-unavailable";

export interface SpotifyPrefetchAdapterOptions {
  debugPort: number;
  spotifyVersion: string;
  generation: number;
  generationProvider?: () => number;
  fetchImpl?: typeof fetch;
  evaluationTimeoutMs?: number;
}

type PlaybackFile = { fileId?: unknown; formatEnum?: unknown; bitrate?: unknown };

type PendingEvaluation = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

interface CDPTarget {
  type?: string;
  webSocketDebuggerUrl?: string;
}

function abortError(message = "operation aborted"): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

export function readProtoVarint(bytes: Uint8Array, offset: number): [bigint, number] {
  let value = 0n;
  let shift = 0n;
  while (offset < bytes.length) {
    const byte = bytes[offset++]!;
    value |= BigInt(byte & 0x7f) << shift;
    if (!(byte & 0x80)) return [value, offset];
    shift += 7n;
    if (shift > 63n) throw new Error("protobuf varint overflow");
  }
  throw new Error("truncated protobuf varint");
}

export function parseStorageResolveUrls(bytes: Uint8Array): string[] {
  const urls: string[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    let tag: bigint;
    [tag, offset] = readProtoVarint(bytes, offset);
    const field = Number(tag >> 3n);
    const wire = Number(tag & 7n);
    if (wire === 0) {
      [, offset] = readProtoVarint(bytes, offset);
      continue;
    }
    if (wire !== 2) throw new Error(`unsupported storage-resolve wire type ${wire}`);
    let size: bigint;
    [size, offset] = readProtoVarint(bytes, offset);
    const length = Number(size);
    if (!Number.isSafeInteger(length) || length < 0 || offset + length > bytes.length) {
      throw new Error("invalid storage-resolve field length");
    }
    const value = bytes.subarray(offset, offset + length);
    offset += length;
    if (field === 2) urls.push(new TextDecoder().decode(value));
  }
  return urls;
}

function normalizePlaybackFiles(files: unknown): PrefetchVariant[] {
  if (!Array.isArray(files)) return [];
  const variants: PrefetchVariant[] = [];
  for (const raw of files as PlaybackFile[]) {
    const fileId = typeof raw.fileId === "string" ? raw.fileId : "";
    const formatEnum = Number(raw.formatEnum);
    const bitrate = Number(raw.bitrate);
    if (!/^[0-9a-f]{40}$/i.test(fileId)) continue;
    if (!Number.isInteger(formatEnum) || formatEnum < 0 || formatEnum > 0xffff) continue;
    if (!Number.isFinite(bitrate) || bitrate <= 0 || bitrate > 2_000_000) continue;
    variants.push({ trackUri: "", fileId, formatEnum, bitrate });
  }
  return variants;
}

export function derivePrefetchPolicy(
  files: unknown,
  currentFileId: string,
): PrefetchPolicy | null {
  const matches = normalizePlaybackFiles(files).filter((item) => item.fileId === currentFileId);
  if (matches.length !== 1) return null;
  return { formatEnum: matches[0]!.formatEnum, bitrate: matches[0]!.bitrate };
}

export function selectPrefetchVariant(
  trackUri: string,
  files: unknown,
  policy: PrefetchPolicy,
): PrefetchVariant | null {
  const matches = normalizePlaybackFiles(files)
    .filter((item) => item.formatEnum === policy.formatEnum && item.bitrate === policy.bitrate);
  if (matches.length !== 1) return null;
  return { ...matches[0]!, trackUri };
}

export function rangesCoverFile(
  ranges: Array<{ start: number; end: number }>,
  totalBytes: number,
): boolean {
  if (!Number.isSafeInteger(totalBytes) || totalBytes <= 0) return false;
  const normalized = ranges
    .filter((range) => Number.isSafeInteger(range.start) && Number.isSafeInteger(range.end)
      && range.start >= 0 && range.end > range.start && range.start < totalBytes)
    .map((range) => ({ start: range.start, end: Math.min(range.end, totalBytes) }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  if (!normalized.length || normalized[0]!.start !== 0) return false;
  let covered = normalized[0]!.end;
  for (const range of normalized.slice(1)) {
    if (range.start > covered) return false;
    covered = Math.max(covered, range.end);
    if (covered >= totalBytes) return true;
  }
  return covered >= totalBytes;
}

const REGISTRY_PRELUDE = String.raw`
const preferred=document.querySelector('[data-testid="root"]')||document.body?.firstElementChild;
const nodes=preferred?[preferred,...document.querySelectorAll('*')]:[...document.querySelectorAll('*')];
let fiber=null;
for(const node of nodes){
  const fk=Object.getOwnPropertyNames(node).find(k=>k.startsWith('__reactFiber$'));
  if(fk&&node[fk]){fiber=node[fk];break}
}
if(!fiber)throw new Error('Spotify renderer React tree is unavailable');
while(fiber?.return)fiber=fiber.return;
const stack=[fiber];let registry=null;
while(stack.length){
  const current=stack.pop(),value=current?.memoizedProps?.value;
  if(value&&value._map instanceof Map&&typeof value.resolve==='function'){
    const names=[...value._map.keys()].filter(k=>typeof k==='symbol').map(k=>k.description);
    if(names.includes('EsperantoTransport')&&names.includes('PlaybackAPI')){registry=value;break}
  }
  if(current?.sibling)stack.push(current.sibling);
  if(current?.child)stack.push(current.child);
}
if(!registry)throw new Error('Spotify renderer service registry is unavailable');
const service=name=>{
  for(const key of registry._map.keys())if(typeof key==='symbol'&&key.description===name)return registry.resolve(key);
  throw new Error('Spotify renderer service is unavailable: '+name);
};
`;

const PROTO_HELPERS = String.raw`
const ve=value=>{let v=BigInt(value);const out=[];while(v>127n){out.push(Number(v&127n)|128);v>>=7n}out.push(Number(v));return out};
const fb=(field,bytes)=>[...ve((BigInt(field)<<3n)|2n),...ve(bytes.length),...bytes];
const fs=(field,value)=>fb(field,[...new TextEncoder().encode(value)]);
const fu=(field,value)=>[...ve(BigInt(field)<<3n),...ve(value)];
const pv=(bytes,offset)=>{let value=0n,shift=0n;for(;;){if(offset>=bytes.length)throw new Error('truncated varint');const byte=bytes[offset++];value|=BigInt(byte&127)<<shift;if(!(byte&128))return[value,offset];shift+=7n}};
const parseResponse=bytes=>{
  let offset=0;const out={position:0,totalSize:0,final:false,error:0,dataLength:0,previouslyCached:0,fromNetwork:0,hadCacheError:false};
  while(offset<bytes.length){
    let tag;[tag,offset]=pv(bytes,offset);const field=Number(tag>>3n),wire=Number(tag&7n);
    if(wire===0){let value;[value,offset]=pv(bytes,offset);if(field===1)out.position=Number(value);if(field===2)out.totalSize=Number(value);if(field===3)out.final=!!value;if(field===4)out.error=Number(value);if(field===6)out.previouslyCached=Number(value);if(field===7)out.fromNetwork=Number(value);if(field===8)out.hadCacheError=!!value}
    else if(wire===2){let size;[size,offset]=pv(bytes,offset);const length=Number(size);if(field===5)out.dataLength+=length;offset+=length}
    else throw new Error('unsupported response wire '+wire);
  }
  return out;
};
`;

class RendererSession {
  private nextID = 1;
  private pending = new Map<number, PendingEvaluation>();
  private closed = false;

  private constructor(
    private socket: WebSocket,
    private defaultTimeoutMs: number,
  ) {
    socket.addEventListener("message", (event) => this.handleMessage(event));
    socket.addEventListener("close", () => this.failAll(new Error("Spotify renderer session closed")));
    socket.addEventListener("error", () => this.failAll(new Error("Spotify renderer session failed")));
  }

  static async connect(webSocketURL: string, timeoutMs: number): Promise<RendererSession> {
    const socket = new WebSocket(webSocketURL);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Spotify renderer connection timed out")), 5_000);
      socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Spotify renderer connection failed")); }, { once: true });
    });
    return new RendererSession(socket, timeoutMs);
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
      const message = payload?.result?.exceptionDetails?.exception?.description
        ?? payload?.result?.exceptionDetails?.text
        ?? payload?.error?.message
        ?? "Spotify renderer evaluation failed";
      pending.reject(new Error(message));
      return;
    }
    pending.resolve(payload?.result?.result?.value);
  }

  private failAll(error: Error) {
    if (this.closed && this.pending.size === 0) return;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  async evaluate<T>(source: string, timeoutMs = this.defaultTimeoutMs): Promise<T> {
    if (this.closed) throw new Error("Spotify renderer session is closed");
    const id = this.nextID++;
    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Spotify renderer evaluation timed out"));
      }, timeoutMs);
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
      this.socket.send(JSON.stringify({
        id,
        method: "Runtime.evaluate",
        params: { expression: source, awaitPromise: true, returnByValue: true },
      }));
    });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.failAll(new Error("Spotify renderer session closed"));
    try { this.socket.close(); } catch {}
  }
}

export class SpotifyPrefetchAdapter {
  private session?: RendererSession;
  private token?: { accessToken: string; expiresAt: number };
  private operationSeq = 0;
  private cleanupHealthy = true;
  private fetchImpl: typeof fetch;
  private evaluationTimeoutMs: number;

  constructor(private options: SpotifyPrefetchAdapterOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.evaluationTimeoutMs = Math.max(5_000, options.evaluationTimeoutMs ?? 35_000);
    if (!isSpotifyPrefetchSupported(options.spotifyVersion)) {
      throw new Error(`Spotify prefetch is not validated for build ${options.spotifyVersion}`);
    }
  }

  private assertGeneration() {
    if (!this.cleanupHealthy) throw new Error("Spotify prefetch disabled after uncertain cleanup");
    if (this.options.generationProvider && this.options.generationProvider() !== this.options.generation) {
      throw new Error("Spotify prefetch renderer generation changed");
    }
  }

  private async targetURL(): Promise<string> {
    this.assertGeneration();
    const response = await this.fetchImpl(`http://127.0.0.1:${this.options.debugPort}/json/list`);
    if (!response.ok) throw new Error(`Spotify renderer discovery failed with HTTP ${response.status}`);
    const targets = await response.json() as CDPTarget[];
    const target = targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl)
      ?? targets.find((item) => item.webSocketDebuggerUrl);
    if (!target?.webSocketDebuggerUrl) throw new Error("Spotify renderer has no debuggable page target");
    return target.webSocketDebuggerUrl;
  }

  private async renderer(): Promise<RendererSession> {
    this.assertGeneration();
    if (!this.session) {
      this.session = await RendererSession.connect(await this.targetURL(), this.evaluationTimeoutMs);
    }
    return this.session;
  }

  private async playbackFiles(trackUri: string): Promise<unknown> {
    const session = await this.renderer();
    const source = `(async()=>{${REGISTRY_PRELUDE}\nconst files=await service('PlaybackAPI').getFiles(${JSON.stringify(trackUri)});return files.map(x=>({fileId:x.fileId,formatEnum:x.formatEnum,bitrate:x.bitrate}));})()`;
    return await session.evaluate(source);
  }

  async currentSelection(trackUri: string): Promise<CurrentPrefetchSelection | null> {
    this.assertGeneration();
    const session = await this.renderer();
    const source = `(async()=>{${REGISTRY_PRELUDE}\nconst playback=service('PlaybackAPI');const player=service('PlayerAPI');const [info,state,files]=await Promise.all([playback.getPlaybackInfo(),player.getState(),playback.getFiles(${JSON.stringify(trackUri)})]);return {uri:state?.item?.uri??null,fileId:info?.fileId??null,fileBitrate:info?.fileBitrate??null,files:files.map(x=>({fileId:x.fileId,formatEnum:x.formatEnum,bitrate:x.bitrate}))};})()`;
    const selected = await session.evaluate<any>(source);
    this.assertGeneration();
    if (selected?.uri !== trackUri || typeof selected?.fileId !== "string" || !/^[0-9a-f]{40}$/i.test(selected.fileId)) return null;
    const policy = derivePrefetchPolicy(selected.files, selected.fileId);
    if (!policy) return null;
    const fileBitrateNumber = Number(selected.fileBitrate);
    return {
      trackUri,
      fileId: selected.fileId,
      fileBitrate: Number.isFinite(fileBitrateNumber) && fileBitrateNumber > 0 ? fileBitrateNumber : undefined,
      policy,
    };
  }

  async derivePolicy(trackUri: string, currentFileId: string): Promise<PrefetchPolicy | null> {
    this.assertGeneration();
    const policy = derivePrefetchPolicy(await this.playbackFiles(trackUri), currentFileId);
    this.assertGeneration();
    return policy;
  }

  async resolveVariant(trackUri: string, policy: PrefetchPolicy): Promise<PrefetchVariant | null> {
    this.assertGeneration();
    const variant = selectPrefetchVariant(trackUri, await this.playbackFiles(trackUri), policy);
    this.assertGeneration();
    return variant;
  }

  private async authToken(): Promise<string> {
    const now = Date.now();
    if (!this.token || this.token.expiresAt <= now + 15_000) {
      this.token = await getAuthenticatedSpotifyWebToken({
        debugPort: this.options.debugPort,
        fetchImpl: this.fetchImpl,
      });
    }
    return this.token.accessToken;
  }

  private async storageURL(variant: PrefetchVariant, signal?: AbortSignal): Promise<string> {
    this.assertGeneration();
    if (signal?.aborted) throw abortError();
    const url = `https://spclient.wg.spotify.com/storage-resolve/v2/files/audio/interactive/${variant.formatEnum}/${variant.fileId}?product=0&partner=`;
    const response = await this.fetchImpl(url, {
      signal,
      headers: {
        Authorization: `Bearer ${await this.authToken()}`,
        Accept: "application/x-protobuf",
        "App-Platform": "WebPlayer",
      },
    });
    if (!response.ok) throw new Error(`Spotify storage resolve failed with HTTP ${response.status}`);
    const urls = parseStorageResolveUrls(new Uint8Array(await response.arrayBuffer()));
    const resolved = urls[0];
    if (!resolved) throw new Error("Spotify storage resolve returned no CDN URL");
    return resolved;
  }

  private cacheExpression(cdnURL: string): string {
    return `(async()=>{${REGISTRY_PRELUDE}\n${PROTO_HELPERS}\nconst transport=service('EsperantoTransport');const single=(method,payload)=>transport.callSingle({service:'spotify.download.esperanto.proto.Download',method,payload:new Uint8Array(payload)});const bytes=await single('IsFileFullyCached',fb(1,fs(1,${JSON.stringify(cdnURL)})));if(!bytes.length)return false;let offset=0,tag,value;[tag,offset]=pv(bytes,offset);[value,offset]=pv(bytes,offset);return !!value;})()`;
  }

  async isCached(variant: PrefetchVariant, signal?: AbortSignal): Promise<boolean> {
    const cdnURL = await this.storageURL(variant, signal);
    if (signal?.aborted) throw abortError();
    const cached = await (await this.renderer()).evaluate<boolean>(this.cacheExpression(cdnURL));
    this.assertGeneration();
    return cached;
  }

  private prefetchExpression(opID: string, cdnURL: string): string {
    return `(async()=>{${REGISTRY_PRELUDE}\n${PROTO_HELPERS}
const OP=${JSON.stringify(opID)},URL=${JSON.stringify(cdnURL)};
const transport=service('EsperantoTransport');
const single=(method,payload)=>transport.callSingle({service:'spotify.download.esperanto.proto.Download',method,payload:new Uint8Array(payload)});
const cached=async()=>{const bytes=await single('IsFileFullyCached',fb(1,fs(1,URL)));if(!bytes.length)return false;let o=0,t,v;[t,o]=pv(bytes,o);[v,o]=pv(bytes,o);return !!v};
if(await cached())return {alreadyCached:true,cached:true,totalBytes:0,transferredBytes:0,networkBytes:0,cachedBytes:0,events:0};
const sidBytes=await single('CreateProgressiveFileStreamer',fs(1,URL));let offset=0,tag,sid;[tag,offset]=pv(sidBytes,offset);[sid,offset]=pv(sidBytes,offset);const streamer=fu(1,sid);
const ops=globalThis.__soggfyPrefetchOps||(globalThis.__soggfyPrefetchOps=new Map());
const cancelledOps=globalThis.__soggfyPrefetchCancelled||(globalThis.__soggfyPrefetchCancelled=new Set());
if(cancelledOps.has(OP)){cancelledOps.delete(OP);throw new Error('prefetch cancelled')}
let handle=null,destroyed=false,cancelled=false;
const destroy=async()=>{if(destroyed)return;destroyed=true;try{await Promise.race([single('DestroyFileStreamer',streamer),new Promise((_,reject)=>setTimeout(()=>reject(new Error('DestroyFileStreamer timeout')),5000))])}catch(error){throw new Error('prefetch cleanup uncertain: '+String(error))}};
const cancel=async()=>{cancelled=true;try{handle?.cancel?.()}catch{};await destroy()};
ops.set(OP,{cancel});
const request=async(from,length,timeoutMs)=>await new Promise((resolve,reject)=>{let settled=false;const timer=setTimeout(()=>{if(settled)return;settled=true;try{handle?.cancel?.()}catch{};reject(new Error('prefetch request timeout'))},timeoutMs);handle=transport.call({service:'spotify.download.esperanto.proto.Download',method:'RequestData',payload:new Uint8Array([...fb(1,streamer),...fu(2,from),...fu(3,length)])},true,bytes=>{if(settled)return;const event=parseResponse(bytes);if(event.error||event.hadCacheError){settled=true;clearTimeout(timer);reject(new Error('prefetch response error '+event.error));return}if(event.final){settled=true;clearTimeout(timer);resolve(event)}},error=>{if(settled)return;settled=true;clearTimeout(timer);reject(error instanceof Error?error:new Error(String(error)))});});
try{
  const sizeEvent=await request(0,1,10000);const total=Number(sizeEvent.totalSize);if(!Number.isSafeInteger(total)||total<=0)throw new Error('prefetch did not expose a valid total size');
  const ranges=[],summary={transferredBytes:0,networkBytes:0,cachedBytes:0,events:0};let stableTotal=true;
  await new Promise((resolve,reject)=>{let settled=false,timer=null;const arm=()=>{if(timer)clearTimeout(timer);timer=setTimeout(()=>{if(settled)return;settled=true;try{handle?.cancel?.()}catch{};reject(new Error('prefetch fill inactivity timeout'))},15000)};arm();handle=transport.call({service:'spotify.download.esperanto.proto.Download',method:'RequestData',payload:new Uint8Array([...fb(1,streamer),...fu(2,0),...fu(3,total)])},true,bytes=>{if(settled)return;arm();const event=parseResponse(bytes);summary.events++;summary.transferredBytes+=event.dataLength;summary.networkBytes+=event.fromNetwork;summary.cachedBytes+=event.previouslyCached;if(event.totalSize&&event.totalSize!==total)stableTotal=false;if(event.dataLength>0)ranges.push({start:event.position,end:event.position+event.dataLength});if(event.error||event.hadCacheError){settled=true;if(timer)clearTimeout(timer);reject(new Error('prefetch response error '+event.error));return}if(event.final){settled=true;if(timer)clearTimeout(timer);resolve()}},error=>{if(settled)return;settled=true;if(timer)clearTimeout(timer);reject(error instanceof Error?error:new Error(String(error)))});});
  if(cancelled)throw new Error('prefetch cancelled');if(!stableTotal)throw new Error('prefetch total size changed during acquisition');
  ranges.sort((a,b)=>a.start-b.start||a.end-b.end);let covered=0;for(const range of ranges){if(range.start>covered)throw new Error('prefetch range coverage gap');covered=Math.max(covered,Math.min(range.end,total))}if(covered<total)throw new Error('prefetch range coverage incomplete');
  const after=await cached();if(!after)throw new Error('prefetch finished without full-cache confirmation');
  return {alreadyCached:false,cached:true,totalBytes:total,...summary};
}finally{try{await destroy()}finally{ops.delete(OP);cancelledOps.delete(OP)}}
})()`;
  }

  private async cancelOperation(opID: string): Promise<void> {
    if (!this.session) return;
    try {
      await this.session.evaluate(`(async()=>{const cancelled=globalThis.__soggfyPrefetchCancelled||(globalThis.__soggfyPrefetchCancelled=new Set());cancelled.add(${JSON.stringify(opID)});const op=globalThis.__soggfyPrefetchOps?.get(${JSON.stringify(opID)});if(!op)return false;await op.cancel();return true})()`, 5_000);
    } catch (error) {
      this.cleanupHealthy = false;
      throw new Error(`Spotify prefetch cleanup uncertain: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async prefetch(
    variant: PrefetchVariant,
    { signal, timeoutMs = 60_000 }: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<PrefetchResult> {
    this.assertGeneration();
    if (signal?.aborted) throw abortError();
    const started = performance.now();
    const cdnURL = await this.storageURL(variant, signal);
    const opID = `${this.options.generation}:${++this.operationSeq}`;
    const session = await this.renderer();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    let cancelled = false;
    const cancel = async (reason: "abort" | "timeout") => {
      if (cancelled) return;
      cancelled = true;
      await this.cancelOperation(opID);
      if (reason === "abort") throw abortError();
      throw new Error(`Spotify prefetch timed out after ${timeoutMs} ms`);
    };
    const operation = session.evaluate<any>(this.prefetchExpression(opID, cdnURL), Math.max(timeoutMs + 5_000, this.evaluationTimeoutMs));
    const guard = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { void cancel("timeout").catch(reject); }, timeoutMs);
      if (signal) {
        onAbort = () => { void cancel("abort").catch(reject); };
        signal.addEventListener("abort", onAbort, { once: true });
      }
    });
    try {
      const result = await Promise.race([operation, guard]);
      this.assertGeneration();
      return {
        variant,
        alreadyCached: result.alreadyCached === true,
        cached: result.cached === true,
        totalBytes: Number(result.totalBytes || 0),
        transferredBytes: Number(result.transferredBytes || 0),
        networkBytes: Number(result.networkBytes || 0),
        cachedBytes: Number(result.cachedBytes || 0),
        events: Number(result.events || 0),
        elapsedMs: performance.now() - started,
      };
    } finally {
      if (timer) clearTimeout(timer);
      if (signal && onAbort) signal.removeEventListener("abort", onAbort);
    }
  }

  close() {
    this.session?.close();
    this.session = undefined;
  }
}
