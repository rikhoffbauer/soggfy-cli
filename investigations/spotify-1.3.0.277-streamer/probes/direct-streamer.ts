import { getAuthenticatedSpotifyWebToken } from "../../../src/core/spotify-renderer-auth.ts";
const debugPort = Number(process.env.SOGGFY_INVESTIGATION_CDP ?? "9231");
import { writeFileSync } from "node:fs";

const fileId = process.argv[2] ?? "56bc9ef82236dc30d6f31d8125fc311b3c2442b9";
const formatEnum = Number(process.argv[3] ?? "1");
const start = BigInt(process.argv[4] ?? "0");
const end = BigInt(process.argv[5] ?? "65536");
const outPath = process.argv[6] ?? "/tmp/soggfy-streamer-chunk.bin";

function readVarint(b: Uint8Array, p: number): [bigint, number] {
  let v = 0n, s = 0n;
  while (p < b.length) {
    const x = b[p++];
    v |= BigInt(x & 0x7f) << s;
    if (!(x & 0x80)) return [v, p];
    s += 7n;
  }
  throw new Error("truncated varint");
}

function parseStorageResolve(b: Uint8Array) {
  let p = 0;
  const urls: string[] = [];
  let result = -1;
  let returnedFileId = "";
  while (p < b.length) {
    let tag; [tag, p] = readVarint(b, p);
    const field = Number(tag >> 3n), wire = Number(tag & 7n);
    if (wire === 0) {
      let v; [v, p] = readVarint(b, p);
      if (field === 1) result = Number(v);
    } else if (wire === 2) {
      let n; [n, p] = readVarint(b, p);
      const len = Number(n), s = b.subarray(p, p + len); p += len;
      if (field === 2) urls.push(new TextDecoder().decode(s));
      if (field === 4) returnedFileId = Buffer.from(s).toString("hex");
    } else throw new Error(`unsupported wire ${wire}`);
  }
  return { result, urls, returnedFileId };
}

const auth = await getAuthenticatedSpotifyWebToken({ debugPort });
const resolveURL = `https://spclient.wg.spotify.com/storage-resolve/v2/files/audio/interactive/${formatEnum}/${fileId}?product=0&partner=`;
const rr = await fetch(resolveURL, {
  headers: { Authorization: `Bearer ${auth.accessToken}`, Accept: "application/x-protobuf", "App-Platform": "WebPlayer" },
});
if (!rr.ok) throw new Error(`storage resolve failed HTTP ${rr.status}`);
const resolved = parseStorageResolve(new Uint8Array(await rr.arrayBuffer()));
if (!resolved.urls.length) throw new Error(`storage resolve returned no CDN URL: ${JSON.stringify(resolved)}`);
const cdnURL = resolved.urls[0];

const targets: any[] = await (await fetch("http://127.0.0.1:" + debugPort + "/json/list")).json();
const target = targets.find(x => x.type === "page" && x.webSocketDebuggerUrl) ?? targets.find(x => x.webSocketDebuggerUrl);
if (!target?.webSocketDebuggerUrl) throw new Error("no renderer CDP target");
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise<void>((resolve, reject) => { ws.onopen = () => resolve(); ws.onerror = () => reject(new Error("CDP websocket failed")); });
let id = 0;
const pending = new Map<number, (m: any) => void>();
ws.onmessage = e => { const m = JSON.parse(String(e.data)); if (m.id && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id); } };
async function evaluate(source: string) {
  const callId = ++id;
  const p = new Promise<any>(r => pending.set(callId, r));
  ws.send(JSON.stringify({ id: callId, method: "Runtime.evaluate", params: { expression: source, awaitPromise: true, returnByValue: true } }));
  const m = await p;
  if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description ?? m.result.exceptionDetails.text);
  return m.result?.result?.value;
}

const source = `(async()=>{
const cdnURL=${JSON.stringify(cdnURL)}, START=BigInt(${JSON.stringify(start.toString())}), END=BigInt(${JSON.stringify(end.toString())});
const root=document.querySelector('[data-testid="root"]')||document.body?.firstElementChild;
const fk=root&&Object.getOwnPropertyNames(root).find(k=>k.startsWith('__reactFiber$'));let f=fk?root[fk]:null;while(f?.return)f=f.return;
const stack=f?[f]:[];let registry=null;
while(stack.length){const c=stack.pop(),v=c?.memoizedProps?.value;if(v&&v._map instanceof Map&&typeof v.resolve==='function'){const ds=[...v._map.keys()].filter(k=>typeof k==='symbol').map(k=>k.description);if(ds.includes('EsperantoTransport')&&ds.includes('PlayerAPI')){registry=v;break}}if(c?.sibling)stack.push(c.sibling);if(c?.child)stack.push(c.child)}
const service=n=>{for(const k of registry._map.keys())if(typeof k==='symbol'&&k.description===n)return registry.resolve(k);throw Error('missing '+n)};
const transport=service('EsperantoTransport'), player=service('PlayerAPI'), playback=service('PlaybackAPI');
const encVar=v=>{v=BigInt(v);const a=[];while(v>127n){a.push(Number(v&127n)|128);v>>=7n}a.push(Number(v));return a};
const fieldBytes=(n,b)=>[...encVar((BigInt(n)<<3n)|2n),...encVar(b.length),...b];
const fieldStr=(n,s)=>fieldBytes(n,[...new TextEncoder().encode(s)]);
const fieldU64=(n,v)=>[...encVar(BigInt(n)<<3n),...encVar(v)];
const parseVar=(b,p)=>{let v=0n,s=0n;for(;;){const x=b[p++];v|=BigInt(x&127)<<s;if(!(x&128))return [v,p];s+=7n}};
const parse=(b)=>{let p=0,o={position:0,totalSize:0,final:false,error:0,data:[],previouslyCached:0,fromNetwork:0,hadCacheError:false};while(p<b.length){let tag;[tag,p]=parseVar(b,p);const f=Number(tag>>3n),w=Number(tag&7n);if(w===0){let v;[v,p]=parseVar(b,p);if(f===1)o.position=Number(v);else if(f===2)o.totalSize=Number(v);else if(f===3)o.final=!!v;else if(f===4)o.error=Number(v);else if(f===6)o.previouslyCached=Number(v);else if(f===7)o.fromNetwork=Number(v);else if(f===8)o.hadCacheError=!!v}else if(w===2){let n;[n,p]=parseVar(b,p);const x=b.slice(p,p+Number(n));p+=Number(n);if(f===5)o.data=[...x]}else throw Error('wire '+w)}return o};
const callSingle=(method,payload)=>transport.callSingle({service:'spotify.download.esperanto.proto.Download',method,payload:new Uint8Array(payload)});
const before=await player.getState(); const beforeInfo=await playback.getPlaybackInfo();
const create=[...fieldStr(1,cdnURL)];
const sidBytes=await callSingle('CreateProgressiveFileStreamer',create); let sid=0n,pp=0;if(sidBytes.length){let tag;[tag,pp]=parseVar(sidBytes,pp);[sid,pp]=parseVar(sidBytes,pp)}
const sidMsg=fieldU64(1,sid);
const req=[...fieldBytes(1,sidMsg),...fieldU64(2,START),...fieldU64(3,END)];
const chunks=[]; const t0=performance.now();
await new Promise((resolve,reject)=>{
 let settled=false;
 const h=transport.call({service:'spotify.download.esperanto.proto.Download',method:'RequestData',payload:new Uint8Array(req)},true,
  b=>{try{const x=parse(b);chunks.push({...x,atMs:performance.now()-t0});if(x.final&&!settled){settled=true;resolve()}}catch(e){if(!settled){settled=true;reject(e)}}},
  e=>{if(!settled){settled=true;reject(e)}});
 setTimeout(()=>{if(!settled){settled=true;try{h.cancel()}catch{};resolve()}},15000);
});
await callSingle('DestroyFileStreamer',sidMsg);
const after=await player.getState(); const afterInfo=await playback.getPlaybackInfo();
const all=chunks.flatMap(x=>x.data);
return JSON.stringify({sid:Number(sid),before:{uri:before?.item?.uri,isPaused:before?.isPaused,position:before?.positionAsOfTimestamp,timestamp:before?.timestamp,playbackId:before?.playbackId,sessionId:before?.sessionId,fileId:beforeInfo?.fileId},after:{uri:after?.item?.uri,isPaused:after?.isPaused,position:after?.positionAsOfTimestamp,timestamp:after?.timestamp,playbackId:after?.playbackId,sessionId:after?.sessionId,fileId:afterInfo?.fileId},chunks:chunks.map(({data,...x})=>({...x,dataLength:data.length,headHex:data.slice(0,32).map(v=>v.toString(16).padStart(2,'0')).join('')})),dataBase64:btoa(String.fromCharCode(...all))});
})()`;

const value = await evaluate(source);
ws.close();
const result = JSON.parse(value);
const data = Buffer.from(result.dataBase64 ?? "", "base64");
delete result.dataBase64;
writeFileSync(outPath, data);
console.log(JSON.stringify({ ...result, resolved, cdnHost: new URL(cdnURL).host, output: outPath, outputBytes: data.length }, null, 2));
