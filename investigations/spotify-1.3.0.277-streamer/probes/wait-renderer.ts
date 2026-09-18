const debugPort = Number(process.env.SOGGFY_INVESTIGATION_CDP ?? "9231");
const timeoutMs = Number(process.env.SOGGFY_INVESTIGATION_READY_TIMEOUT_MS ?? "30000");
const required = (process.argv.slice(2).length ? process.argv.slice(2) : ["PlayerAPI", "PlaybackAPI", "EsperantoTransport"]);

const started = performance.now();
let lastError = "";
while (performance.now() - started < timeoutMs) {
  try {
    const targets: any[] = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    const target = targets.find(x => x.type === "page" && x.webSocketDebuggerUrl)
      ?? targets.find(x => x.webSocketDebuggerUrl);
    if (!target?.webSocketDebuggerUrl) throw new Error("no renderer CDP target");

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP open timeout")), 2000);
      ws.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("CDP websocket failed")); }, { once: true });
    });

    const result = await new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Runtime.evaluate timeout")), 2000);
      ws.addEventListener("message", event => {
        const message = JSON.parse(String(event.data));
        if (message.id !== 1) return;
        clearTimeout(timer);
        resolve(message);
      });
      const expression = `(()=>{
        const REQUIRED=${JSON.stringify(required)};
        const root=document.querySelector('[data-testid="root"]')||document.body?.firstElementChild;
        if(!root)return {ready:false,reason:'no-root'};
        const fk=Object.getOwnPropertyNames(root).find(k=>k.startsWith('__reactFiber$'));
        let f=fk?root[fk]:null;if(!f)return {ready:false,reason:'no-fiber'};
        while(f?.return)f=f.return;
        const stack=[f];let registry=null;
        while(stack.length){
          const c=stack.pop(),v=c?.memoizedProps?.value;
          if(v&&v._map instanceof Map&&typeof v.resolve==='function'){
            const names=[...v._map.keys()].filter(k=>typeof k==='symbol').map(k=>k.description);
            if(REQUIRED.every(n=>names.includes(n))){registry=v;break}
          }
          if(c?.sibling)stack.push(c.sibling);
          if(c?.child)stack.push(c.child);
        }
        return {ready:!!registry,reason:registry?'ok':'services-missing'};
      })()`;
      ws.send(JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: { expression, returnByValue: true },
      }));
    });
    ws.close();

    const value = result.result?.result?.value;
    if (value?.ready) {
      console.log(JSON.stringify({ ready: true, debugPort, required, elapsedMs: performance.now() - started }));
      process.exit(0);
    }
    lastError = value?.reason ?? "registry not ready";
  } catch (error) {
    lastError = String(error);
  }
  await Bun.sleep(250);
}

throw new Error(`renderer registry not ready after ${timeoutMs} ms: ${lastError}`);
