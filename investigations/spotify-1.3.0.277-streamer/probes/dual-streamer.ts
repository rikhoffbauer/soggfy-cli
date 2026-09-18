import { getAuthenticatedSpotifyWebToken } from "../../../src/core/spotify-renderer-auth.ts";
const debugPort = Number(process.env.SOGGFY_INVESTIGATION_CDP ?? "9231");

type Job = { label: string; trackUri: string; fileId: string; formatEnum: number; url?: string };
const jobs: Job[] = [
  { label: "A", trackUri: "spotify:track:05UwCkSH4WUgVGokcJuCdC", fileId: "f38702bf00c1b1271576c399dbc5713f2412132a", formatEnum: 1 },
  { label: "B", trackUri: "spotify:track:05V8xN0HWfnipAFIlOEu3W", fileId: "6c3230af2542446176eb71f54ed0c66000420ef8", formatEnum: 1 },
];

function readVarint(b: Uint8Array, p: number): [bigint, number] {
  let v = 0n, s = 0n;
  for (;;) { const x = b[p++]; v |= BigInt(x & 127) << s; if (!(x & 128)) return [v, p]; s += 7n; }
}
function parseResolve(b: Uint8Array): string[] {
  let p = 0; const urls: string[] = [];
  while (p < b.length) {
    let t; [t, p] = readVarint(b, p); const f = Number(t >> 3n), w = Number(t & 7n);
    if (w === 0) { let _; [_, p] = readVarint(b, p); }
    else if (w === 2) { let n; [n, p] = readVarint(b, p); const x = b.subarray(p, p + Number(n)); p += Number(n); if (f === 2) urls.push(new TextDecoder().decode(x)); }
    else throw new Error("unsupported wire");
  }
  return urls;
}
const auth = await getAuthenticatedSpotifyWebToken({ debugPort });
for (const job of jobs) {
  const u = `https://spclient.wg.spotify.com/storage-resolve/v2/files/audio/interactive/${job.formatEnum}/${job.fileId}?product=0&partner=`;
  const r = await fetch(u, { headers: { Authorization: `Bearer ${auth.accessToken}`, Accept: "application/x-protobuf", "App-Platform": "WebPlayer" } });
  if (!r.ok) throw new Error(`${job.label}: storage resolve HTTP ${r.status}`);
  job.url = parseResolve(new Uint8Array(await r.arrayBuffer()))[0];
  if (!job.url) throw new Error(`${job.label}: no CDN URL`);
}

const targets: any[] = await (await fetch("http://127.0.0.1:" + debugPort + "/json/list")).json();
const target = targets.find(x => x.type === "page" && x.webSocketDebuggerUrl) ?? targets.find(x => x.webSocketDebuggerUrl);
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise<void>((resolve, reject) => { ws.onopen = () => resolve(); ws.onerror = () => reject(new Error("CDP failed")); });
let id = 0; const pending = new Map<number, (m: any) => void>();
ws.onmessage = e => { const m = JSON.parse(String(e.data)); if (m.id && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id); } };
async function evaluate(expression: string) {
  const i = ++id, p = new Promise<any>(r => pending.set(i, r));
  ws.send(JSON.stringify({ id: i, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
  const m = await p;
  if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description ?? m.result.exceptionDetails.text);
  return m.result?.result?.value;
}

const source = `(async()=>{
const JOBS=${JSON.stringify(jobs.map(({label,trackUri,fileId,url})=>({label,trackUri,fileId,url})))};
const preferred=document.querySelector('[data-testid="root"]')||document.body?.firstElementChild;const nodes=preferred?[preferred,...document.querySelectorAll('*')]:[...document.querySelectorAll('*')];let f=null;for(const node of nodes){const fk=Object.getOwnPropertyNames(node).find(k=>k.startsWith('__reactFiber$'));if(fk&&node[fk]){f=node[fk];break}}if(!f)throw new Error('no React fiber');while(f?.return)f=f.return;const st=[f];let reg;
while(st.length){const c=st.pop(),v=c?.memoizedProps?.value;if(v&&v._map instanceof Map){const ds=[...v._map.keys()].filter(k=>typeof k==='symbol').map(k=>k.description);if(ds.includes('EsperantoTransport')&&ds.includes('PlayerAPI')){reg=v;break}}if(c?.sibling)st.push(c.sibling);if(c?.child)st.push(c.child)}
const get=n=>{for(const k of reg._map.keys())if(typeof k==='symbol'&&k.description===n)return reg.resolve(k);throw Error(n)};
const tr=get('EsperantoTransport'),pl=get('PlayerAPI');
const ve=v=>{v=BigInt(v);const a=[];while(v>127n){a.push(Number(v&127n)|128);v>>=7n}a.push(Number(v));return a},fb=(n,b)=>[...ve((BigInt(n)<<3n)|2n),...ve(b.length),...b],fs=(n,s)=>fb(n,[...new TextEncoder().encode(s)]),fu=(n,v)=>[...ve(BigInt(n)<<3n),...ve(v)];
const pv=(b,p)=>{let v=0n,s=0n;for(;;){const x=b[p++];v|=BigInt(x&127)<<s;if(!(x&128))return[v,p];s+=7n}};
const parse=b=>{let p=0,o={position:0,totalSize:0,final:false,error:0,data:null,previouslyCached:0,fromNetwork:0,hadCacheError:false};while(p<b.length){let t;[t,p]=pv(b,p);const f=Number(t>>3n),w=Number(t&7n);if(w===0){let v;[v,p]=pv(b,p);if(f===1)o.position=Number(v);if(f===2)o.totalSize=Number(v);if(f===3)o.final=!!v;if(f===4)o.error=Number(v);if(f===6)o.previouslyCached=Number(v);if(f===7)o.fromNetwork=Number(v);if(f===8)o.hadCacheError=!!v}else if(w===2){let n;[n,p]=pv(b,p);const x=b.slice(p,p+Number(n));p+=Number(n);if(f===5)o.data=x}else throw Error('wire '+w)}return o};
const single=(m,p)=>tr.callSingle({service:'spotify.download.esperanto.proto.Download',method:m,payload:new Uint8Array(p)});
const isCached=async url=>{const b=await single('IsFileFullyCached',fb(1,fs(1,url)));if(!b.length)return false;let p=0,t,v;[t,p]=pv(b,p);[v,p]=pv(b,p);return !!v};
const mk=async j=>{const b=await single('CreateProgressiveFileStreamer',fs(1,j.url));let p=0,t,sid;[t,p]=pv(b,p);[sid,p]=pv(b,p);return {j,sid,sm:fu(1,sid)}};
const size=async s=>await new Promise((resolve,reject)=>{const req=[...fb(1,s.sm),...fu(2,0),...fu(3,1)];let h=tr.call({service:'spotify.download.esperanto.proto.Download',method:'RequestData',payload:new Uint8Array(req)},true,b=>{const x=parse(b);if(x.final)resolve(x.totalSize)},reject);setTimeout(()=>{try{h.cancel()}catch{};reject(Error('size timeout'))},10000)});
const hashHex=async parts=>{const n=parts.reduce((a,x)=>a+x.length,0),all=new Uint8Array(n);let p=0;for(const x of parts){all.set(x,p);p+=x.length}const d=new Uint8Array(await crypto.subtle.digest('SHA-256',all));return [...d].map(x=>x.toString(16).padStart(2,'0')).join('')};
const run=async(stream,total,label,epoch)=>await new Promise((resolve,reject)=>{const req=[...fb(1,stream.sm),...fu(2,0),...fu(3,total)],events=[],parts=[];let done=false;const h=tr.call({service:'spotify.download.esperanto.proto.Download',method:'RequestData',payload:new Uint8Array(req)},true,b=>{const x=parse(b),now=performance.now();if(x.data)parts.push(x.data);events.push({label,atMs:now-epoch,position:x.position,totalSize:x.totalSize,final:x.final,error:x.error,dataLength:x.data?.length||0,previouslyCached:x.previouslyCached,fromNetwork:x.fromNetwork,hadCacheError:x.hadCacheError});if(x.final&&!done){done=true;hashHex(parts).then(hash=>resolve({label,events,hash,headHex:parts[0]?[...parts[0].slice(0,16)].map(v=>v.toString(16).padStart(2,'0')).join(''):''}),reject)}},e=>{if(!done){done=true;reject(e)}});setTimeout(()=>{if(!done){done=true;try{h.cancel()}catch{};reject(Error(label+' timeout'))}},30000)});
const state=s=>({sampledAt:Date.now(),uri:s?.item?.uri,isPaused:s?.isPaused,position:s?.positionAsOfTimestamp,timestamp:s?.timestamp,playbackId:s?.playbackId,sessionId:s?.sessionId});
const effective=s=>s.position+(s.isPaused?0:Math.max(0,s.sampledAt-s.timestamp));
const original=state(await pl.getState()),cachedBefore=Object.fromEntries(await Promise.all(JOBS.map(async j=>[j.label,await isCached(j.url)])));
if(original.isPaused)await pl.resume();await new Promise(r=>setTimeout(r,500));const playBefore=state(await pl.getState());
const streams=await Promise.all(JOBS.map(mk)),sizes=await Promise.all(streams.map(size));
const epoch=performance.now();const [a,b]=await Promise.all([run(streams[0],sizes[0],'A',epoch),run(streams[1],sizes[1],'B',epoch)]);const playAfter=state(await pl.getState());
for(const s of streams)await single('DestroyFileStreamer',s.sm);
const cachedAfter=Object.fromEntries(await Promise.all(JOBS.map(async j=>[j.label,await isCached(j.url)])));
const rereadStreams=await Promise.all(JOBS.map(mk));const reEpoch=performance.now();const [ra,rb]=await Promise.all([run(rereadStreams[0],sizes[0],'A2',reEpoch),run(rereadStreams[1],sizes[1],'B2',reEpoch)]);for(const s of rereadStreams)await single('DestroyFileStreamer',s.sm);
if(original.isPaused){await pl.pause();await pl.seekTo(original.position);await new Promise(r=>setTimeout(r,150))}
const restored=state(await pl.getState());
const summarize=x=>({events:x.events.length,bytes:x.events.reduce((n,e)=>n+e.dataLength,0),network:x.events.reduce((n,e)=>n+e.fromNetwork,0),cached:x.events.reduce((n,e)=>n+e.previouslyCached,0),firstMs:x.events[0]?.atMs,lastMs:x.events.at(-1)?.atMs,hash:x.hash,headHex:x.headHex});
const sa=summarize(a),sb=summarize(b),sra=summarize(ra),srb=summarize(rb),timeline=[...a.events,...b.events].sort((x,y)=>x.atMs-y.atMs),transitions=timeline.slice(1).reduce((n,e,i)=>n+(e.label!==timeline[i].label?1:0),0);
return JSON.stringify({cachedBefore,cachedAfter,sizes,networkRun:{A:sa,B:sb,overlap:sa.firstMs<sb.lastMs&&sb.firstMs<sa.lastMs,transitions,timelineHead:timeline.slice(0,16).map(e=>({label:e.label,atMs:e.atMs,fromNetwork:e.fromNetwork,cached:e.previouslyCached,data:e.dataLength}))},cachedReread:{A:sra,B:srb,hashMatchA:sa.hash===sra.hash,hashMatchB:sb.hash===srb.hash},playback:{original,playBefore,playAfter,effectiveAdvance:effective(playAfter)-effective(playBefore),wallAdvance:playAfter.sampledAt-playBefore.sampledAt,restored}});
})()`;

console.log(await evaluate(source));
ws.close();
