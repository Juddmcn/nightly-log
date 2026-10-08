(function(){
const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const pad=n=>String(n).padStart(2,"0");
const ymd=d=>d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
const parse=s=>{const[a,b,c]=s.split("-").map(Number);return new Date(a,b-1,c)};
const addDays=(s,n)=>{const d=parse(s);d.setDate(d.getDate()+n);return ymd(d)};
const today=()=>ymd(new Date());
const weekStart=s=>{const d=parse(s);const w=(d.getDay()+6)%7;d.setDate(d.getDate()-w);return ymd(d)};
const AREAS=[["school","School"],["college","College"],["personal","Personal"],["gym","Gym"]];
const PRI={high:0,med:1,low:2};
const DOW=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

let db=null;
const S={tasks:[],logs:{},grades:[],settings:{},settingsExists:false,reviews:[]};
let curDate=today(), dirty=false, form=null;

function toast(m){const t=$("toast");t.textContent=m;t.hidden=false;clearTimeout(toast.h);toast.h=setTimeout(()=>t.hidden=true,1800)}

/* ---------- tabs ---------- */
let tab="log";
try{const h=location.hash.slice(1);if(["log","tasks","stats"].includes(h))tab=h}catch(e){}
function showTab(t){tab=t;["log","tasks","stats"].forEach(x=>$("tab-"+x).hidden=x!==t);
  document.querySelectorAll("nav.tabs button").forEach(b=>b.setAttribute("aria-selected",b.dataset.tab===t));
  $("saveBar").hidden=t!=="log"; if(t==="stats")renderStats(); window.scrollTo(0,0)}
document.querySelectorAll("nav.tabs button").forEach(b=>b.onclick=()=>showTab(b.dataset.tab));

/* ---------- task logic ---------- */
function isDone(t,day){
  if(t.repeat==="daily")return t.lastDone===day;
  if(t.repeat==="weekly")return !!t.lastDone&&t.lastDone>=weekStart(day)&&t.lastDone<=day;
  return !!t.done;
}
function countsToday(t,day){
  if(t.repeat==="daily")return true;
  if(t.repeat==="weekly")return parse(day).getDay()===(t.repeatDay??1)||isDone(t,day);
  if(t.done)return t.doneDate===day;
  return !!t.due&&t.due<=day;
}
function completion(day){
  const c=S.tasks.filter(t=>countsToday(t,day));
  const d=c.filter(t=>isDone(t,day)).length;
  return {done:d,total:c.length,pct:c.length?Math.round(d/c.length*100):null};
}
function restsInWeek(day,logs){
  const ws=weekStart(day);let n=0;
  for(let i=0;i<7;i++){const d=addDays(ws,i);if(d>day)break;if(logs[d]?.gym==="rest")n++}
  return n;
}
function goalParts(log,day){
  const min=S.settings.goals?.schoolMin??1;
  const school=(log?.hours?.school??0)>=min;
  const gym=log?.gym==="done"||(log?.gym==="rest"&&restsInWeek(day,S.logs)<=2);
  const ate=log?.ateWell===true;
  const tasks=log?.completion==null||log.completion>=100;
  return {school,gym,ate,tasks,all:school&&gym&&ate&&tasks};
}
function streaks(){
  const t=today();const run=(test)=>{let d=S.logs[t]?t:addDays(t,-1),n=0;while(S.logs[d]&&test(S.logs[d],d)){n++;d=addDays(d,-1)}return n};
  const best=(test)=>{const ds=Object.keys(S.logs).sort();let b=0,c=0,prev=null;for(const d of ds){if(!test(S.logs[d],d))c=0;else c=(prev&&c>0&&addDays(prev,1)===d)?c+1:1;prev=d;b=Math.max(b,c)}return b};
  const g=(l,d)=>goalParts(l,d).all, a=()=>true;
  return {goal:run(g),log:run(a),bestGoal:best(g),bestLog:best(a)};
}

/* ---------- log form ---------- */
const moodSeg=$("moodSeg");
for(let i=1;i<=10;i++){const b=document.createElement("button");b.type="button";b.dataset.v=i;b.textContent=i;moodSeg.appendChild(b)}
function segSet(el,v){el.querySelectorAll("button").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.v)===String(v)))}
function segBind(el,key,cast){el.addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;
  const v=cast?cast(b.dataset.v):b.dataset.v; form[key]=form[key]===v?null:v; segSet(el,form[key]); dirty=true; updateGymUI(); renderChips()})}
segBind($("gymSeg"),"gym");segBind($("eatSeg"),"eat");segBind(moodSeg,"mood",Number);

function blankForm(){return{hSchool:"",hCollege:"",hPersonal:"",gym:null,eat:null,wHit:"",wFelt:"",prs:[],sleep:"",mood:null,note:""}}
function logToForm(l){if(!l)return blankForm();const v=x=>x==null?"":x;
  return{hSchool:v(l.hours?.school),hCollege:v(l.hours?.college),hPersonal:v(l.hours?.personal),gym:l.gym||null,eat:l.ateWell==null?null:(l.ateWell?"yes":"no"),
    wHit:l.workout?.hit||"",wFelt:l.workout?.felt||"",prs:(l.workout?.prs||[]).map(p=>({...p})),sleep:v(l.sleep),mood:l.mood??null,note:l.note||""}}
function fillForm(){
  form=logToForm(S.logs[curDate]);
  ["hSchool","hCollege","hPersonal","wHit","wFelt","sleep","note"].forEach(k=>$(k).value=form[k]);
  segSet($("gymSeg"),form.gym);segSet($("eatSeg"),form.eat);segSet(moodSeg,form.mood);
  renderPrs();updateGymUI();renderGradeList();renderChips();dirty=false;
  $("logDate").value=curDate;
  const d=parse(curDate);$("logDateLabel").textContent=(curDate===today()?"Today, ":"")+d.toLocaleDateString(undefined,{weekday:"long",month:"short",day:"numeric"});
  $("saveLog").textContent=S.logs[curDate]?"Update log":"Save tonight's log";
}
["hSchool","hCollege","hPersonal","wHit","wFelt","sleep","note"].forEach(k=>$(k).addEventListener("input",e=>{form[k]=e.target.value;dirty=true;if(k.startsWith("h"))renderChips()}));
$("logDate").addEventListener("change",e=>{if(!e.target.value)return;curDate=e.target.value;fillForm()});

function updateGymUI(){
  $("workoutBox").hidden=form.gym==="skipped"||form.gym==="rest";
  const tmp={...S.logs};tmp[curDate]={...(tmp[curDate]||{}),gym:form.gym};
  const n=restsInWeek(curDate,tmp);
  $("restNote").textContent=form.gym==="rest"?(n<=2?`Rest day ${n} of 2 this week. Counts toward your streak if you ate well.`:`That's rest day ${n} this week. Only 2 count toward your streak.`):"";
}
function renderPrs(){
  const box=$("prRows");box.innerHTML="";
  form.prs.forEach((p,i)=>{const r=document.createElement("div");r.className="pr-row";
    r.innerHTML=`<input id="prL${i}" placeholder="Lift" value="${esc(p.lift)}"><input id="prW${i}" type="number" inputmode="decimal" placeholder="lb" value="${esc(p.weight)}"><input id="prR${i}" type="number" inputmode="numeric" placeholder="reps" value="${esc(p.reps)}"><button type="button" class="del" aria-label="Remove">✕</button>`;
    r.querySelector(`#prL${i}`).oninput=e=>{p.lift=e.target.value;dirty=true};
    r.querySelector(`#prW${i}`).oninput=e=>{p.weight=e.target.value;dirty=true};
    r.querySelector(`#prR${i}`).oninput=e=>{p.reps=e.target.value;dirty=true};
    r.querySelector("button").onclick=()=>{form.prs.splice(i,1);dirty=true;renderPrs()};
    box.appendChild(r)});
}
$("addPr").onclick=()=>{form.prs.push({lift:"",weight:"",reps:""});dirty=true;renderPrs();$("prL"+(form.prs.length-1)).focus()};

function renderChips(){
  const c=completion(curDate), isToday=curDate===today();
  const comp=isToday?c.pct:(S.logs[curDate]?.completion??null);
  const fake={hours:{school:parseFloat(form.hSchool)||0},gym:form.gym,ateWell:form.eat==null?null:form.eat==="yes",completion:comp};
  const tmp={...S.logs};tmp[curDate]={...(tmp[curDate]||{}),gym:form.gym};
  const min=S.settings.goals?.schoolMin??1;
  const gp={school:fake.hours.school>=min,gym:fake.gym==="done"||(fake.gym==="rest"&&restsInWeek(curDate,tmp)<=2),ate:fake.ateWell===true,tasks:comp==null||comp>=100};
  const chip=(ok,txt,pending)=>`<span class="chip ${pending?"":ok?"ok":"no"}"><span class="dot"></span>${txt}</span>`;
  const taskTxt=isToday?(c.total?`To-do ${c.done}/${c.total}`:"To-do: nothing due"):(comp==null?"To-do: nothing due":`To-do ${comp}%`);
  $("goalChips").innerHTML=chip(gp.school,`School ${min}h+`,!form.hSchool)+chip(gp.gym,"Workout",!form.gym)+chip(gp.ate,"Ate well",form.eat==null)+chip(gp.tasks,taskTxt,false);
  const st=streaks();$("stGoal").textContent=st.goal;$("stLog").textContent=st.log;
}

function renderGradeList(){
  const g=S.grades.filter(x=>x.date===curDate);
  $("gradeList").innerHTML=g.length?g.map(x=>`<div class="list-line"><span>${esc(x.class)} · ${esc(x.item)}</span><span class="num">${fmtScore(x)}</span></div>`).join(""):`<div class="empty">No grades logged for this day.</div>`;
  const classes=new Set([...(S.settings.classes||[]),...S.grades.map(x=>x.class)].filter(Boolean));
  $("classList").innerHTML=[...classes].map(c=>`<option value="${esc(c)}">`).join("");
}
function fmtScore(x){const p=pct(x);return x.outOf?`${x.score}/${x.outOf} · ${p}%`:`${x.score}%`}
function pct(x){return x.outOf?Math.round(x.score/x.outOf*1000)/10:x.score}
$("addGrade").onclick=async()=>{
  const cls=$("gClass").value.trim(),item=$("gItem").value.trim(),sc=parseFloat($("gScore").value),out=parseFloat($("gOut").value);
  if(!cls||isNaN(sc)){toast("Add a class and a score");return}
  if(!db)return toast("Can't save here");
  try{await db.collection("grades").add({date:curDate,class:cls,item:item||"Grade",score:sc,outOf:isNaN(out)?null:out,created:new Date().toISOString()});
    ["gItem","gScore","gOut"].forEach(k=>$(k).value="");toast("Grade added")}catch(e){toast("Couldn't save grade: "+e.code)}
};

$("saveLog").onclick=async()=>{
  if(!db)return toast("Can't save here");
  const n=v=>{const x=parseFloat(v);return isNaN(x)?null:x};
  const c=completion(curDate), prev=S.logs[curDate];
  const isToday=curDate===today();
  const log={date:curDate,
    hours:{school:n(form.hSchool)??0,college:n(form.hCollege)??0,personal:n(form.hPersonal)??0},
    gym:form.gym,ateWell:form.eat==null?null:form.eat==="yes",
    workout:{hit:form.wHit.trim(),felt:form.wFelt.trim(),prs:form.prs.filter(p=>p.lift.trim()).map(p=>({lift:p.lift.trim(),weight:n(p.weight),reps:n(p.reps)}))},
    sleep:n(form.sleep),mood:form.mood,note:form.note.trim(),
    completion:isToday?c.pct:(prev?.completion??null),tasksDone:isToday?c.done:(prev?.tasksDone??null),tasksTotal:isToday?c.total:(prev?.tasksTotal??null),
    savedAt:new Date().toISOString()};
  $("saveLog").disabled=true;
  try{await db.doc("logs/"+curDate).set(log);dirty=false;toast(prev?"Log updated":"Log saved")}
  catch(e){toast("Couldn't save: "+(e.code||"error"))}
  $("saveLog").disabled=false;
};

/* ---------- tasks ---------- */
let openTask=null, pendingTasks=false;
const showLater={};
function renderTasks(){
  const ae=document.activeElement;
  if(ae&&ae.dataset&&ae.dataset.notes){pendingTasks=true;return}
  pendingTasks=false;
  const day=today(), horizon=addDays(day,7);
  const c=completion(day);
  $("taskSub").textContent=c.total?`${c.done} of ${c.total} due today done`:"Nothing due today";
  renderBen();
  document.querySelectorAll("#viewSeg button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.view===taskView));
  if(taskView==="impact"){$("taskAreas").innerHTML=renderImpact();return}
  const group=(key,name,color,list,extra,byDue)=>{
    const open=list.filter(t=>!isDone(t,day)), doneToday=list.filter(t=>isDone(t,day)&&(t.repeat||t.doneDate===day));
    open.sort(byDue?((a,b)=>((a.due||"9999")<(b.due||"9999")?-1:(a.due===b.due?(PRI[a.priority]??1)-(PRI[b.priority]??1):1))):((a,b)=>(PRI[a.priority]??1)-(PRI[b.priority]??1)||((a.due||"9999")<(b.due||"9999")?-1:1)));
    const soon=open.filter(t=>t.repeat||!t.due||t.due<=horizon), later=open.filter(t=>!(t.repeat||!t.due||t.due<=horizon));
    let rows=[...soon,...doneToday].map(taskRow).join("");
    const doneOld=list.filter(t=>!t.repeat&&t.done&&t.doneDate!==day).sort((a,b)=>(b.doneDate||"")<(a.doneDate||"")?-1:1);
    if(later.length){rows+=showLater[key]?later.map(taskRow).join("")+`<button class="more" data-later="${key}">Hide later</button>`:`<button class="more" data-later="${key}">+ ${later.length} due after ${fmtShort(horizon)}</button>`}
    if(doneOld.length){const dk=key+"-done";rows+=showLater[dk]?doneOld.map(taskRow).join("")+`<button class="more" data-later="${dk}">Hide finished</button>`:`<button class="more" data-later="${dk}" style="display:block">Show ${doneOld.length} finished</button>`}
    return `<section><div class="area-h"><i style="background:var(--${color})"></i>${name}<span class="muted small num" style="margin-left:auto">${open.length} open</span></div><div>${extra||""}${rows||(!extra?`<div class="empty">Nothing here yet.</div>`:"")}</div></section>`;
  };
  const school=S.tasks.filter(t=>t.area==="school");
  const assess=school.filter(t=>kindOf(t)!=="homework"), hw=school.filter(t=>kindOf(t)==="homework");
  const g=S.logs[day]?.gym;const lab={done:"Done",rest:"Rest day",skipped:"Skipped"}[g]||"Not logged yet";
  const gymExtra=`<div class="task ${g==="done"||g==="rest"?"done":""}"><button class="ck" data-golog="1" aria-label="Log workout">${g==="done"||g==="rest"?"✓":""}</button><div class="body"><div class="t">Daily workout</div><div class="meta"><span class="tag">Daily</span><span class="tag">${lab}</span></div></div></div>`;
  $("taskAreas").innerHTML=
    group("assess","Quizzes &amp; tests · upcoming","bad",assess,"",true)+
    group("hw","Homework · upcoming","school",hw,"",true)+
    group("college","College","college",S.tasks.filter(t=>t.area==="college"))+
    group("personal","Personal","personal",S.tasks.filter(t=>t.area==="personal"))+
    group("gym","Gym","gym",S.tasks.filter(t=>t.area==="gym"),gymExtra);
}

/* ---------- grade impact ---------- */
let taskView="sections", impactOrder="asc";
try{const v=localStorage.getItem("taskView");if(v==="impact"||v==="sections")taskView=v}catch(e){}
const DEF_W={tests:50,quizzes:20,homework:30};
const MIN_N={test:4,quiz:6,homework:20};
function kindOf(t){
  if(t.kind)return t.kind;
  const s=(t.title||"").toLowerCase();
  if(/study|choice board|guide|prep/.test(s))return "homework";
  if(/quiz/.test(s))return "quiz";
  if(/exam|midterm|\btest\b|debate performance/.test(s))return "test";
  return "homework";
}
const CAT={test:"tests",quiz:"quizzes",homework:"homework"};
function weightsFor(c){return {...DEF_W,...((S.settings.weights||{})[c]||{})}}
function classAvg(c){const g=S.grades.filter(x=>x.class===c);if(!g.length)return null;return g.reduce((s,x)=>s+pct(x),0)/g.length}
function impactOf(t){
  if(!t.class||t.area!=="school")return null;
  if(typeof t.weightPct==="number")return t.weightPct;
  const k=kindOf(t),w=weightsFor(t.class)[CAT[k]]??0;
  const n=Math.max(S.tasks.filter(x=>x.class===t.class&&kindOf(x)===k).length,MIN_N[k]);
  let p=w/n; if(/final exam/i.test(t.title))p*=1.5;
  return Math.round(p*100)/100;
}
function boostOf(t){const p=impactOf(t);if(p==null)return null;const a=classAvg(t.class);const m=a==null?1:1+Math.max(0,90-a)/20;return {pct:p,score:p*m,avg:a}}
function impactLabel(score){return score>=5?"High":score>=2.5?"Med":"Low"}
function renderImpact(){
  const day=today();
  const list=S.tasks.filter(t=>t.area==="school"&&!isDone(t,day)).map(t=>({t,b:boostOf(t)})).filter(x=>x.b);
  if(!list.length)return `<section><div class="empty">No school assignments to rank yet.</div></section>`;
  list.sort((a,b)=>impactOrder==="asc"?a.b.score-b.b.score:b.b.score-a.b.score);
  const max=Math.max(...list.map(x=>x.b.score));
  const rows=list.map(({t,b},i)=>{const lab=impactLabel(b.score);
    return `<div class="imp"><div class="row" style="justify-content:space-between;gap:8px;flex-wrap:nowrap"><div style="min-width:0"><div class="t" style="overflow-wrap:anywhere"><span class="num muted">${i+1}.</span> ${esc(t.title)}</div>
      <div class="meta"><span class="tag cls">${esc(t.class)}</span><span class="tag">${{test:"Test",quiz:"Quiz",homework:"Homework"}[kindOf(t)]}</span>${t.due?`<span class="tag ${t.due<day?"over":""}">${t.due<day?"Overdue":"Due"} ${fmtShort(t.due)}</span>`:""}</div></div>
      <div style="text-align:right;flex:none"><span class="lvl lvl-${lab.toLowerCase()}">${lab}</span><div class="small num muted">~${b.pct}% of grade</div></div></div>
      <div class="bar" style="margin-top:6px"><div style="width:${Math.max(3,b.score/max*100)}%;background:var(--imp-${lab.toLowerCase()})"></div></div></div>`}).join("");
  return `<section style="border-top:0"><div class="row" style="justify-content:space-between"><h2>Ranked by grade impact</h2>
    <div class="seg" id="ordSeg" style="width:170px"><button type="button" data-ord="asc" aria-pressed="${impactOrder==="asc"}">Low → High</button><button type="button" data-ord="desc" aria-pressed="${impactOrder==="desc"}">High → Low</button></div></div>
    <div class="small muted">Each assignment's estimated share of its class's semester grade, from the class weights on the Stats tab. Classes where your average is under 90% get boosted, since there's more to gain there.</div>
    <div>${rows}</div></section>`;
}
function renderWeights(){
  const cls=[...new Set([...(S.settings.classes||[]),...S.tasks.map(t=>t.class).filter(Boolean)])].sort();
  if(!cls.length){$("weightBox").innerHTML=emptyChart("Classes appear here once assignments are synced.");return}
  $("weightBox").innerHTML=cls.map((c,i)=>{const w=weightsFor(c),a=classAvg(c),set=!!(S.settings.weights||{})[c];
    return `<div class="card" style="display:flex;flex-direction:column;gap:8px"><div class="row" style="justify-content:space-between"><b>${esc(c)}</b><span class="small muted">${a==null?"no grades yet":"avg "+Math.round(a*10)/10+"%"}${set?"":" · default weights"}</span></div>
      <div class="grid3"><label class="f">Tests %<input type="number" inputmode="numeric" id="w${i}t" data-wc="${esc(c)}" data-wk="tests" value="${w.tests}"></label><label class="f">Quizzes %<input type="number" inputmode="numeric" id="w${i}q" data-wc="${esc(c)}" data-wk="quizzes" value="${w.quizzes}"></label><label class="f">Homework %<input type="number" inputmode="numeric" id="w${i}h" data-wc="${esc(c)}" data-wk="homework" value="${w.homework}"></label></div></div>`}).join("");
}
document.addEventListener("change",async e=>{
  const c=e.target.dataset&&e.target.dataset.wc;if(!c)return;
  const v=parseFloat(e.target.value);if(isNaN(v))return;
  const cur=weightsFor(c);cur[e.target.dataset.wk]=v;
  const all={...(S.settings.weights||{})};all[c]=cur;
  await saveSettings({weights:all});toast("Weights saved");
});
function taskRow(t){
  const day=today(),done=isDone(t,day);const tags=[];
  if(t.priority==="high")tags.push(`<span class="tag high">High</span>`);else if(t.priority==="low")tags.push(`<span class="tag">Low</span>`);
  if(t.repeat==="daily")tags.push(`<span class="tag">Daily</span>`);
  if(t.repeat==="weekly")tags.push(`<span class="tag">Weekly · ${DOW[t.repeatDay??1]}</span>`);
  if(!t.repeat&&!done&&t.due){if(t.due<day)tags.push(`<span class="tag over">Overdue · ${fmtShort(t.due)}</span>`);else if(t.due===day)tags.push(`<span class="tag today">Due today</span>`);else tags.push(`<span class="tag">Due ${fmtShort(t.due)}</span>`)}
  if(!t.repeat&&!done&&t.created&&t.created.slice(0,10)<day&&(!t.due||t.due>=day))tags.push(`<span class="tag">Carried over</span>`);
  if(t.class)tags.unshift(`<span class="tag cls">${esc(t.class)}</span>`);
  if(t.dueTime&&!done&&t.due)tags.push(`<span class="tag">${esc(t.dueTime)}</span>`);
  if(t.ai==="yes")tags.push(`<span class="tag ai-yes">AI used</span>`);else if(t.ai==="no")tags.push(`<span class="tag ai-no">No AI</span>`);
  if(t.notes)tags.push(`<span class="tag note">Notes</span>`);
  const bo=!done?boostOf(t):null;
  if(bo){const l=impactLabel(bo.score);tags.push(`<span class="lvl lvl-${l.toLowerCase()}">${l} impact</span>`)}
  const open=openTask===t.id, id=esc(t.id);
  const kd=kindOf(t);
  const detail=open?`<div class="detail">
    ${t.details?`<div class="canvas">${esc(t.details)}</div>`:""}
    ${t.area==="school"?`<div class="row" style="justify-content:space-between"><span class="small">Type${bo?` · ~${bo.pct}% of grade`:""}</span>
      <div class="seg" style="width:230px"><button type="button" data-kind="homework" data-id="${id}" aria-pressed="${kd==="homework"}">HW</button><button type="button" data-kind="quiz" data-id="${id}" aria-pressed="${kd==="quiz"}">Quiz</button><button type="button" data-kind="test" data-id="${id}" aria-pressed="${kd==="test"}">Test</button></div></div>`:""}
    <div class="row" style="justify-content:space-between"><span class="small">Used AI support?</span>
      <div class="seg" style="width:150px"><button type="button" data-ai="yes" data-id="${id}" aria-pressed="${t.ai==="yes"}">Yes</button><button type="button" data-ai="no" data-id="${id}" aria-pressed="${t.ai==="no"}">No</button></div></div>
    <label class="f">Notes<textarea id="notes-${id}" data-notes="${id}" rows="3" placeholder="How it went, what you'd do differently…">${esc(t.notes||"")}</textarea></label>
  </div>`:"";
  return `<div class="task-wrap"><div class="task ${done?"done":""}"><button class="ck" data-tg="${id}" aria-label="${done?"Mark not done":"Mark done"}">${done?"✓":""}</button><div class="body" data-open="${id}" role="button" tabindex="0" aria-expanded="${open}"><div class="t">${esc(t.title)}</div>${tags.length?`<div class="meta">${tags.join("")}</div>`:""}</div><button class="del" data-del="${id}" aria-label="Delete">✕</button></div>${detail}</div>`;
}
$("taskAreas").addEventListener("focusout",async e=>{
  const n=e.target.dataset&&e.target.dataset.notes;if(!n)return;
  const t=S.tasks.find(x=>x.id===n),v=e.target.value.trim();
  if(t&&db&&(t.notes||"")!==v){try{await db.doc("tasks/"+n).update({notes:v});toast("Notes saved")}catch(err){toast("Couldn't save notes: "+err.code)}}
  setTimeout(()=>{if(pendingTasks)renderTasks()},0);
});
$("taskAreas").addEventListener("keydown",e=>{const b=e.target.closest&&e.target.closest("[data-open]");if(b&&(e.key==="Enter"||e.key===" ")){e.preventDefault();b.click()}});
function fmtShort(s){const d=parse(s);return DOW[d.getDay()]+" "+(d.getMonth()+1)+"/"+d.getDate()}
$("taskAreas").addEventListener("click",async e=>{
  const g=e.target.closest("[data-golog]");if(g){curDate=today();fillForm();showTab("log");return}
  const od=e.target.closest("[data-ord]");if(od){impactOrder=od.dataset.ord;renderTasks();return}
  const kb=e.target.closest("[data-kind]");if(kb){if(!db)return toast("Can't save here");try{await db.doc("tasks/"+kb.dataset.id).update({kind:kb.dataset.kind})}catch(err){toast("Couldn't save: "+err.code)}return}
  const lt=e.target.closest("[data-later]");if(lt){showLater[lt.dataset.later]=!showLater[lt.dataset.later];renderTasks();return}
  const op=e.target.closest("[data-open]");if(op){openTask=openTask===op.dataset.open?null:op.dataset.open;renderTasks();return}
  const ai=e.target.closest("[data-ai]");if(ai){if(!db)return toast("Can't save here");const t=S.tasks.find(x=>x.id===ai.dataset.id);if(!t)return;
    const v=t.ai===ai.dataset.ai?null:ai.dataset.ai;try{await db.doc("tasks/"+t.id).update({ai:v})}catch(err){toast("Couldn't save: "+err.code)}return}
  const tg=e.target.closest("[data-tg]"), del=e.target.closest("[data-del]");
  if(!db)return toast("Can't save here");
  if(tg){const t=S.tasks.find(x=>x.id===tg.dataset.tg);if(!t)return;const day=today(),d=isDone(t,day);
    const patch=t.repeat?{lastDone:d?null:day}:{done:!d,doneDate:d?null:day};
    try{await db.doc("tasks/"+t.id).update(patch)}catch(err){toast("Couldn't update: "+err.code)}}
  if(del){if(!del.classList.contains("arm")){del.classList.add("arm");del.textContent="Delete";setTimeout(()=>{del.classList.remove("arm");del.textContent="✕"},3000);return}
    try{await db.doc("tasks/"+del.dataset.del).delete();toast("Deleted")}catch(err){toast("Couldn't delete: "+err.code)}}
});
$("tAdd").onclick=async()=>{
  const title=$("tTitle").value.trim();if(!title)return $("tTitle").focus();
  if(!db)return toast("Can't save here");
  const rep=$("tRepeat").value,due=$("tDue").value||null;
  const t={title,area:$("tArea").value,priority:$("tPri").value,due:rep?null:due,repeat:rep||null,repeatDay:rep==="weekly"?(due?parse(due).getDay():new Date().getDay()):null,done:false,doneDate:null,lastDone:null,created:new Date().toISOString(),source:"j"};
  try{await db.collection("tasks").add(t);$("tTitle").value="";$("tDue").value="";$("tRepeat").value="";toast("Task added")}catch(e){toast("Couldn't add: "+e.code)}
};
$("tTitle").addEventListener("keydown",e=>{if(e.key==="Enter")$("tAdd").click()});

let editBen=false;
function renderBen(){
  const m=S.settings.meeting, col=S.tasks.filter(t=>t.area==="college"&&!t.repeat);
  const done=col.filter(t=>t.done).length, tot=col.length, p=tot?Math.round(done/tot*100):0;
  if(editBen||!m){
    $("benCard").innerHTML=`<div style="display:flex;flex-direction:column;gap:8px"><h2>Next meeting</h2><div class="row"><input id="mWho" placeholder="With" value="${esc(m?.who||"Ben")}" style="flex:1"><input id="mAt" type="datetime-local" value="${esc(m?.at||"")}" style="flex:2"></div><button class="btn sm" id="mSave" style="align-self:flex-start">Save meeting</button></div>`;
    $("mSave").onclick=async()=>{const at=$("mAt").value;if(!at)return;await saveSettings({meeting:{who:$("mWho").value.trim()||"Ben",at}});editBen=false;renderBen()};return;
  }
  const at=new Date(m.at), ms=at-new Date(), past=ms<0;
  const days=Math.floor(Math.abs(ms)/864e5), hrs=Math.floor(Math.abs(ms)%864e5/36e5);
  const when=at.toLocaleDateString(undefined,{weekday:"short",month:"short",day:"numeric"})+", "+at.toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"});
  $("benCard").innerHTML=`<div class="ben"><div><h2>Meeting with ${esc(m.who)}</h2><div class="small muted">${when}</div></div><div style="text-align:right"><b>${past?"Done":`${days}d ${hrs}h`}</b><div class="small muted">${past?"set the next one":"to go"}</div></div></div>
  <div style="margin-top:12px;display:flex;flex-direction:column;gap:6px"><div class="row" style="justify-content:space-between"><span class="small">College list</span><span class="small num">${done}/${tot} done</span></div><div class="bar"><div style="width:${p}%"></div></div><button class="link" id="mEdit" style="align-self:flex-start">Change meeting</button></div>`;
  $("mEdit").onclick=()=>{editBen=true;renderBen()};
}
async function saveSettings(patch){if(!db)return;const ref=db.doc("settings/main");
  try{if(S.settingsExists)await ref.update(patch);else await ref.set({...S.settings,...patch})}catch(e){toast("Couldn't save: "+e.code)}}

/* ---------- charts ---------- */
function lastDays(n){const t=today();return Array.from({length:n},(_,i)=>addDays(t,i-n+1))}
function barChart(days,segs,{max,goal,unit=""}){
  const W=340,H=130,L=28,B=18,T=8,n=days.length,bw=(W-L)/n,y=v=>T+(H-T-B)*(1-v/max);
  let s=`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">`;
  [0,max/2,max].forEach(v=>{s+=`<line x1="${L}" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1"/><text x="${L-4}" y="${y(v)+3}" text-anchor="end">${+v.toFixed(1)}${unit}</text>`});
  days.forEach((d,i)=>{let acc=0;const x=L+i*bw+bw*.18,w=bw*.64;
    segs(d).forEach(([v,col])=>{if(!v)return;const h=(H-T-B)*(Math.min(v,max-acc)/max);if(h<=0)return;acc+=v;s+=`<rect x="${x}" y="${y(Math.min(acc,max))}" width="${w}" height="${h}" rx="2" fill="${col}"/>`});
    if(i%2===(n-1)%2)s+=`<text x="${x+w/2}" y="${H-5}" text-anchor="middle">${parse(d).getDate()}</text>`});
  if(goal!=null)s+=`<line x1="${L}" x2="${W}" y1="${y(goal)}" y2="${y(goal)}" stroke="var(--fg)" stroke-dasharray="3 3" stroke-width="1" opacity=".55"/>`;
  return s+"</svg>";
}
function lineChart(labels,vals,{min,max,unit="",color="var(--accent)"}){
  const W=340,H=120,L=28,B=18,T=10,n=labels.length,R=8,step=n>1?(W-L-R)/(n-1):0;
  const x=i=>n>1?L+i*step:(L+W)/2,y=v=>T+(H-T-B)*(1-(v-min)/(max-min));
  let s=`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">`;
  [min,(min+max)/2,max].forEach(v=>{s+=`<line x1="${L}" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${L-4}" y="${y(v)+3}" text-anchor="end">${+v.toFixed(1)}${unit}</text>`});
  let seg=[],paths=[];vals.forEach((v,i)=>{if(v==null){if(seg.length)paths.push(seg);seg=[]}else seg.push(`${x(i)},${y(v)}`)});if(seg.length)paths.push(seg);
  paths.forEach(p=>s+=`<polyline points="${p.join(" ")}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`);
  vals.forEach((v,i)=>{if(v!=null)s+=`<circle cx="${x(i)}" cy="${y(v)}" r="${i===lastIdx(vals)?4:2.5}" fill="${color}"/>`});
  labels.forEach((l,i)=>{if(n<=8||i%2===(n-1)%2)s+=`<text x="${x(i)}" y="${H-4}" text-anchor="middle">${esc(l)}</text>`});
  return s+"</svg>";
}
function lastIdx(a){for(let i=a.length-1;i>=0;i--)if(a[i]!=null)return i;return -1}
const emptyChart=m=>`<div class="empty">${m}</div>`;

function renderStats(){
  const st=streaks();
  $("stGoal2").textContent=st.goal;$("stLog2").textContent=st.log;$("bestGoal").textContent=st.bestGoal;$("bestLog").textContent=st.bestLog;
  const days=lastDays(14),has=days.some(d=>S.logs[d]);
  $("chComp").innerHTML=has?barChart(days,d=>{const l=S.logs[d];if(!l)return[];const v=l.completion??100;return[[v,goalParts(l,d).all?"var(--accent)":"var(--muted)"]]},{max:100,unit:"%"})+`<div class="legend"><span><i style="background:var(--accent)"></i>Hit 100% of goals</span><span><i style="background:var(--muted)"></i>Missed a goal</span></div>`:emptyChart("Bars appear after your first saved log.");
  const maxH=Math.max(4,...days.map(d=>{const h=S.logs[d]?.hours||{};return(h.school||0)+(h.college||0)+(h.personal||0)}));
  $("chHours").innerHTML=has?barChart(days,d=>{const h=S.logs[d]?.hours||{};return[[h.school,"var(--school)"],[h.college,"var(--college)"],[h.personal,"var(--personal)"]]},{max:Math.ceil(maxH),goal:S.settings.goals?.schoolMin??1,unit:"h"}):emptyChart("Log your hours tonight to start this chart.");
  const cal=lastDays(28);$("gymCal").innerHTML=cal.map(d=>{const g=S.logs[d]?.gym;return`<div class="${g||""}" title="${d}">${parse(d).getDate()}</div>`}).join("");
  const sl=days.map(d=>S.logs[d]?.sleep??null),md=days.map(d=>S.logs[d]?.mood??null),lab=days.map(d=>String(parse(d).getDate()));
  $("chSleep").innerHTML=sl.some(v=>v!=null)?lineChart(lab,sl,{min:4,max:Math.max(10,...sl.filter(v=>v!=null)),unit:"h",color:"var(--school)"}):emptyChart("No sleep logged yet.");
  $("chMood").innerHTML=md.some(v=>v!=null)?lineChart(lab,md,{min:1,max:10,color:"var(--personal)"}):emptyChart("No mood ratings yet.");
  renderLift();renderGradeStats();renderReview();renderAi();
  const ae=document.activeElement;if(!(ae&&ae.dataset&&ae.dataset.wc))renderWeights();
}
$("viewSeg").addEventListener("click",e=>{const b=e.target.closest("[data-view]");if(!b)return;taskView=b.dataset.view;try{localStorage.setItem("taskView",taskView)}catch(err){}renderTasks()});
function renderAi(){
  const fin=S.tasks.filter(t=>!t.repeat&&t.done&&t.ai);
  if(!fin.length){$("aiStats").innerHTML=emptyChart("Tap an assignment, mark Yes or No for AI support, and it tallies here.");return}
  const by={};fin.forEach(t=>{const c=t.class||({school:"School",college:"College",personal:"Personal",gym:"Gym"}[t.area]);(by[c]=by[c]||{yes:0,no:0})[t.ai]++});
  const tot={yes:fin.filter(t=>t.ai==="yes").length,no:fin.filter(t=>t.ai==="no").length};
  const line=(n,o)=>{const all=o.yes+o.no,p=Math.round(o.no/all*100);return`<div style="display:flex;flex-direction:column;gap:4px;padding:6px 0"><div class="row" style="justify-content:space-between"><span class="small">${esc(n)}</span><span class="small num">${o.no} no AI · ${o.yes} AI</span></div><div class="bar" style="background:var(--college)"><div style="width:${p}%;background:var(--good)"></div></div></div>`};
  $("aiStats").innerHTML=line("All finished work",tot)+Object.keys(by).sort().map(k=>line(k,by[k])).join("")+`<div class="legend"><span><i style="background:var(--good)"></i>No AI</span><span><i style="background:var(--college)"></i>Used AI</span></div>`;
}
function liftData(){const m={};Object.keys(S.logs).sort().forEach(d=>(S.logs[d].workout?.prs||[]).forEach(p=>{if(p.weight==null)return;const k=p.lift.trim().toLowerCase();(m[k]=m[k]||{name:p.lift.trim(),pts:{}});const cur=m[k].pts[d];if(cur==null||p.weight>cur)m[k].pts[d]=p.weight}));return m}
function renderLift(){
  const m=liftData(),keys=Object.keys(m),sel=$("liftSel");
  if(!keys.length){sel.hidden=true;$("chLift").innerHTML=emptyChart("Add a lift with a weight in your gym log and it'll chart here.");return}
  sel.hidden=false;const prev=sel.value;sel.innerHTML=keys.map(k=>`<option value="${esc(k)}">${esc(m[k].name)}</option>`).join("");
  if(keys.includes(prev))sel.value=prev;
  const L=m[sel.value],ds=Object.keys(L.pts).sort().slice(-12),vals=ds.map(d=>L.pts[d]);
  const lo=Math.min(...vals),hi=Math.max(...vals),padv=Math.max(5,(hi-lo)*.15);
  $("chLift").innerHTML=lineChart(ds.map(d=>{const x=parse(d);return(x.getMonth()+1)+"/"+x.getDate()}),vals,{min:Math.max(0,Math.floor(lo-padv)),max:Math.ceil(hi+padv),color:"var(--gym)"})+`<div class="small muted">Best: <span class="num">${hi} lb</span></div>`;
}
$("liftSel").onchange=renderLift;
function renderGradeStats(){
  const by={};S.grades.forEach(g=>(by[g.class]=by[g.class]||[]).push(g));
  const ks=Object.keys(by).sort();
  if(!ks.length){$("gradeStats").innerHTML=emptyChart("Grades you add in the log show up here, grouped by class.");return}
  $("gradeStats").innerHTML=ks.map(k=>{const gs=by[k].sort((a,b)=>a.date<b.date?-1:1),avg=Math.round(gs.reduce((s,g)=>s+pct(g),0)/gs.length*10)/10;
    const recent=gs.slice(-4).reverse().map(g=>`<div class="list-line"><span>${esc(g.item)} <span class="muted small">${fmtShort(g.date)}</span></span><span class="num">${fmtScore(g)}</span></div>`).join("");
    return`<div class="card" style="display:flex;flex-direction:column;gap:4px"><div class="row" style="justify-content:space-between"><b>${esc(k)}</b><span class="num">avg ${avg}%</span></div>${gs.length>1?lineChart(gs.map(g=>""),gs.map(pct),{min:Math.max(0,Math.floor(Math.min(...gs.map(pct))/10)*10-10),max:100,unit:"%",color:"var(--school)"}):""}${recent}</div>`}).join("");
}
function renderReview(){
  const r=S.reviews[0];
  $("reviewBox").innerHTML=r?`<div class="small muted">Week of ${fmtShort(r.week)}</div><div class="review">${esc(r.text)}</div>`:emptyChart("Claude writes a recap here every Sunday night after your check-in.");
}

function renderAll(){renderTasks();if(!dirty)fillForm();else renderChips();if(tab==="stats")renderStats()}

/* ---------- boot ---------- */
showTab(tab);fillForm();renderTasks();
function greet(){const h=new Date().getHours();const el=document.getElementById("hello");if(el)el.textContent=(h<5?"Up late, J":h<12?"Good morning, J":h<17?"Good afternoon, J":"Good evening, J");}
greet();setInterval(greet,600000);
/* ---------- sync status + setup ---------- */
function ago(iso){if(!iso)return"";const m=Math.round((Date.now()-new Date(iso))/60000);return m<1?"just now":m<60?m+" min ago":new Date(iso).toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"})}
function renderSync(s){
  const el=$("sync");if(!el)return;
  const p=s.pending?` · ${s.pending} change${s.pending>1?"s":""} waiting`:"";
  const txt={idle:"",syncing:"Syncing…",saving:"Saving…",synced:"Synced "+ago(s.at),offline:"Offline"+p+" · saved on this phone",error:"Couldn't sync"+p+" · tap to retry",auth:"Not connected · tap to fix"}[s.state]||"";
  el.textContent=txt;el.dataset.state=s.state;
  $("setup").hidden=NL.hasToken();
  if(!NL.hasToken())$("saveBar").hidden=true;else if(tab==="log")$("saveBar").hidden=false;
}
$("sync").addEventListener("click",()=>{const s=NL.status();if(s.state==="auth"){NL.disconnect();renderSync(NL.status())}else NL.pull()});
$("connectBtn").addEventListener("click",async()=>{
  const t=$("tokenIn").value.trim();if(!t){$("tokenIn").focus();return}
  $("connectBtn").disabled=true;$("connectMsg").textContent="Checking…";
  try{const r=await NL.connect(t);
    if(r.ok){$("tokenIn").value="";$("connectMsg").textContent="";toast("Connected")}
    else $("connectMsg").textContent=r.status===401?"That token didn't work. Check you copied all of it.":r.status===404?"The token can't see nightly-log-data. Make sure that repo is selected when you create it.":"GitHub said "+r.status+". Try again.";
  }catch(e){$("connectMsg").textContent="Couldn't reach GitHub. Check your connection."}
  $("connectBtn").disabled=false;renderSync(NL.status());
});
$("refreshBtn").addEventListener("click",()=>{NL.pull();toast("Refreshing")});
$("disconnectBtn").addEventListener("click",()=>{if($("disconnectBtn").dataset.arm){NL.disconnect();delete $("disconnectBtn").dataset.arm;$("disconnectBtn").textContent="Disconnect this phone";renderSync(NL.status())}else{$("disconnectBtn").dataset.arm="1";$("disconnectBtn").textContent="Tap again to disconnect"}});
setInterval(()=>renderSync(NL.status()),30000);

(async()=>{
  db=NL.db;
  NL.onStatus(renderSync);
  const err=()=>{};
  db.collection("tasks").onSnapshot(s=>{S.tasks=s.docs.map(d=>({id:d.id,...d.data()})).filter(t=>!t.hidden);renderTasks();renderChips();if(tab==="stats")renderStats()},err);
  db.collection("logs").orderBy("date","desc").limit(400).onSnapshot(s=>{const m={};s.docs.forEach(d=>m[d.id]=d.data());S.logs=m;if(!dirty)fillForm();else renderChips();renderTasks();if(tab==="stats")renderStats()},err);
  db.collection("grades").onSnapshot(s=>{S.grades=s.docs.map(d=>({id:d.id,...d.data()}));renderGradeList();if(tab==="stats")renderStats()},err);
  db.doc("settings/main").onSnapshot(s=>{S.settingsExists=s.exists;S.settings=s.exists?s.data():{};renderTasks();renderChips();renderGradeList()},err);
  db.collection("reviews").orderBy("week","desc").limit(5).onSnapshot(s=>{S.reviews=s.docs.map(d=>d.data());if(tab==="stats")renderReview()},err);
  setInterval(()=>{const t=today();if(!dirty&&curDate!==t&&!S.logs[curDate]){curDate=t;fillForm()}if(tab==="tasks")renderBen()},60000);
  NL.pull();
})();
})();
