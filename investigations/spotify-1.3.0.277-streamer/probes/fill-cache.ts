import { getAuthenticatedSpotifyWebToken } from "../../../src/core/spotify-renderer-auth.ts";
const debugPort = Number(process.env.SOGGFY_INVESTIGATION_CDP ?? "9231");

const fileId = process.argv[2] ?? "56bc9ef82236dc30d6f31d8125fc311b3c2442b9";
const formatEnum = Number(process.argv[3] ?? "1");
const trackUri = process.argv[4] ?? "spotify:track:575BKqgHeL2srecj3MfGX1";

function rv(b: Uint8Array,p:number):[bigint,number]{let v=0n,s=0n;for(;;){const x=b[p++];v|=BigInt(x&127)<<s;if(!(x&128))return[v,p];s+=7n}}
function parseResolve(b:Uint8Array){let p=0;const urls:string[]=[];while(p<b.length){let t;[t,p]=rv(b,p);const f=Number(t>>3n),w=Number(t&7n);if(w===0){let _;[_,p]=rv(b,p)}else if(w===2){let n;[n,p]=rv(b,p);const x=b.subarray(p,p+Number(n));p+=Number(n);if(f===2)urls.push(new TextDecoder().decode(x))}else throw Error("wire")}return urls}

const auth=await getAuthenticatedSpotifyWebToken({debugPort});
const u=`https://spclient.wg.spotify.com/storage-resolve/v2/files/audio/interactive/${formatEnum}/${fileId}?product=0&partner=`;
const rr=await fetch(u,{headers:{Authorization:`Bearer ${auth.accessToken}`,Accept:"application/x-protobuf","App-Platform":"WebPlayer"}});
if(!rr.ok)throw Error(`resolve HTTP ${rr.status}`);
const urls=parseResolve(new Uint8Array(await rr.arrayBuffer())); if(!urls[0])throw Error("no CDN URL");
const cdnURL=urls[0];

const targets:any[]=await(await fetch("http://127.0.0.1:" + debugPort + "/json/list")).json();
const target=targets.find(x=>x.type==="page"&&x.webSocketDebuggerUrl)??targets.find(x=>x.webSocketDebuggerUrl);
const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise<void>((r,j)=>{ws.onopen=()=>r();ws.onerror=()=>j(new Error("ws"))});
let id=0;const pending=new Map<number,(m:any)=>void>();ws.onmessage=e=>{const m=JSON.parse(String(e.data));if(m.id&&pending.has(m.id)){pending.get(m.id)!(m);pending.delete(m.id)}};
async function ev(expression:string){const i=++id,p=new Promise<any>(r=>pending.set(i,r));ws.send(JSON.stringify({id:i,method:"Runtime.evaluate",params:{expression,awaitPromise:true,returnByValue:true}}));const m=await p;if(m.result?.exceptionDetails)throw Error(m.result.exceptionDetails.exception?.description??m.result.exceptionDetails.text);return m.result?.result?.value}

const src=`(async()=>{
const CDN=${JSON.stringify(cdnURL)}, FILE=${JSON.stringify(fileId)}, TRACK=${JSON.stringify(trackUri)};
const root=document.querySelector('[data-testid="root"]')||document.body?.firstElementChild,fk=Object.getOwnPropertyNames(root).find(k=>k.startsWith('__reactFiber$'));let f=root[fk];while(f?.return)f=f.return;const st=[f];let reg;
while(st.length){const c=st.pop(),v=c?.memoizedProps?.value;if(v&&v._map instanceof Map){const ds=[...v._map.keys()].filter(k=>typeof k==='symbol').map(k=>k.description);if(ds.includes('EsperantoTransport')&&ds.includes('PlaybackAPI')&&ds.includes('PlayerAPI')){reg=v;break}}if(c?.sibling)st.push(c.sibling);if(c?.child)st.push(c.child)}
const get=n=>{for(const k of reg._map.keys())if(typeof k==='symbol'&&k.description===n)return reg.resolve(k);throw Error(n)};
const tr=get('EsperantoTransport'),pb=get('PlaybackAPI'),pl=get('PlayerAPI');
const ve=v=>{v=BigInt(v);const a=[];while(v>127n){a.push(Number(v&127n)|128);v>>=7n}a.push(Number(v));return a},fb=(n,b)=>[...ve((BigInt(n)<<3n)|2n),...ve(b.length),...b],fs=(n,s)=>fb(n,[...new TextEncoder().encode(s)]),fu=(n,v)=>[...ve(BigInt(n)<<3n),...ve(v)];
const pv=(b,p)=>{let v=0n,s=0n;for(;;){const x=b[p++];v|=BigInt(x&127)<<s;if(!(x&128))return[v,p];s+=7n}};
const pr=b=>{let p=0,o={position:0,totalSize:0,final:false,error:0,dataLength:0,previouslyCached:0,fromNetwork:0,hadCacheError:false};while(p<b.length){let t;[t,p]=pv(b,p);const f=Number(t>>3n),w=Number(t&7n);if(w===0){let v;[v,p]=pv(b,p);if(f===1)o.position=Number(v);if(f===2)o.totalSize=Number(v);if(f===3)o.final=!!v;if(f===4)o.error=Number(v);if(f===6)o.previouslyCached=Number(v);if(f===7)o.fromNetwork=Number(v);if(f===8)o.hadCacheError=!!v}else if(w===2){let n;[n,p]=pv(b,p);if(f===5)o.dataLength+=Number(n);p+=Number(n)}else throw Error('wire '+w)}return o};
const single=(m,p)=>tr.callSingle({service:'spotify.download.esperanto.proto.Download',method:m,payload:new Uint8Array(p)});
const isCached=async()=>{const inner=fs(1,CDN),req=fb(1,inner),b=await single('IsFileFullyCached',req);if(!b.length)return false;let p=0,t;[t,p]=pv(b,p);let v;[v,p]=pv(b,p);return !!v};
const beforeState=await pl.getState(), beforeCached=await isCached();
const cb=fs(1,CDN),sidb=await single('CreateProgressiveFileStreamer',cb);let p=0,t,sid;[t,p]=pv(sidb,p);[sid,p]=pv(sidb,p);const sm=fu(1,sid);
const firstReq=[...fb(1,sm),...fu(2,0),...fu(3,1)];let total=0;
await new Promise((resolve,reject)=>{let h=tr.call({service:'spotify.download.esperanto.proto.Download',method:'RequestData',payload:new Uint8Array(firstReq)},true,b=>{const x=pr(b);if(x.totalSize)total=x.totalSize;if(x.final)resolve()},reject);setTimeout(()=>{try{h.cancel()}catch{};reject(Error('size timeout'))},10000)});
const req=[...fb(1,sm),...fu(2,0),...fu(3,total)];const events=[],t0=performance.now();
await new Promise((resolve,reject)=>{let done=false;const h=tr.call({service:'spotify.download.esperanto.proto.Download',method:'RequestData',payload:new Uint8Array(req)},true,b=>{const x=pr(b);events.push({...x,atMs:performance.now()-t0});if(x.final&&!done){done=true;resolve()}},e=>{if(!done){done=true;reject(e)}});setTimeout(()=>{if(!done){done=true;try{h.cancel()}catch{};reject(Error('fill timeout'))}},30000)});
await single('DestroyFileStreamer',sm);
const afterCached=await isCached(),afterState=await pl.getState();
const files=await pb.getFiles(TRACK);const match=files.find(x=>x.fileId===FILE);
return JSON.stringify({beforeCached,afterCached,total,summary:{events:events.length,data:events.reduce((a,x)=>a+x.dataLength,0),previouslyCached:events.reduce((a,x)=>a+x.previouslyCached,0),fromNetwork:events.reduce((a,x)=>a+x.fromNetwork,0),firstAtMs:events[0]?.atMs,lastAtMs:events.at(-1)?.atMs},storage:match,before:{uri:beforeState?.item?.uri,isPaused:beforeState?.isPaused,position:beforeState?.positionAsOfTimestamp,timestamp:beforeState?.timestamp},after:{uri:afterState?.item?.uri,isPaused:afterState?.isPaused,position:afterState?.positionAsOfTimestamp,timestamp:afterState?.timestamp}});
})()`;
console.log(await ev(src));ws.close();
