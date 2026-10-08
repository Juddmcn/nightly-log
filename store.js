/* Nightly Log data store.
   Keeps J's data in the private GitHub repo Juddmcn/nightly-log-data, one JSON file per
   collection ({"docs": {id: {...}}}). Exposes a small Firestore-like API (collection/doc,
   set/update/delete/add, onSnapshot) so app.js stays simple.
   Writes are applied locally right away, queued in localStorage, and pushed to GitHub with
   the file's sha; a conflict re-reads the file and re-applies the queued changes. */
(function(){
  const OWNER="Juddmcn", REPO="nightly-log-data";
  const COLLS=["tasks","logs","grades","settings","reviews"];
  const API=`https://api.github.com/repos/${OWNER}/${REPO}`;
  const K=k=>"nl:"+k;
  const lsGet=(k,d)=>{try{const v=localStorage.getItem(K(k));return v==null?d:JSON.parse(v)}catch(e){return d}};
  const lsSet=(k,v)=>{try{localStorage.setItem(K(k),JSON.stringify(v))}catch(e){}};
  const lsDel=k=>{try{localStorage.removeItem(K(k))}catch(e){}};

  let token=lsGet("token",null);
  let server=lsGet("server",{});          // last copy pulled from GitHub, per collection
  let queue=lsGet("queue",[]);             // pending ops [{id,coll,op,doc,data}]
  let view={};                             // server + queued ops
  const listeners=[];
  const statusFns=[];
  let status={state:"idle",at:lsGet("syncedAt",null),pending:queue.length,error:null};

  function clone(x){return x==null?x:JSON.parse(JSON.stringify(x))}
  function isObj(x){return x&&typeof x==="object"&&!Array.isArray(x)}
  function merge(a,b){const o=isObj(a)?{...a}:{};for(const k of Object.keys(b)){o[k]=isObj(b[k])&&isObj(o[k])?merge(o[k],b[k]):b[k]}return o}
  function applyOp(docs,o){
    if(o.op==="set")docs[o.doc]=clone(o.data);
    else if(o.op==="update"){if(docs[o.doc])docs[o.doc]=merge(docs[o.doc],o.data)}
    else if(o.op==="delete")delete docs[o.doc];
  }
  function rebuild(){
    view={};
    for(const c of COLLS)view[c]=clone((server[c]&&server[c].docs)||{});
    for(const o of queue)applyOp(view[o.coll]||(view[o.coll]={}),o);
  }
  function setStatus(p){status={...status,...p,pending:queue.length};statusFns.forEach(f=>{try{f(status)}catch(e){}})}

  /* ---------- snapshots ---------- */
  function snapDoc(id,d){const data=Object.freeze(clone(d));return{id,exists:d!==undefined,data:()=>data===undefined?undefined:data,metadata:{fromCache:false,hasPendingWrites:false}}}
  function emit(coll){
    for(const l of listeners){
      if(coll&&l.coll!==coll)continue;
      const docs=view[l.coll]||{};
      try{
        if(l.doc!==undefined)l.fn(snapDoc(l.doc,docs[l.doc]));
        else{
          let arr=Object.keys(docs).map(id=>snapDoc(id,docs[id]));
          if(l.order){const[f,dir]=l.order;arr.sort((a,b)=>{const x=a.data()[f],y=b.data()[f];if(x===y)return 0;if(x===undefined)return 1;if(y===undefined)return -1;return(x<y?-1:1)*(dir==="desc"?-1:1)})}
          else arr.sort((a,b)=>a.id<b.id?-1:1);
          if(l.limit)arr=arr.slice(0,l.limit);
          l.fn({docs:arr,size:arr.length,empty:!arr.length,docChanges:()=>[],metadata:{fromCache:false,hasPendingWrites:false}});
        }
      }catch(e){console.error(e)}
    }
  }

  /* ---------- GitHub I/O ---------- */
  function b64decode(s){const bin=atob(s.replace(/\s/g,""));const bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);return new TextDecoder().decode(bytes)}
  function b64encode(str){const bytes=new TextEncoder().encode(str);let bin="";for(let i=0;i<bytes.length;i+=0x8000)bin+=String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000));return btoa(bin)}
  function sortKeys(x){if(Array.isArray(x))return x.map(sortKeys);if(isObj(x)){const o={};Object.keys(x).sort().forEach(k=>o[k]=sortKeys(x[k]));return o}return x}
  async function gh(path,opts={}){
    const r=await fetch(API+path,{cache:"no-store",...opts,headers:{Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28",Authorization:"Bearer "+token,...(opts.body?{"Content-Type":"application/json"}:{})}});
    return r;
  }
  async function readFile(coll){
    const r=await gh(`/contents/${coll}.json?ref=main&t=${Date.now()}`);
    if(r.status===404)return{sha:null,json:{docs:{}}};
    if(r.status===401||r.status===403){const e=new Error("auth");e.code="auth";throw e}
    if(!r.ok){const e=new Error("HTTP "+r.status);e.code="http";throw e}
    const j=await r.json();
    let json={docs:{}};try{json=JSON.parse(b64decode(j.content||""))}catch(e){}
    if(!json.docs)json={docs:{}};
    return{sha:j.sha,json};
  }
  async function writeFile(coll,json,sha,msg){
    const body={message:msg,content:b64encode(JSON.stringify(sortKeys(json),null,1)+"\n"),branch:"main"};
    if(sha)body.sha=sha;
    const r=await gh(`/contents/${coll}.json`,{method:"PUT",body:JSON.stringify(body)});
    if(r.status===409||r.status===422){const e=new Error("conflict");e.code="conflict";throw e}
    if(r.status===401||r.status===403){const e=new Error("auth");e.code="auth";throw e}
    if(!r.ok){const e=new Error("HTTP "+r.status);e.code="http";throw e}
    return (await r.json()).content.sha;
  }

  let pulling=null;
  async function pull(){
    if(!token)return;
    if(pulling)return pulling;
    pulling=(async()=>{
      try{
        setStatus({state:queue.length?"saving":"syncing",error:null});
        const res=await Promise.all(COLLS.map(c=>readFile(c).then(f=>[c,f])));
        for(const[c,f]of res)server[c]={sha:f.sha,docs:f.json.docs};
        lsSet("server",server);
        rebuild();COLLS.forEach(emit);
        const at=new Date().toISOString();lsSet("syncedAt",at);
        setStatus({state:queue.length?"saving":"synced",at,error:null});
        if(queue.length)flush();
      }catch(e){handleErr(e)}
      finally{pulling=null}
    })();
    return pulling;
  }
  function handleErr(e){
    if(e&&e.code==="auth"){setStatus({state:"auth",error:"GitHub token isn't working"});return}
    if(!navigator.onLine||(e&&e.name==="TypeError"))setStatus({state:"offline",error:null});
    else setStatus({state:"error",error:e&&e.message||"Sync error"});
  }

  let flushing=false,flushTimer=null;
  function scheduleFlush(){clearTimeout(flushTimer);flushTimer=setTimeout(flush,700)}
  async function flush(){
    if(!token||flushing||!queue.length)return;
    flushing=true;setStatus({state:"saving"});
    try{
      const colls=[...new Set(queue.map(o=>o.coll))];
      for(const c of colls){
        for(let attempt=0;attempt<3;attempt++){
          const ops=queue.filter(o=>o.coll===c);if(!ops.length)break;
          const f=await readFile(c);
          const docs=clone(f.json.docs);ops.forEach(o=>applyOp(docs,o));
          try{
            const sha=await writeFile(c,{docs},f.sha,`app: update ${c}`);
            const done=new Set(ops.map(o=>o.id));
            queue=queue.filter(o=>!done.has(o.id));lsSet("queue",queue);
            server[c]={sha,docs};lsSet("server",server);
            break;
          }catch(e){if(e.code!=="conflict"||attempt===2)throw e}
        }
      }
      rebuild();COLLS.forEach(emit);
      const at=new Date().toISOString();lsSet("syncedAt",at);
      setStatus({state:"synced",at,error:null});
    }catch(e){handleErr(e)}
    finally{flushing=false;if(queue.length&&status.state==="synced")scheduleFlush()}
  }

  function enqueue(coll,op,doc,data){
    const o={id:Date.now().toString(36)+Math.random().toString(36).slice(2,7),coll,op,doc,data:data===undefined?undefined:clone(data)};
    if(op==="update"&&!(view[coll]&&view[coll][doc])){const e=new Error("Document does not exist");e.code="invalid_argument";return Promise.reject(e)}
    queue.push(o);lsSet("queue",queue);
    applyOp(view[coll]||(view[coll]={}),o);emit(coll);
    setStatus({state:token?"saving":"offline"});
    scheduleFlush();
    return Promise.resolve();
  }
  const newId=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,10);

  /* ---------- Firestore-like API ---------- */
  function docRef(coll,id){
    return{id,path:coll+"/"+id,
      get:async()=>snapDoc(id,(view[coll]||{})[id]),
      set:data=>enqueue(coll,"set",id,data),
      update:data=>enqueue(coll,"update",id,data),
      delete:()=>enqueue(coll,"delete",id),
      onSnapshot(fn){const l={coll,doc:id,fn};listeners.push(l);setTimeout(()=>emit(coll),0);return()=>{const i=listeners.indexOf(l);if(i>=0)listeners.splice(i,1)}}};
  }
  function query(coll,order,limit){
    return{
      orderBy:(f,dir)=>query(coll,[f,dir||"asc"],limit),
      limit:n=>query(coll,order,n),
      where(){return this},
      async get(){let out;const l={coll,order,limit,fn:s=>out=s};listeners.push(l);emit(coll);listeners.splice(listeners.indexOf(l),1);return out},
      onSnapshot(fn){const l={coll,order,limit,fn};listeners.push(l);setTimeout(()=>emit(coll),0);return()=>{const i=listeners.indexOf(l);if(i>=0)listeners.splice(i,1)}},
      doc:id=>docRef(coll,id||newId()),
      add:async data=>{const id=newId();await enqueue(coll,"set",id,data);return docRef(coll,id)}
    };
  }
  const db={
    collection:name=>query(name),
    doc:path=>{const[c,id]=path.split("/");return docRef(c,id)}
  };

  rebuild();

  window.NL={
    db,
    hasToken:()=>!!token,
    async connect(t){
      const r=await fetch(API,{cache:"no-store",headers:{Accept:"application/vnd.github+json",Authorization:"Bearer "+t}});
      if(!r.ok)return{ok:false,status:r.status};
      const j=await r.json();
      if(!(j.permissions&&j.permissions.push))return{ok:false,status:"readonly"};
      token=t;lsSet("token",t);await pull();return{ok:true};
    },
    disconnect(){token=null;lsDel("token");setStatus({state:"auth",error:null})},
    pull,flush,
    status:()=>status,
    onStatus(fn){statusFns.push(fn);fn(status)}
  };

  let timer=null;
  function startAuto(){clearInterval(timer);timer=setInterval(()=>{if(document.visibilityState==="visible")pull()},60000)}
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")pull()});
  window.addEventListener("online",()=>{pull()});
  window.addEventListener("offline",()=>setStatus({state:"offline"}));
  startAuto();
})();
