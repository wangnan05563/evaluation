/* ===== M3/FR-1.4、1.5、1.7、2.9：批量操作 / 粘贴导入 / 驳回流 / 规则维护 ===== */
function batchApply(){  // FR-1.4：对筛选出的可见行批量设置
  const ops=[["bReuse","reuse"],["bModify","modify"],["bCx","cx"]].filter(([id])=>$("#"+id).value);
  if(!ops.length){toast("请先选择要批量设置的属性");return;}
  const arr=visibleItems();let n=0;
  arr.forEach(it=>{ops.forEach(([id,k])=>{const v=$("#"+id).value;recordRej(it,k,it[k],v);it[k]=v;});n++;});
  render();saveFormState();toast(`已批量更新 ${n} 行`);}
function batchConfirm(){const arr=visibleItems();arr.forEach(it=>it.ok=true);render();saveFormState();toast(`已确认 ${arr.length} 行`);}
function batchDelete(){const arr=visibleItems();if(!arr.length)return;
  if(!confirm(`确定删除筛选出的 ${arr.length} 行功能点？此操作不可恢复（其余行 seq 保持不变）。`))return;
  const del=new Set(arr.map(x=>x.seq));items=items.filter(x=>!del.has(x.seq));
  render();saveFormState();toast(`已删除 ${arr.length} 行`);}
/* FR-1.5：AI 建议采纳/驳回（驳回偏离 _ai 才记录，供 FR-2.9 沉淀） */
let rejQueue=[];
function recordRej(it,field,from,to){if(!it||from===to)return;
  const ai=(it._ai&&it._ai[field]!==undefined)?String(it._ai[field]):null;
  if(ai===null||ai===String(to))return;
  if(rejQueue.some(r=>r.seq===it.seq&&r.field===field))return;
  rejQueue.push({seq:it.seq,field,from:ai,to:String(to),reason:""});updateRejBadge();}
function updateRejBadge(){const b=document.getElementById("rejBadge");
  if(b)b.textContent=rejQueue.length?`驳回 ${rejQueue.length} 条`:"";}
function settleRules(){  // FR-2.9：驳回流沉淀为识别规则
  if(!rejQueue.length){toast("暂无驳回记录");return;}
  const kw=prompt("为驳回样本沉淀识别规则：输入触发关键词（正则片段，多个用 | 分隔）","");
  if(!kw||!kw.trim())return;
  fetch(API+"/api/rules").then(r=>r.json()).then(j=>{
    const rules=j.rules||[];
    rules.push({id:"R-FB-"+Date.now().toString(36),name:"驳回流沉淀",scope:"desc",
      patterns:[kw.trim()],exclude:[],type:rejQueue[0].to||"EI",
      priority:999,enabled:true,source:"feedback"});   // 用户修正优先于内置通用规则
    return fetch(API+"/api/rules/save",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({rules})});
  }).then(r=>r.json()).then(j=>{
    if(!j.ok)throw new Error(j.msg||"保存失败");
    toast(`规则已沉淀（v${j.version.rules_version}），下次识别生效`);
    rejQueue=[];updateRejBadge();
  }).catch(e=>toast("沉淀失败："+e.message));}
/* FR-1.4：粘贴导入（Excel TSV / CSV） */
let pasteRows=[];
function pasteOpen(){const m=$("#pasteModal");m.style.display="flex";
  $("#pasteText").value="";$("#pastePreview").textContent="";$("#pasteApplyBtn").disabled=true;}
function pasteClose(){$("#pasteModal").style.display="none";}
function pasteParse(){
  const txt=$("#pasteText").value.trim();
  if(!txt){toast("请先粘贴内容");return;}
  const lines=txt.split(/\r?\n/).filter(l=>l.trim());
  const sep=lines[0].includes("\t")?"\t":",";
  let rows=lines.map(l=>l.split(sep).map(c=>c.replaceAll(/(^")|("$)/g,"").trim()));
  if(rows.length&&/系统|描述|功能/.test(rows[0].join(","))&&!['EI','EO','EQ','ILF','EIF'].includes(rows[0][4]))rows=rows.slice(1);
  pasteRows=rows.filter(r=>r.some(Boolean)).slice(0,2000).map(r=>({
    system:r[0]||"未分类",m1:r[1]||"",desc:r[2]||r[1]||r[0]||"",count_item:r[3]||"",
    type:["EI","EO","EQ","ILF","EIF"].includes(r[4])?r[4]:"EI",
    reuse:["高","中","低"].includes(r[5])?r[5]:"中",
    modify:["新增","修改","删除"].includes(r[6])?r[6]:"修改"}));
  $("#pastePreview").textContent=`解析出 ${pasteRows.length} 行（类型/重用度/修改类型不符合枚举的已回退默认值），确认后追加到复核清单`;
  $("#pasteApplyBtn").disabled=!pasteRows.length;
  toast(`解析出 ${pasteRows.length} 行`);}
function pasteApply(){
  let seq=items.length?Math.max(...items.map(x=>x.seq)):0;
  pasteRows.forEach(r=>{seq+=1;items.push({...r,seq,cx:"中",ok:false,_ai:{type:r.type,reuse:r.reuse,modify:r.modify}});});
  const n=pasteRows.length;pasteClose();render();saveFormState();
  toast(`已追加 ${n} 行到复核清单`);}
/* FR-1.7：全局快捷键（应用内 keydown；输入控件聚焦时让位） */
/* T01501（S3776）：全局键盘监听把「Esc 关浮层 / 输入框让行 / Ctrl+F 搜索 / 上下移动
   / Enter 勾选 / Space 展开依据」六类语义塞在一个处理器里，且每类都带前置守卫，
   嵌套与短路判断叠加后复杂度超阈值。拆为六个语义函数 + 一张「键 → 处理」分派表，
   新增快捷键只加一条映射；守卫集中在主监听里，避免每个处理函数重复判页态。 */
const EDITABLE_TAGS=["input","select","textarea"];
function closeFloatingPanels(e){
  const m=$("#expMenu");if(m)m.style.display="none";
  const pm=$("#pasteModal");if(pm)pm.style.display="none";
  if(EDITABLE_TAGS.includes((e.target.tagName||"").toLowerCase()))e.target.blur();
}
function focusSearchBox(e){e.preventDefault();$("#q").focus();}
function moveRow(delta,e){
  const arr=visibleItems();if(!arr.length)return;   // 无可见行时原实现直接返回，不阻止滚动
  e.preventDefault();
  const i=arr.findIndex(x=>x.seq===curSeq);
  // 首/末行再按方向键时钳在边界内（i<0 表示当前无选中，从首/末起算）
  const j=delta>0?Math.min(arr.length-1,(i<0?0:i+1)):Math.max(0,(i<0?1:i-1));
  curSeq=arr[j].seq;highlightRow();
}
function toggleCurrentRow(){
  if(!curSeq)return;
  const it=items.find(x=>x.seq===curSeq);if(!it)return;
  it.ok=!it.ok;render();highlightRow();
}
function expandCurrentRow(){
  if(!curSeq)return;
  toggleBasis(curSeq);
}
/* 行级快捷键：仅在「工作台-复核页且有数据」时生效。
   注意 preventDefault 的位置：必须与重构前逐字一致地放在各自守卫之内。
   原因：<button> 的点击是由 Enter/Space 的 keydown 默认行为合成的，一旦在按钮
   聚焦时无条件 preventDefault，合成的 click 会被吞掉——「生成」按钮按下无效。
   （T01501 实施中此处曾踩坑：把 preventDefault 提到分派表里统一调用，导致 #goRes 失效。） */
const ROW_KEYS={
  ArrowDown(e){moveRow(1,e);},
  ArrowUp(e){moveRow(-1,e);},
  Enter(e){if(curSeq){e.preventDefault();toggleCurrentRow();}},
  " "(e){if(curSeq){e.preventDefault();expandCurrentRow();}},
};
document.addEventListener("keydown",e=>{
  const tag=(e.target.tagName||"").toLowerCase();
  if(e.key==="Escape"){closeFloatingPanels(e);return;}
  if(EDITABLE_TAGS.includes(tag))return;
  if(e.key.toLowerCase()==="f"&&(e.ctrlKey||e.metaKey)){
    if(document.body.dataset.page==="work"&&document.body.dataset.step==="review")focusSearchBox(e);
    return;}
  if(!items.length||document.body.dataset.page!=="work"||document.body.dataset.step!=="review")return;
  const h=ROW_KEYS[e.key];if(h)h(e);
});
function highlightRow(){document.querySelectorAll("#tbody tr").forEach(tr=>tr.classList.toggle("cur",+tr.dataset.seq===curSeq));
  const tr=document.querySelector(`#tbody tr[data-seq="${curSeq}"]`);if(tr)tr.scrollIntoView({block:"nearest"});}
/* M5：外观卡片逻辑（FR-4.1/4.2/4.3） */
function setThemeMode(m){localStorage.setItem('wl_theme_mode',m);applyTheme();themeSegPaint();}
function themeSegPaint(){const m=localStorage.getItem('wl_theme_mode')||'light';
  document.querySelectorAll('#themeSeg .tm').forEach(b=>{const on=b.dataset.m===m;
    b.style.borderColor=on?'var(--brand)':'var(--line)';b.style.color=on?'var(--brand)':'var(--ink-2)';
    b.style.fontWeight=on?'700':'500';});}
function setBrand(v){applyTheme.brand(v);brandPaint();}
function brandPaint(){const cur=localStorage.getItem('wl_brand')||'#2563EB';
  const wrap=document.getElementById('brandPresets');if(!wrap)return;
  wrap.innerHTML=BRAND_PRESETS.map(([hex,name])=>`<button title="${name}" onclick="setBrand('${hex}')"
    style="width:24px;height:24px;border-radius:50%;border:2px solid ${hex===cur?'var(--ink)':'transparent'};background:${hex};cursor:pointer"></button>`).join('');
  const inp=document.getElementById('brandCustom');if(inp)inp.value=cur;
  const pick=document.getElementById('brandPick');if(pick)pick.value=cur;}
window.addEventListener('DOMContentLoaded',()=>{themeSegPaint();brandPaint();});

/* M8/FR-5.4、5.6：诊断包与数据导出导入 */
async function diagExport(){try{
  const r=await(await fetch(API+"/api/diag")).json();
  if(!r.ok)throw new Error(r.msg||"导出失败");
  toast("诊断包已生成："+r.file.split("/").pop()+"（数据目录 diag/ 下）");
}catch(e){toast("诊断包导出失败："+e.message);}}
async function dataExport(){try{
  const r=await(await fetch(API+"/api/data/export")).json();
  if(!r.ok)throw new Error(r.msg||"导出失败");
  toast("全部数据已导出（"+(r.files||[]).length+" 个文件），位于数据目录 exports/ 下");
}catch(e){toast("数据导出失败："+e.message);}}
async function dataImport(inp){const f=inp.files&&inp.files[0];if(!f)return;
  const buf=await f.arrayBuffer();
  const r=await(await fetch(API+"/api/data/import",{method:"POST",headers:{"Content-Type":"application/octet-stream"},body:buf})).json();
  toast(r.ok?("导入完成（"+(r.files||[]).length+" 个文件），已自动备份旧数据"):("导入失败："+(r.msg||"")));
  inp.value="";}

/* FR-2.9：配置中心「识别规则」维护页 */
function rulesLoad(){fetch(API+"/api/rules",{cache:"no-store"}).then(r=>r.json()).then(j=>{
  if(!j.ok){$("#rulesRows").innerHTML=`<tr><td colspan="8" style="color:var(--muted)">规则表不可用：${j.msg||""}（已回退内置链）</td></tr>`;return;}
  $("#rulesMeta").textContent=`v${j.version} · ${j.rules.length} 条`;
  $("#rulesRows").innerHTML=j.rules.map((r,i)=>`<tr>
    <td><input data-ri="${i}" data-rk="id" value="${histEsc(r.id)}" style="width:100px"></td>
    <td><input data-ri="${i}" data-rk="name" value="${histEsc(r.name||"")}" style="width:100%"></td>
    <td><select data-ri="${i}" data-rk="scope">
      <option ${r.scope==="desc"?"selected":""}>desc</option><option ${r.scope==="name"?"selected":""}>name</option><option ${!r.scope||r.scope==="any"?"selected":""}>any</option></select></td>
    <td><select data-ri="${i}" data-rk="type">${["EI","EO","EQ","ILF","EIF"].map(t=>`<option ${r.type===t?"selected":""}>${t}</option>`).join("")}</select></td>
    <td><input data-ri="${i}" data-rk="priority" type="number" value="${r.priority||0}" style="width:52px"></td>
    <td><input data-ri="${i}" data-rk="enabled" type="checkbox" ${r.enabled!==false?"checked":""}></td>
    <td><textarea data-ri="${i}" data-rk="patterns" style="width:100%;height:36px" title="每行一条正则（规则内多分支直接写在同一行用 | 分隔）">${histEsc((r.patterns||[]).join(String.fromCodePoint(10)))}</textarea></td>
    <td><textarea data-ri="${i}" data-rk="exclude" style="width:110px;height:36px" title="每行一条排除正则">${histEsc((r.exclude||[]).join(String.fromCodePoint(10)))}</textarea></td></tr>`).join("");
  window.lucide&&lucide.createIcons();
}).catch(e=>{$("#rulesRows").innerHTML=`<tr><td colspan="8">${errorBox(e.message,"rulesLoad()")}</td></tr>`;window.lucide&&lucide.createIcons();});}
function rulesCollect(){
  const rows=[...document.querySelectorAll("#rulesRows tr")].filter(tr=>tr.querySelector("[data-ri]"));
  const map={};
  rows.forEach(tr=>{const i=tr.querySelector("[data-ri]").dataset.ri;
    map[i]=map[i]||{id:"",name:"",scope:"any",type:"EI",priority:0,enabled:true,patterns:[],exclude:[],source:"manual"};
    tr.querySelectorAll("[data-rk]").forEach(inp=>{const k=inp.dataset.rk;
      if(k==="enabled")map[i].enabled=inp.checked;
      else if(k==="priority")map[i].priority=+inp.value||0;
      else if(k==="patterns")map[i].patterns=inp.value.split(String.fromCodePoint(10)).map(x=>x.trim()).filter(Boolean);
      else if(k==="exclude")map[i].exclude=inp.value.split(String.fromCodePoint(10)).map(x=>x.trim()).filter(Boolean);
      else map[i][k]=inp.value;});});
  return Object.values(map);}
function rulesSave(){const rules=rulesCollect();
  fetch(API+"/api/rules/save",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({rules})}).then(r=>r.json()).then(j=>{
    if(!j.ok)throw new Error(j.msg||"保存失败");
    toast(`识别规则已保存（v${j.version.rules_version}），下次识别生效`);rulesLoad();
  }).catch(e=>toast("保存失败："+e.message));}
function rulesAdd(){const rules=rulesCollect();
  rules.push({id:"R-MAN-"+Date.now().toString(36),name:"新规则",scope:"desc",patterns:["关键词"],
    exclude:[],type:"EI",priority:50,enabled:true,source:"manual"});
  fetch(API+"/api/rules/save",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({rules})}).then(r=>r.json()).then(j=>{
    if(!j.ok)throw new Error(j.msg||"保存失败");
toast("已追加规则");rulesLoad();
  }).catch(e=>toast("追加失败："+e.message));}
// 强制下载：动态 <a download> + ObjectURL，避免 window.location 导航偶发被吞。
async function download(){
  if(!gSid){toast("尚未生成结果");return;}
  const url = API + "/api/download?s=" + encodeURIComponent(gSid);
  try {
    // 先 fetch 拿到 blob（确保 Content-Type 合法 + 拿到原始大小），再 a[download] 触发
    const r = await fetch(url);
    if(!r.ok) throw new Error("下载失败 HTTP " + r.status);
    const blob = await r.blob();
    const dispo = r.headers.get("Content-Disposition") || "";
    const m = /filename\*?=(?:UTF-8'')?["']?([^"';]+)/i.exec(dispo);
    const name = (m && m[1]) ? decodeURIComponent(m[1]) : gSid;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
    toast("已开始下载：" + name);
  } catch(err){
    // 退化：仍用 a[download] 走原 URL（让浏览器自己处理 Content-Disposition）
    const a = document.createElement("a");
    a.href = url; a.download = gSid; a.rel = "noopener";
    document.body.appendChild(a); a.click(); a.remove();
    toast("下载已触发：" + gSid);
  }
}
let tt;function toast(t){const el=$("#toast");el.textContent=t;el.style.opacity=1;clearTimeout(tt);tt=setTimeout(()=>el.style.opacity=0,2200);}
// 启动时统一渲染全部静态图标（此前无启动调用，首屏图标一直依赖后续交互才被替换）
window.lucide&&lucide.createIcons();
document.addEventListener("DOMContentLoaded",()=>window.lucide&&lucide.createIcons());
// 启动静默版本检测（T00880）：有更新时 toast 提示，引导到帮助页更新；未配置源/失败均静默
setTimeout(async()=>{
  try{
    const r=await fetch(API+"/api/update/check");
    const res=await r.json();
    if(res.ok&&res.hasUpdate){
      verLatest=res;
      toast(`发现新版本 ${res.latest}，请到「帮助文档」页面一键更新`);
    }
  }catch(e){/* 静默失败不打扰 */}
},5000);

/* ============ 表单断点续录（T00628） ============
   中途切换页面/步骤/关闭页面时自动快照录入状态到 localStorage，下次打开自动恢复：
   - IFPUG：候选清单（含类别/复杂度/重用/修改等全部选项）、汇总、当前步骤
   - PERT：当前项目、阶段选择、未保存的三值/描述输入、当前步骤
   - 页面停留位置一并记忆 */
const SS_KEY='we_form_state_v1';
function saveFormState(){
  try{
    const v=id=>{const el=$(id);return el?el.value:"";};
    localStorage.setItem(SS_KEY, JSON.stringify({
      page: document.body.dataset.page || 'work',
      step: document.body.dataset.step || 'upload',
      pertstep: document.body.dataset.pertstep || 'in',
      items, gSummary, gSid, curFile,
      pertPid, pertItems, pertSummary,
      pertPhase: v('#pertPhase'), pertO: v('#pertO'), pertM: v('#pertM'),
      pertP: v('#pertP'), pertD: v('#pertD'), pertEst: v('#pertEst'),
      ts: Date.now()
    }));
  }catch(e){/* 存储满/隐私模式等场景静默降级，不影响主流程 */}
}
/* T01501（S3776）：IFPUG 与 PERT 两条恢复链的守卫/回填步骤各自成段，混在一个函数里
   使嵌套与条件判断叠加超阈值。拆为「赋值」与「渲染」两阶段——顺序语义关键：
   原实现是先给两个域赋值，再 goPage 切页，最后各自渲染/跳步；渲染依赖页面已切换，
   故切页必须在渲染之前，不能把两阶段合并。
   恢复口径与调用顺序完全不变。 */
function assignIfpugState(s){
  items=s.items;gSummary=s.gSummary||null;gSid=s.gSid||null;curFile=s.curFile||null;
}
function renderIfpugState(s){
  render();
  goStep(s.step&&s.step!=='upload'?s.step:'review');
}
function assignPertState(s){
  pertPid=s.pertPid||null;pertItems=s.pertItems||[];pertSummary=s.pertSummary||null;
}
function renderPertState(s){
  pertFillPhase();
  if(s.pertPhase)$("#pertPhase").value=s.pertPhase;
  if(pertPid && $("#pertProjSel"))pertLoadProjects();
  pertStep(s.pertstep&&s.pertstep!=='in'?s.pertstep:'edit');
  // 空串不写入：占位态（""）表示"未填"，写入会把输入框填成空串，覆盖浏览器自动填充
  const setv=(id,val)=>{const el=$(id);if(el&&val!=="")el.value=val;};
  setv('#pertO',s.pertO);setv('#pertM',s.pertM);setv('#pertP',s.pertP);
  setv('#pertD',s.pertD);setv('#pertEst',s.pertEst);
  const cur=$("#pertCur");if(cur&&s.pertPid)cur.textContent='项目 #'+s.pertPid;
  if(typeof renderPert==='function'&&pertItems.length)renderPert();
  if(typeof applyPertSummary==='function'&&pertSummary)applyPertSummary(pertSummary);
}
function restoreFormState(){
  let s=null;
  try{
    const raw=localStorage.getItem(SS_KEY);
    if(!raw)return false;
    s=JSON.parse(raw);
  }catch(e){return false;}
  const hasIfpug=s && Array.isArray(s.items) && s.items.length>0;
  const hasPert=s && (s.pertPid || (Array.isArray(s.pertItems) && s.pertItems.length));
  if(!hasIfpug && !hasPert)return false;
  // 恢复数据：先给两个域赋值 → 切页 → 各自渲染
  if(hasIfpug)assignIfpugState(s);
  if(hasPert)assignPertState(s);
  goPage(s.page||'work');
  if(hasIfpug)renderIfpugState(s);
  if(hasPert)renderPertState(s);
  toast('已恢复上次未完成的录入');
  return true;
}
window.addEventListener('beforeunload',saveFormState);
window.addEventListener('pagehide',saveFormState);
try{
  if(!restoreFormState()){saveFormState();}
}catch(e){/* 恢复失败不阻塞正常启动 */}
histRestorePrompt();   // M1/FR-1.8：会话恢复未覆盖时，基于历史库的二次兜底提示

