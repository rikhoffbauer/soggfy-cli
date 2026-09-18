import { sendIPC } from "../../../src/core/ipc.ts";

const socketPath = process.env.SOGGFY_INVESTIGATION_SOCKET ?? "/tmp/soggfy130.sock";
const debugPort = Number(process.env.SOGGFY_INVESTIGATION_CDP ?? "9231");
const settleMs = Number(process.env.SOGGFY_C2_SETTLE_MS ?? "1800");

const sequence = [
  { label: "A1", trackId: "05UwCkSH4WUgVGokcJuCdC", expectedFileId: "f38702bf00c1b1271576c399dbc5713f2412132a" },
  { label: "B", trackId: "05V8xN0HWfnipAFIlOEu3W", expectedFileId: "6c3230af2542446176eb71f54ed0c66000420ef8" },
  { label: "A2", trackId: "05UwCkSH4WUgVGokcJuCdC", expectedFileId: "f38702bf00c1b1271576c399dbc5713f2412132a" },
] as const;

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

async function snapshot() {
  const value = await evaluate(`(async()=>{${registryPrelude}
    const playback=service('PlaybackAPI'),player=service('PlayerAPI');
    const info=await playback.getPlaybackInfo();
    const state=await player.getState();
    return JSON.stringify({
      fileId:info?.fileId??null,
      audioId:info?.audioId??null,
      fileBitrate:info?.fileBitrate??null,
      uri:state?.item?.uri??null,
      isPaused:state?.isPaused??null,
      position:state?.positionAsOfTimestamp??null,
      playbackId:state?.playbackId??null,
      sessionId:state?.sessionId??null,
    },(k,v)=>typeof v==='bigint'?String(v):v);
  })()`);
  return JSON.parse(value);
}

const observations: unknown[] = [];
try {
  for (const step of sequence) {
    const requestedAt = Date.now();
    const playResponse = await sendIPC(socketPath, `play spotify:track:${step.trackId}`, {
      retries: 1,
      timeoutMs: 15_000,
    });
    if (playResponse !== "ok") throw new Error(`${step.label}: play failed: ${playResponse}`);

    let exact: any = null;
    for (let i = 0; i < 100; i++) {
      const current = await snapshot().catch(() => null);
      if (
        current?.uri === `spotify:track:${step.trackId}`
        && current?.fileId === step.expectedFileId
      ) {
        exact = current;
        break;
      }
      await Bun.sleep(100);
    }
    if (!exact) {
      throw new Error(`${step.label}: exact file identity not observed`);
    }

    const identityObservedAt = Date.now();
    await Bun.sleep(settleMs);
    const settled = await snapshot().catch(() => null);
    const pauseResponse = await sendIPC(socketPath, "pause", { retries: 1, timeoutMs: 15_000 });
    observations.push({
      ...step,
      requestedAt,
      identityObservedAt,
      settledAt: Date.now(),
      exact,
      settled,
      pauseResponse,
    });
    await Bun.sleep(450);
  }
} finally {
  await sendIPC(socketPath, "pause", { retries: 1, timeoutMs: 15_000 }).catch(() => "");
  ws.close();
}

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  socketPath,
  debugPort,
  settleMs,
  observations,
}, null, 2));
