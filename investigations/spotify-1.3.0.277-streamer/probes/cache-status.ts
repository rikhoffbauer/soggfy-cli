import { getAuthenticatedSpotifyWebToken } from "../../../src/core/spotify-renderer-auth.ts";

const debugPort = Number(process.env.SOGGFY_INVESTIGATION_CDP ?? "9231");
const fileId = process.argv[2];
const formatEnum = Number(process.argv[3] ?? "1");
if (!fileId) throw new Error("usage: bun cache-status.ts <fileId> [formatEnum]");

function readVarint(bytes: Uint8Array, offset: number): [bigint, number] {
  let value = 0n;
  let shift = 0n;
  while (offset < bytes.length) {
    const byte = bytes[offset++];
    value |= BigInt(byte & 0x7f) << shift;
    if (!(byte & 0x80)) return [value, offset];
    shift += 7n;
  }
  throw new Error("truncated varint");
}

function parseStorageResolve(bytes: Uint8Array): string[] {
  const urls: string[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    let tag;
    [tag, offset] = readVarint(bytes, offset);
    const field = Number(tag >> 3n);
    const wire = Number(tag & 7n);
    if (wire === 0) {
      [, offset] = readVarint(bytes, offset);
      continue;
    }
    if (wire !== 2) throw new Error(`unsupported wire type ${wire}`);
    let size;
    [size, offset] = readVarint(bytes, offset);
    const part = bytes.subarray(offset, offset + Number(size));
    offset += Number(size);
    if (field === 2) urls.push(new TextDecoder().decode(part));
  }
  return urls;
}

const auth = await getAuthenticatedSpotifyWebToken({ debugPort });
const resolveURL = `https://spclient.wg.spotify.com/storage-resolve/v2/files/audio/interactive/${formatEnum}/${fileId}?product=0&partner=`;
const resolvedResponse = await fetch(resolveURL, {
  headers: {
    Authorization: `Bearer ${auth.accessToken}`,
    Accept: "application/x-protobuf",
    "App-Platform": "WebPlayer",
  },
});
if (!resolvedResponse.ok) throw new Error(`storage resolve failed: HTTP ${resolvedResponse.status}`);
const urls = parseStorageResolve(new Uint8Array(await resolvedResponse.arrayBuffer()));
if (!urls[0]) throw new Error("storage resolve returned no CDN URL");
const cdnURL = urls[0];

const targets: any[] = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
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
const evaluate = async (expression: string) => {
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
};

const value = await evaluate(`(async()=>{
  const URL=${JSON.stringify(cdnURL)};
  const root=document.querySelector('[data-testid="root"]')||document.body?.firstElementChild;
  const fk=root&&Object.getOwnPropertyNames(root).find(k=>k.startsWith('__reactFiber$'));
  let f=fk?root[fk]:null;while(f?.return)f=f.return;
  const stack=f?[f]:[];let registry=null;
  while(stack.length){
    const c=stack.pop(),v=c?.memoizedProps?.value;
    if(v&&v._map instanceof Map&&typeof v.resolve==='function'){
      const ds=[...v._map.keys()].filter(k=>typeof k==='symbol').map(k=>k.description);
      if(ds.includes('EsperantoTransport')){registry=v;break}
    }
    if(c?.sibling)stack.push(c.sibling);if(c?.child)stack.push(c.child)
  }
  let key;for(const k of registry._map.keys())if(typeof k==='symbol'&&k.description==='EsperantoTransport')key=k;
  const transport=registry.resolve(key);
  const enc=v=>{v=BigInt(v);const a=[];while(v>127n){a.push(Number(v&127n)|128);v>>=7n}a.push(Number(v));return a};
  const fb=(n,b)=>[...enc((BigInt(n)<<3n)|2n),...enc(b.length),...b];
  const fs=(n,s)=>fb(n,[...new TextEncoder().encode(s)]);
  const request=fb(1,fs(1,URL));
  const bytes=await transport.callSingle({service:'spotify.download.esperanto.proto.Download',method:'IsFileFullyCached',payload:new Uint8Array(request)});
  let cached=false;if(bytes.length>=2)cached=bytes[1]!==0;
  return JSON.stringify({cached});
})()`);

ws.close();
console.log(JSON.stringify({
  fileId,
  formatEnum,
  cdnHost: new URL(cdnURL).host,
  ...JSON.parse(value),
}, null, 2));
