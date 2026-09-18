import { sendIPC } from "../../../src/core/ipc.ts";

const trackId = process.argv[2];
const expectedFileId = process.argv[3] || undefined;
const decodeSpeed = Number(process.argv[4] ?? "12");
const socketPath = process.env.SOGGFY_INVESTIGATION_SOCKET ?? "/tmp/soggfy130.sock";
const debugPort = Number(process.env.SOGGFY_INVESTIGATION_CDP ?? "9231");
const maxDecodeSpeed = process.env.SOGGFY_INVESTIGATION_ALLOW_HIGH_DECODE_SPEED === "1" ? 256 : 64;
if (!trackId) throw new Error("usage: bun capture-fixture.ts <trackId>");
if (!Number.isFinite(decodeSpeed) || decodeSpeed < 1 || decodeSpeed > maxDecodeSpeed) {
  throw new Error(`decode speed must be between 1 and ${maxDecodeSpeed}`);
}

type CdpTarget = { type?: string; webSocketDebuggerUrl?: string };
const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json() as CdpTarget[];
const target = targets.find(x => x.type === "page" && x.webSocketDebuggerUrl)
  ?? targets.find(x => x.webSocketDebuggerUrl);
if (!target?.webSocketDebuggerUrl) throw new Error("no renderer CDP target");

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise<void>((resolve, reject) => {
  ws.addEventListener("open", () => resolve(), { once: true });
  ws.addEventListener("error", () => reject(new Error("CDP websocket failed")), { once: true });
});
let nextId = 0;
const pending = new Map<number, (message: any) => void>();
ws.addEventListener("message", event => {
  const message = JSON.parse(String(event.data));
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)!(message);
    pending.delete(message.id);
  }
});
async function evaluate(expression: string) {
  const id = ++nextId;
  const wait = new Promise<any>(resolve => pending.set(id, resolve));
  ws.send(JSON.stringify({
    id,
    method: "Runtime.evaluate",
    params: { expression, awaitPromise: true, returnByValue: true },
  }));
  const message = await wait;
  if (message.result?.exceptionDetails) {
    throw new Error(message.result.exceptionDetails.exception?.description ?? message.result.exceptionDetails.text);
  }
  return message.result?.result?.value;
}

const registryPrelude = String.raw`
const preferred=document.querySelector('[data-testid="root"]')||document.body?.firstElementChild;
const nodes=preferred?[preferred,...document.querySelectorAll('*')]:[...document.querySelectorAll('*')];
let f=null;
for(const node of nodes){
  const fk=Object.getOwnPropertyNames(node).find(k=>k.startsWith('__reactFiber$'));
  if(fk&&node[fk]){f=node[fk];break}
}
if(!f)throw new Error('no React fiber');
while(f?.return)f=f.return;
const stack=[f];let registry=null;
while(stack.length){
  const c=stack.pop(),v=c?.memoizedProps?.value;
  if(v&&v._map instanceof Map&&typeof v.resolve==='function'){
    const ds=[...v._map.keys()].filter(k=>typeof k==='symbol').map(k=>k.description);
    if(ds.includes('PlaybackAPI')&&ds.includes('PlayerAPI')){registry=v;break}
  }
  if(c?.sibling)stack.push(c.sibling);if(c?.child)stack.push(c.child)
}
if(!registry)throw new Error('registry unavailable');
const service=n=>{for(const k of registry._map.keys())if(typeof k==='symbol'&&k.description===n)return registry.resolve(k);throw new Error(n)};
`;

async function rendererSnapshot() {
  const value = await evaluate(`(async()=>{${registryPrelude}
    const playback=service('PlaybackAPI'),player=service('PlayerAPI');
    const info=await playback.getPlaybackInfo();
    const state=await player.getState();
    return JSON.stringify({
      fileId:info?.fileId??null,
      fileBitrate:info?.fileBitrate??null,
      audioId:info?.audioId??null,
      uri:state?.item?.uri??null,
      isPaused:state?.isPaused??null,
      position:state?.positionAsOfTimestamp??null,
      playbackId:state?.playbackId??null,
      sessionId:state?.sessionId??null,
    },(k,v)=>typeof v==='bigint'?String(v):v);
  })()`);
  return JSON.parse(value);
}

async function targetFileIds() {
  const uri = `spotify:track:${trackId}`;
  const value = await evaluate(`(async()=>{${registryPrelude}
    const files=await service('PlaybackAPI').getFiles(${JSON.stringify(uri)});
    return JSON.stringify(files.map(x=>({fileId:x.fileId,formatEnum:x.formatEnum,bitrate:x.bitrate})));
  })()`);
  return JSON.parse(value) as Array<{ fileId: string; formatEnum: number; bitrate: number }>;
}

await sendIPC(socketPath, `reset_track ${trackId}`).catch(() => "");
const speedResponse = await sendIPC(socketPath, `set_decode_speed ${decodeSpeed}`);
if (!speedResponse.startsWith("decode speed ")) throw new Error(`failed to set decode speed: ${speedResponse}`);
await sendIPC(socketPath, `set_track ${trackId}`);
const before = await rendererSnapshot();
const candidates = await targetFileIds();
const candidateIds = new Set(candidates.map(x => x.fileId));
const startedAt = performance.now();
const playRequestedWallMs = Date.now();
const playResponse = await sendIPC(socketPath, `play spotify:track:${trackId}`, { retries: 1, timeoutMs: 15_000 });
if (playResponse !== "ok") throw new Error(`play failed: ${playResponse}`);

let identity: any = null;
let identityObservedWallMs: number | null = null;
for (let i = 0; i < 100; i++) {
  const snapshot = await rendererSnapshot().catch(() => null);
  if (snapshot?.uri === `spotify:track:${trackId}` && candidateIds.has(snapshot.fileId)) {
    identity = snapshot;
    identityObservedWallMs = Date.now();
    break;
  }
  await Bun.sleep(100);
}
if (!identity) throw new Error("failed to observe exact playing file identity");
if (expectedFileId && identity.fileId !== expectedFileId) {
  throw new Error(`selected fileId mismatch: expected ${expectedFileId}, got ${identity.fileId}`);
}

let status = "";
for (let i = 0; i < 400; i++) {
  status = await sendIPC(socketPath, `get_status ${trackId}`).catch(() => "");
  if (status === "completed" || status === "cancelled") break;
  await Bun.sleep(150);
}
const elapsedMs = performance.now() - startedAt;
const completedWallMs = Date.now();
if (status !== "completed") {
  await sendIPC(socketPath, "pause", { retries: 1, timeoutMs: 15_000 }).catch(() => "");
  await sendIPC(socketPath, "set_decode_speed 12").catch(() => "");
  throw new Error(`capture did not complete: ${status || "<empty>"}`);
}

const metricsRaw = await sendIPC(socketPath, `get_metrics ${trackId}`);
const metrics = JSON.parse(metricsRaw);
const after = await rendererSnapshot().catch(() => null);
await sendIPC(socketPath, "pause").catch(() => "");
const fileName = metrics.fileName as string;
const bytes = new Uint8Array(await Bun.file(fileName).arrayBuffer());
const sha = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
const sha256 = [...sha].map(v => v.toString(16).padStart(2, "0")).join("");
await sendIPC(socketPath, "set_decode_speed 12").catch(() => "");

console.log(JSON.stringify({
  trackId,
  expectedFileId: expectedFileId ?? null,
  uri: `spotify:track:${trackId}`,
  before,
  candidates,
  identity,
  after,
  elapsedMs,
  playRequestedWallMs,
  identityObservedWallMs,
  completedWallMs,
  decodeSpeed,
  metrics,
  output: { fileName, bytes: bytes.length, sha256 },
}, null, 2));
ws.close();
