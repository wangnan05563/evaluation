// 后端专属端口 8020（8000 与 MorningBrief/20_News 冲突，见 README / dev-shell/main.js）。
// 页面由后端同源提供时直接复用 origin；file:// 直接打开时回退到 127.0.0.1:8020，
// 避免硬编码端口与实际监听端口不一致导致 fetch 直接 Failed to fetch。
const API=(location.protocol==='http:'||location.protocol==='https:')?location.origin:'http://127.0.0.1:8020';
const WEIGHT={ILF:{低:7,中:10,高:15},EIF:{低:5,中:7,高:10},EI:{低:3,中:4,高:6},EO:{低:4,中:5,高:7},EQ:{低:3,中:4,高:6}};
const REUSE={低:1,中:2/3,高:1/3}; const MODIFY={新增:1,修改:.8,删除:.2};
const CATCOLOR={ILF:'c-ILF',EIF:'c-EIF',EI:'c-EI',EO:'c-EO',EQ:'c-EQ'};
let items=[]; let gSummary=null; let gSid=null; let curFile=null;
const $=s=>document.querySelector(s);
// 属性转义：system 等字段可能含引号/尖括号，拼进 HTML 属性前必须转义
const escAttr=s=>String(s??'').replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");
function badge(it){return it.ok?'<span class="stat st-ok"><i aria-hidden="true" data-lucide="circle-check"></i>已确认</span>':'<span class="stat st-md"><i aria-hidden="true" data-lucide="clock-3"></i>待复核</span>';}
function ufp(it){return WEIGHT[it.type][it.cx];}
function us(it){return +(ufp(it)*REUSE[it.reuse]*MODIFY[it.modify]).toFixed(2);}
function cxCellHTML(it){return `<select class="pick" data-k="cx" data-seq="${it.seq}">${['低','中','高'].map(c=>"<option "+(c===it.cx?" selected":"")+">"+c+"</option>").join('')}</select>`;}
function reuseHTML(it){return `<select class="pick" data-k="reuse" data-seq="${it.seq}">${['低','中','高'].map(v=>"<option "+(v===it.reuse?" selected":"")+">"+v+"</option>").join('')}</select>`;}
function modHTML(it){return `<select class="pick" data-k="modify" data-seq="${it.seq}">${['新增','修改','删除'].map(v=>"<option "+(v===it.modify?" selected":"")+">"+v+"</option>").join('')}</select>`;}
function typeCell(it){return `<select class="pick" data-k="type" data-seq="${it.seq}">${Object.keys(CATCOLOR).map(t=>"<option "+(t===it.type?" selected":"")+">"+t+"</option>").join('')}</select>`;}
function refreshRow(it){const tr=document.querySelector(`tr[data-seq="${it.seq}"]`);if(!tr)return;
tr.querySelector('[data-u]').textContent=ufp(it);tr.querySelector('[data-s]').textContent=us(it);const ct=tr.querySelector(".cat");ct.className="cat "+CATCOLOR[it.type];ct.textContent=it.type;}
function refreshTotals(){
  const okT=items.filter(x=>x.ok),tU=items.reduce((a,x)=>a+ufp(x),0),tS=items.reduce((a,x)=>a+us(x),0).toFixed(2);
  $("#okCnt").textContent=okT.length;$("#leftCnt").textContent=items.length-okT.length;
  $("#treeUfp").textContent=tU;$("#dockUfp").textContent=tU;$("#dockUs").textContent=tS;$("#listCnt").textContent=tf("review.count",{n:items.length});
  $("#goRes").disabled=okT.length!==items.length;
}
function buildTree(){
  const sys={};items.forEach(x=>sys[x.system]=(sys[x.system]||0)+1);
  // 首节点"全部功能点"用于清除过滤；节点通过 data-sys 携带系统名，点击经 filterSys(this) 传递，避免内联字符串拼接转义问题
  // FR-UI05：树节点是可点击控件，须补 role=button + tabindex=0 + Enter/Space 键效，
  // 否则键盘用户无法按模块筛选（SonarQube Web:S6848 交互元素键盘等价）。
  // data-sys 用 escAttr 转义后同时拼进 data 属性与 keydown 的 this 引用需谨慎——
  // 故 keydown 直接复用 onclick 的表达式文本（this 绑定同一元素，天然安全）。
  const tnode=(sysAttr,icon,label)=>`<div class="tnode"${sysAttr} role="button" tabindex="0" onclick="filterSys(this)" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();filterSys(this)}"><i aria-hidden="true" data-lucide="${icon}"></i>${label}</div>`;
  $("#tree").innerHTML=
    tnode(' data-sys=""',"layers",`全部功能点 <span class="cnt">${items.length}</span>`)+
    Object.entries(sys).map(([k,n]) =>
    tnode(` data-sys="${escAttr(k)}"`,"folder",`${escAttr(k)} <span class="cnt">${n}</span>`)).join("");
  window.lucide&&lucide.createIcons();
}
let sortState=null;   // M3/FR-1.4：{key,dir} 作用于渲染副本，items 原序与 seq 引用稳定
let curSeq=null;      // 键盘焦点行
function visibleItems(){  // 筛选（叠加 AND，仅隐藏不丢数据）+ 搜索 + 排序
  const q=($("#q").value||"").trim().toLowerCase();
  const fs=$("#fSys").value,ft=$("#fType").value,fr=$("#fReuse").value,todo=$("#fTodo").checked;
  let arr=items.filter(it=>{
    if(fs&&it.system!==fs)return false;
    if(ft&&it.type!==ft)return false;
    if(fr&&it.reuse!==fr)return false;
    if(todo&&it.ok)return false;
    if(q&&!(String(it.desc||"")+String(it.count_item||"")+String(it.system||"")).toLowerCase().includes(q))return false;
    return true;
  });
  if(sortState){const{key,dir}=sortState;
    arr=[...arr].sort((a,b)=>{const va=key==="us"?us(a):a[key],vb=key==="us"?us(b):b[key];
      return (va>vb?1:va<vb?-1:0)*dir;});}
  return arr;
}
function syncSysFilter(){const sel=$("#fSys");if(!sel)return;
const cur=sel.value;
  const sys=[...new Set(items.map(x=>x.system))];
  sel.innerHTML='<option value="">全部模块</option>'+sys.map(s=>`<option ${s===cur?"selected":""}>${s}</option>`).join("");}
function sortBy(key){if(!sortState||sortState.key!==key)sortState={key,dir:1};
  else if(sortState.dir===1)sortState={key,dir:-1};else sortState=null;
render();}
/* T01501（S3776）：原为 forEach 内双层嵌套判空 + 三元套三元（排序列判定 + aria-sort 判定），
   复杂度超阈值。拆为「取排序态」与「取 aria-sort 值」两个纯函数，循环体只做赋值。*/
function sortDirOf(key){
  if(!sortState)return 0;            // 0=未排序
  if(sortState.key!==key)return 0;
  return sortState.dir;               // 1=升序 -1=降序
}
function ariaSortOf(key){
  const d=sortDirOf(key);
  return d===0?"none":(d===1?"ascending":"descending");
}
function updateSortInd(){
  ["desc","type","us"].forEach(k=>{
    const d=sortDirOf(k);
    const el=document.getElementById("s-"+k);
    if(el)el.textContent=d===0?"":(d===1?"▲":"▼");
    // FR-UI05：aria-sort 同步实际排序状态，读屏才能播报当前列与升降序（WCAG 1.3.1）
    const th=document.querySelector(`th[onclick*="sortBy('${k}')"]`);
    if(th)th.setAttribute("aria-sort",ariaSortOf(k));
  });
}
function clearFilters(){$("#q").value="";["fSys","fType","fReuse"].forEach(id=>$("#"+id).value="");
  $("#fTodo").checked=false;sortState=null;render();toast("已清除筛选与排序");}
// FR-UI07：emptyState / errorBox 已迁至 22_fr_ui04_ui07_动效_空态插画.js（补插画与语义容器），
// 本模块只保留列表渲染，避免两处定义互相覆盖（后定义者胜出会静默改行为）。
function rowHTML(it){
  return `<tr class="rowr ${it.ok?'done':''}" data-seq="${it.seq}" data-sys="${escAttr(it.system)}">
      <td><input type="checkbox" class="ck" ${it.ok?'checked':''}></td>
      <td><div class="desc">${it.desc||it.count_item}</div><br><button class="toggle" onclick="toggleBasis(${it.seq})" title="判定依据" aria-label="判定依据"><i aria-hidden="true" data-lucide="chevron-down" style="width:13px;height:13px;vertical-align:-2px"></i></button><div class="basis">${it.basis||''}</div></td>
      <td><div class="cat ${CATCOLOR[it.type]}">${it.type}</div><div style="font-size:11px;color:var(--muted);margin-top:4px">${it.count_item}</div></td>
      <td><div style="display:flex;gap:4px">${typeCell(it)}${cxCellHTML(it)}</div></td>
      <td class="num" data-u>${ufp(it)}</td><td>${reuseHTML(it)}</td><td>${modHTML(it)}</td><td class="num" data-s>${us(it)}</td>
      <td><span class="rowst">${badge(it)}</span></td>
    </tr>`;}
function render(opts){   // FR-3.3：light 模式跳过树重建/筛选同步（滚动路径专用，建树开销不随窗口变化）
  const light=opts&&opts.light;
  if(!light){buildTree();syncSysFilter();updateSortInd();}
  const arr=visibleItems();
  $("#listCnt").textContent=tf("review.count",{n:arr.length});
  const bb=$("#batchBar");bb.style.display=arr.length?"flex":"none";$("#batchCnt").textContent=arr.length;
  if(!items.length){
    $("#tbody").innerHTML=`<tr><td colspan="9">${emptyState("inbox","暂无候选功能项","上传需求文档并完成识别后，候选功能点将出现在这里","")}</td></tr>`;
    refreshTotals();window.lucide&&lucide.createIcons();return;}
  if(!arr.length){
    $("#tbody").innerHTML=`<tr><td colspan="9">${emptyState("search-x","没有匹配的功能项","调整搜索词或清除筛选后重试",'<button class="btn btn-ghost" onclick="clearFilters()">清除筛选</button>')}</td></tr>`;
    refreshTotals();window.lucide&&lucide.createIcons();return;}
  if(!window.__showb)window.__showb=new Set();   // FR-3.3：展开状态改 Set 驱动（虚拟路径可还原）
  const ckBind=()=>document.querySelectorAll(".ck").forEach(c=>c.addEventListener("change",e=>{
    const seq=+e.target.closest("tr").dataset.seq,it=items.find(x=>x.seq===seq);
    it.ok=e.target.checked;e.target.closest("tr").classList.toggle("done",e.target.checked);
    const rs=e.target.closest("tr").querySelector(".rowst");if(rs)rs.innerHTML=badge(it);
    window.lucide&&lucide.createIcons();refreshTotals();
  }));
  if(arr.length>CT.threshold){   // FR-3.3（UI03）：虚拟滚动窗口渲染
    ctRenderVirtual($("#tbody"),arr,it=>rowHTML(it),curSeq,window.__showb);
    ckBind();
    ctBindScroll($("#tbody"),()=>render({light:true}));
    refreshTotals();window.lucide&&lucide.createIcons();return;
  }
  $("#tbody").innerHTML=arr.map(it=>rowHTML(it).replace('class="rowr',`class="rowr ${it.seq===curSeq?'cur':''} ${window.__showb&&window.__showb.has(it.seq)?'showb':''}`)).join("");
  ckBind();
  refreshTotals();window.lucide&&lucide.createIcons();
}
$("#tbody").addEventListener("change",e=>{const s=e.target;if(!s.dataset.k)return;
const it=items.find(x=>x.seq===+s.dataset.seq);recordRej(it,s.dataset.k,it[s.dataset.k],s.value);it[s.dataset.k]=s.value;refreshRow(it);refreshTotals();saveFormState();updateRejBadge();});
$("#q").addEventListener("input",e=>{render();});   // M3：搜索纳入统一筛选（叠加 AND）
function toggleBasis(seq){
  const tr=document.querySelector(`tr[data-seq="${seq}"]`);
  if(tr){tr.classList.toggle("showb");const on=tr.classList.contains("showb");on?window.__showb.add(seq):window.__showb.delete(seq);}
  else{window.__showb.has(seq)?window.__showb.delete(seq):window.__showb.add(seq);render();}   // 虚拟路径：窗口外行走状态重渲
}
function showAllBasis(){items.forEach(it=>{window.__showb.add(it.seq);const tr=document.querySelector(`tr[data-seq="${it.seq}"]`);if(tr)tr.classList.add("showb");});
  if(document.querySelector("#tbody .vsp"))render();}   // 虚拟路径重渲窗口
// 按功能模块过滤：此前用 tr.textContent.includes(sys) 判断，但表格行并不展示 system 字段，
// 导致点击模块标题后所有行都被隐藏（数据"消失"）。改为按行内 data-sys 精确匹配。
function filterSys(node){
  const sys=(node&&node.dataset)?node.dataset.sys:"";
  document.querySelectorAll("#tree .tnode").forEach(n=>n.classList.toggle("on",n===node));
  document.querySelectorAll("#tbody tr").forEach(tr=>{
    tr.style.display=(!sys||tr.dataset.sys===sys)?"":"none";
  });
}
// 全选/全不选：同步每行勾选态、状态徽标与底部统计（render 内部会刷新）
function toggleAllCk(v){
  if(!items.length)return;
  items.forEach(it=>it.ok=!!v);
  render();
  toast(v?"已全部确认":"已全部取消确认");
}
function goStep(s){document.body.dataset.step=s;
  const v=document.querySelector(`#v-${s}`);if(v){v.classList.remove("step-anim");void v.offsetWidth;v.classList.add("step-anim");}   // FR-3.4：步骤过渡（reduced-motion 下自动禁用）
  $("#st1").classList.toggle("on",s==="upload");$("#st2").classList.toggle("on",s==="review");$("#st3").classList.toggle("on",s==="result");
  if(s==="result")buildResult();
  if(s==="result"){foldApply();rAnchorWatch();}window.scrollTo({top:0,behavior:'smooth'});
  saveFormState();}
// 步骤条导航入口（与 PERT 步骤条点击行为一致）：未识别出功能点时禁止跳到审核/结果，避免空页
function goStepNav(s){
  if((s==="review"||s==="result") && (!items || !items.length)){
    toast("请先上传需求文档并完成识别");return;
  }
  goStep(s);
}

/* ============ 页面导航 ============ */
let llmCfg=null;  // 配置中心当前配置（含 provider 与 llm）
let providers={};
let PERT_PHASES=["需求分析","系统设计","开发","实施","公共及远程","现场维护"];
let pertPid=null, pertItems=[], pertSummary=null;
function goPage(p){
  document.body.dataset.page=p;
  document.querySelectorAll(".m-item").forEach(b=>b.classList.toggle("on",b.dataset.page===p));
  if(p==="config")bindConfig();   // 进入配置中心时加载已存配置
  if(p==="config")rulesLoad();    // M3/FR-2.9：加载识别规则表
  if(p==="config")ratesLoad();    // M6/FR-2.3：加载费率版本
  if(p==="fast")fastRender();     // M6/FR-2.1：快算页
  if(p==="pert")pertInit();
  if(p==="help")loadAppInfo();
  window.scrollTo({top:0,behavior:'smooth'});
  saveFormState();
}

/* ============ PERT 三点估算 ============ */
function pertFillPhase(){
  const sel=$("#pertPhase");
  if(sel.options.length!==PERT_PHASES.length){
    sel.innerHTML=PERT_PHASES.map(x=>`<option>${x}</option>`).join("");
  }
}
function pertInit(){pertFillPhase();pertLoadProjects();pertSyncStart();window.lucide&&lucide.createIcons();}
function pertStep(s){
  // 切换 PERT 步骤视图（in=需求输入/edit=估算录入/gen=结果生成），与 IFPUG 步骤条风格一致
  document.body.dataset.pertstep=s;
  const map={in:1,edit:2,gen:3};
  Object.keys(map).forEach(k=>{$("#pst"+map[k]).classList.toggle("on",k===s);});
  window.lucide&&lucide.createIcons();
  saveFormState();
}
function pertMark(box,cls,txt){box.className="cfg-test "+cls;box.textContent=txt;}
async function pertPost(path,payload){
  const r=await fetch(API+path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
  return r.json();
}
async function pertLoadProjects(){
  // 拉取项目列表填充左侧下拉，供快速切换历史项目
  try{
    const r=await pertPost("/api/pert/projects",{});
    const sel=$("#pertProjSel");
    sel.innerHTML='<option value="">— 请选择 —</option>'+
      (r.projects||[]).map(p=>`<option value="${p.id}">${p.name}</option>`).join("");
    if(pertPid)sel.value=pertPid;
  }catch(e){/* 列表拉取失败不阻塞主流程 */}
}
/* T00929：暂存文档与候选都和「当前项目」强相关，切换/新建项目时一并作废，
   否则会出现「用 A 项目的文档往 B 项目拆分导入」且界面无任何提示。 */
function pertClearStaged(){
  const had=!!pertFile;
  pertFile=null;          // 先清文件，pertCandClear 才会把 #pertUpName 复位为空
  pertCandClear();        // 清候选区（其内的三值/勾选同样属于上一份文档）
  $("#pertStartMsg").textContent="";
  pertSyncStart();        // 触发按钮回到禁用态
  return had;
}
async function pertPickProj(){
  const id=+$("#pertProjSel").value;if(!id)return;
  if(pertClearStaged())toast("已清空上一份待识别文档");
  pertPid=id;await pertRefresh();
  pertStep('edit');           // 选中项目后进入估算录入
}
async function pertNew(){
  const name=$("#pertName").value.trim();if(!name){toast("请填写项目名称");return;}
  const r=await pertPost("/api/pert/project",{name,estimator:$("#pertEst").value.trim()});
  if(!r.ok){toast(r.msg||"新建失败");return;}
  const hadStaged=pertClearStaged();
  pertPid=r.project_id;
  toast(hadStaged?"项目已创建，已清空上一份待识别文档":"项目已创建");
  $("#pertName").value="";
  await pertLoadProjects();   // 新建后刷新下拉，使新项目可见
  await pertRefresh();
  pertStep('edit');           // 建好后进入估算录入
}
async function pertRefresh(){
  if(!pertPid)return;
  const r=await pertPost("/api/pert/list",{project_id:pertPid});
  if(!r.ok){toast(r.msg);return;}
  $("#pertCur").textContent=r.project.name;
  $("#pertEst").value=r.project.estimator;
  pertItems=r.items;
  renderPert();
  applyPertSummary(r.summary);
}
async function pertAdd(){
  if(!pertPid){toast("请先新建或选择项目");return;}
  const d=$("#pertD").value.trim();if(!d){toast("请填写功能描述");return;}
  const M=Number.parseFloat($("#pertM").value);
  if(Number.isNaN(M)){toast("请填写最可能值");return;}
  // 乐观/悲观留空时默认取最可能值，降低录入门槛
  const O=$("#pertO").value===""?M:Number.parseFloat($("#pertO").value);
  const P=$("#pertP").value===""?M:Number.parseFloat($("#pertP").value);
  if(Number.isNaN(O)||Number.isNaN(P)){toast("请输入有效数字");return;}
  if(!(O<=M&&M<=P)){toast("需满足 乐观 ≤ 最可能 ≤ 悲观");return;}
  const r=await pertPost("/api/pert/item",{project_id:pertPid,phase:$("#pertPhase").value,
    desc:d,optimistic:O,most_likely:M,pessimistic:P});
  if(!r.ok){toast(r.msg||"添加失败");return;}
  // 清空录入行，阶段下拉保留便于连续录入同阶段
  $("#pertD").value="";$("#pertO").value="";$("#pertM").value="";$("#pertP").value="";
  await pertRefresh();
}
async function pertDel(id){
  if(!confirm("删除该估算项？"))return;
  await pertPost("/api/pert/delete",{project_id:pertPid,id});
  await pertRefresh();
}
function pertExp(o,m,p){return (o+4*m+p)/6;}
function pertSig(o,p){return (p-o)/6;}
function pertEditCell(id,field,el){
  // 行内编辑：点击数值单元格 → 变 input，失焦/回车提交，Esc 取消
  const old=(el.dataset&&el.dataset.v!==undefined)?el.dataset.v:el.textContent.trim();
  const inp=document.createElement("input");
  inp.type="number";inp.min="0";inp.step="0.1";inp.value=old;
  inp.style.cssText="width:58px;padding:4px 6px;border:1px solid var(--brand);border-radius:6px;text-align:center;font-family:var(--ff);font-size:13px";
  el.textContent="";el.appendChild(inp);inp.focus();inp.select();
  const commit=async()=>{
    const v=inp.value;if(v===old){el.textContent=old||"—";return;}
    const num=v===""?null:Number.parseFloat(v);
    if(v!==""&&Number.isNaN(num)){el.textContent=old||"—";toast("请输入有效数字");return;}
    const it=pertItems.find(x=>x.id===id);
    const tri={optimistic:it.optimistic,most_likely:it.most_likely,pessimistic:it.pessimistic};
    tri[field]=num;
    // 三值填齐才校验 O≤M≤P，允许逐步补填
    const full=tri.optimistic!=null&&tri.most_likely!=null&&tri.pessimistic!=null;
    if(full&&!(tri.optimistic<=tri.most_likely&&tri.most_likely<=tri.pessimistic)){
      el.textContent=old||"—";toast("需满足 乐观 ≤ 最可能 ≤ 悲观");return;
    }
    el.dataset.v=num;el.textContent=num==null?"—":num;   // 先本地更新，避免等待期间闪烁
    const r=await pertPost("/api/pert/item",{project_id:pertPid,id,
      phase:it.phase,desc:it.desc,...tri});
    if(r.ok){await pertRefresh();}else{el.dataset.v=old;el.textContent=old||"—";toast(r.msg||"更新失败");}
  };
  inp.addEventListener("blur",commit);
  inp.addEventListener("keydown",e=>{if(e.key==="Enter")inp.blur();
if(e.key==="Escape"){el.textContent=old||"—";}});
}
function renderPert(){
  $("#pertCount").textContent=pertItems.length+" 项";
  $("#pertTbody").innerHTML=pertItems.map(it=>{
    const has=it.optimistic!=null&&it.most_likely!=null&&it.pessimistic!=null;
    const e=has?pertExp(it.optimistic,it.most_likely,it.pessimistic):null;
    const s=has?pertSig(it.optimistic,it.pessimistic):null;
    const triCell=field=>`<td class="num" data-v="${it[field]??''}" style="cursor:pointer" title="${it[field]==null?'待填写，点击录入':'点击修改'}" onclick="pertEditCell(${it.id},'${field}',this)">${it[field]==null?'—':it[field]}</td>`;
    return `<tr>
      <td><span class="cat" style="background:var(--brand-soft);color:var(--brand-ink)">${it.phase||'开发'}</span></td>
      <td><div class="desc">${it.desc}${has?'':' <span style="color:var(--danger-ink);font-size:11px">待填</span>'}</div></td>
      ${triCell('optimistic')}${triCell('most_likely')}${triCell('pessimistic')}
      <td class="num">${has?e.toFixed(2):'—'}</td><td class="num">${has?s.toFixed(2):'—'}</td>
      <td><button class="toggle" onclick="pertDel(${it.id})" title="删除估算项" aria-label="删除估算项"><i aria-hidden="true" data-lucide="trash-2" style="width:13px;height:13px;vertical-align:-2px"></i></button></td>
    </tr>`;
  }).join("");
  window.lucide&&lucide.createIcons();
}
function applyPertSummary(s){
  if(!s)return;
  $("#pTotal").textContent=s.total_days;
  $("#pIdeal").textContent=s.ideal_person_month;
  $("#pAdj").textContent="+"+(s.adjust_sum*100).toFixed(0)+"%";
  $("#pActual").textContent=s.actual_person_month;
  pertSummary=s;
}
async function pertGen(){
  if(!pertPid){toast("请先新建或选择项目");return;}
  if(!pertItems||!pertItems.length){toast("无估算项，请先录入");return;}
  const box=$("#pertBox");pertMark(box,"wait","正在生成成品表…");
  try{
    const r=await pertPost("/api/pert/generate",{project_id:pertPid,est_date:new Date().toISOString().slice(0,10)});
    if(!r.ok){pertMark(box,"bad",r.msg);return;}
    pertMark(box,"ok",`已生成：${r.sid}（预期 ${r.summary.total_days} 人天 / 实际 ${r.summary.actual_person_month} 人月）`);
    await downloadPert(r.sid);
  }catch(e){pertMark(box,"bad",e.message);}
}
async function downloadPert(sid){
  const url=API+"/api/download?s="+encodeURIComponent(sid);
  const r=await fetch(url);
  const blob=await r.blob();
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=sid;
  document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},800);
}

/* PERT 从需求文档导入（AI 拆分功能点 + 评估工作量，勾选确认后落库）
   T00928：上传文档只暂存文件（不再选中即自动识别），由「上传文档开始识别」按钮显式触发，
   并按配置中心「启用大模型辅助识别」开关决定走 AI 分析或离线分析。 */
let pertCands=[];
let pertImportSource="local";   // 最近一次导入来源：llm=AI 拆分（确认导入时替换）/ local=本地追加
let pertFile=null;              // 暂存待识别的需求文档（.docx/.doc/.pdf）
document.addEventListener("DOMContentLoaded",()=>{
  const dropEl=$("#pertDrop"),upEl=$("#pertUpFile");
  if(!dropEl)return;
  dropEl.addEventListener("click",()=>upEl.click());
  // FR-UI05：PERT 拖放区键盘不可达，补 Enter/Space 走同一 file 路径
  dropEl.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();upEl.click();}});
  // FR-UI04：原用 dragover 加高亮、dragleave 移除，鼠标划过子元素时高亮反复闪烁。
  // bindDropZone 改用 enter/leave 深度计数，只在真正离开时才熄灭。
  bindDropZone(dropEl,pertSetFile);
  upEl.addEventListener("change",()=>{if(upEl.files[0])pertSetFile(upEl.files[0]);
upEl.value="";});
  const ta=$("#pertTextArea");
  if(ta)ta.addEventListener("input",pertSyncStart);   // 粘贴文本同样点亮触发按钮
});
/* 触发按钮可用性：有暂存文档或已粘贴文本才可点击（禁用态随文件上传变化） */
function pertSyncStart(){
  const btn=$("#pertStartBtn");
  if(!btn)return;
  const hasText=!!($("#pertTextArea").value||"").trim();
  btn.disabled = !(pertFile||hasText);
}
function pertSetFile(f){
  const ext=(f.name||"").toLowerCase().split(".").pop();
  if(!["docx","doc","pdf"].includes(ext)){toast("请选择 Word(.docx/.doc) 或 PDF 文件");return;}
  pertFile=f;
  $("#pertUpName").textContent="已就绪："+f.name+"（点「上传文档开始识别」开始）";
  $("#pertDrop").style.borderColor="var(--brand)";
  $("#pertStartMsg").textContent="";
  pertSyncStart();
}
/* 配置中心「启用大模型辅助识别」开关状态：配置中心已加载时以开关当前状态为准，
   未加载返回 null，由后端回退读取已保存配置（与 IFPUG 页 startBtn 同口径）。 */
function pertLlmEnabled(){
  if(!llmCfg)return null;
  const sw=$("#llmSwitch");
  return sw?sw.classList.contains("on"):!!(llmCfg.llm&&llmCfg.llm.enabled);
}
async function pertStart(){
  if(!pertPid){toast("请先新建或选择项目");return;}
  const btn=$("#pertStartBtn"),msg=$("#pertStartMsg"),text=($("#pertTextArea").value||"").trim();
  if(!pertFile&&!text){toast("请先上传需求文档或粘贴需求文本");return;}
  const on=pertLlmEnabled();
  btn.disabled=true;
  msg.textContent = on===false?"大模型辅助识别未启用，走离线分析…"
                  : on===true ?"大模型辅助识别已启用，AI 分析中…"
                  : "正在按已保存配置分析…";
  try{
    const payload={project_id:pertPid};
    if(on!==null)payload.llm_enabled=on;
    if(pertFile){payload.name=pertFile.name;payload.b64=await toB64(pertFile);}
    else{payload.text=text;}
    const resp=await fetch(API+"/api/pert/import",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify(payload)});
    const res=await resp.json();
    if(!res.ok)throw new Error(res.msg||"分析失败");
    pertCands=(res.candidates||[]).map((c,i)=>({...c,seq:i+1,checked:true}));
    pertImportSource=res.source||"local";
    $("#pertUpName").textContent=(pertFile?pertFile.name:"需求文本")+" · "+pertCands.length+" 项";
    $("#pertCandSrc").textContent=(res.source==="llm")?"AI 评估":"本地识别";
    pertRenderCands();
    pertStep('edit');           // 候选确认区位于步骤2，识别后自动切过去
    toast(res.source==="llm"?`AI 已拆分并评估 ${pertCands.length} 个功能点，请勾选确认`
                            :`已离线识别 ${pertCands.length} 个功能点，请补填三值`);
    msg.textContent="";
  }catch(e){msg.textContent="分析失败："+e.message;toast(e.message);}
  pertSyncStart();
}
function pertRenderCands(){
  const box=$("#pertCandBox");
  if(!pertCands.length){box.style.display="none";return;}
  const inp=(c,field)=>`<input type="number" min="0" step="0.1" value="${c[field]==null?'':c[field]}" data-pert-cand="${field}" data-cand="${c.seq}" style="width:60px;padding:4px 4px;border:1px solid var(--line);border-radius:6px;text-align:center;font-size:12px">`;
  $("#pertCandTbody").innerHTML=pertCands.map(c=>`
    <tr>
      <td style="text-align:center"><input type="checkbox" data-cb="${c.seq}" ${c.checked?'checked':''} onchange="pertCandToggle(${c.seq},this.checked)"></td>
      <td><select data-cand-phase="${c.seq}" style="padding:4px 2px;border:1px solid var(--line);border-radius:6px;font-size:12px;background:var(--card)">${PERT_PHASES.map(ph=>`<option ${ph===c.phase?'selected':''}>${ph}</option>`).join("")}</select></td>
      <td><div class="desc">${c.desc}</div></td>
      <td>${inp(c,'optimistic')}</td><td>${inp(c,'most_likely')}</td><td>${inp(c,'pessimistic')}</td>
    </tr>`).join("");
  box.style.display="block";
  window.lucide&&lucide.createIcons();
}
function pertCandToggle(seq,v){const c=pertCands.find(x=>x.seq===seq);if(c)c.checked=v;}
function pertCandAll(v){
  pertCands.forEach(c=>c.checked=!!v);
  document.querySelectorAll("#pertCandTbody input[data-cb]").forEach(el=>el.checked=!!v);
}
function pertCandClear(){
  pertCands=[];$("#pertCandBox").style.display="none";
  // 暂存文档保留，便于调整后再次触发；仅把提示文案还原为「已就绪」
  $("#pertUpName").textContent=pertFile?"已就绪："+pertFile.name+"（点「上传文档开始识别」开始）":"";
  pertSyncStart();
}
async function pertCandConfirm(){
  const sel=pertCands.filter(c=>{const cb=document.querySelector(`#pertCandTbody input[data-cb="${c.seq}"]`);return cb&&cb.checked;});
  if(!sel.length){toast("请勾选要导入的项");return;}
  // 启用大模型（source=llm）时，AI 拆分结果应为录入区唯一内容：替换而非追加，避免重复
  const replace = pertImportSource==="llm";
  if(replace && pertItems && pertItems.length &&
     !confirm("启用大模型：导入将【清空当前估算明细】并替换为 AI 拆分结果。\n确认继续？")){
    return;
  }
  const items=sel.map(c=>{
    const phase=document.querySelector(`#pertCandTbody select[data-cand-phase="${c.seq}"]`).value;
    const g=f=>{const el=document.querySelector(`#pertCandTbody input[data-pert-cand="${f}"][data-cand="${c.seq}"]`);return el?el.value:"";};
    const num=v=>v.trim()===""?null:Number.parseFloat(v);
    return {desc:c.desc,phase,system:c.system,optimistic:num(g('optimistic')),most_likely:num(g('most_likely')),pessimistic:num(g('pessimistic'))};
  });
  const r=await pertPost("/api/pert/import/confirm",{project_id:pertPid,items,replace});
  if(!r.ok){toast(r.msg||"导入失败");return;}
  toast(replace?`已替换估算表为 AI 拆分结果（${r.added} 项）`:`已导入 ${r.added} 项，请补填/核对三值`);
  pertCandClear();
  await pertRefresh();
}

/* 默认大模型配置（本地 26_MTask 为跨实例，此处以配置中心存储为准） */
const LLM_DEFAULTS={enabled:false,api:"https://api.openai.com/v1",model:"gpt-4o-mini",key:""};
async function bindConfig(){
  try{
    const r=await fetch(API+"/api/config",{method:"GET"});
    const res=await r.json();
    providers=res.providers||{};
    llmCfg=res.config||{llm:LLM_DEFAULTS,provider:"openai"};
    llmCfg.llm=llmCfg.llm||LLM_DEFAULTS;
    // 渲染开发商下拉
    const sel=$("#providerSel");
    sel.innerHTML=Object.entries(providers).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join("");
    sel.value=llmCfg.provider;
    $("#llmSwitch").classList.toggle("on",!!llmCfg.llm.enabled);
    $("#llmSwitch").setAttribute("aria-checked",llmCfg.llm.enabled?"true":"false");   // FR-UI05：程序化设值同步 aria-checked
    $("#llmApi").value=llmCfg.llm.api||"";
    $("#llmModel").value=llmCfg.llm.model||"";
    $("#llmKey").value=llmCfg.llm.key||"";
    renderModels(PROVIDERS_DEFAULT_MODELS(llmCfg.provider));
    // 回显项目上下文目录配置与已渲染摘要
    try{
      const cr=await fetch(API+"/api/context",{method:"GET"});
      const cj=await cr.json();
      if($("#ctxDir"))$("#ctxDir").value=cj.context_dir||"";
      if($("#ctxOut")){$("#ctxOut").textContent=cj.rendered||"";}
    }catch(e){/* 上下文回显失败不阻塞配置页 */}
    if($("#updUrl"))$("#updUrl").value=llmCfg.update_url||"";
    // T00962：回显成品表公式缓存策略（后端缺省 async/120）
    if($("#recalcMode")){
      const rc=llmCfg.recalc||{},m=String(rc.mode||"async");
      if([...$("#recalcMode").options].some(o=>o.value===m))$("#recalcMode").value=m;
      $("#recalcTimeout").value=(rc.timeout!=null&&rc.timeout!=="")?rc.timeout:120;
    }
    window.lucide&&lucide.createIcons();
    // 断点续录：无草稿时以后端已保存值为快照基线；有未提交草稿则按域覆盖恢复
    if(!cfgHasDraft())cfgWriteSnapAll();
    cfgRestoreDraft();
  }catch(e){toast("配置加载失败："+e.message);}
}
/* ===== 配置中心断点续录与选项记忆恢复 =====
 * 草稿（wl_cfg_draft_v1）：表单变化防抖写入，白名单字段；
 * 快照（wl_cfg_saved_v1）：各保存按钮成功后按域更新，代表「已提交到后端」的真实状态；
 * 脱敏：API Key 未勾选「记住」时不落盘草稿（key 存空串），重开后需重新输入。
 */
const CFG_DRAFT_KEY="wl_cfg_draft_v1",CFG_SNAP_KEY="wl_cfg_saved_v1";
const CFG_DOMAINS={llm:["enabled","provider","api","model","key","rememberKey"],ctx:["ctxDir"],upd:["updUrl"],rc:["recalcMode","recalcTimeout"]};
const CFG_DOM_NAMES={llm:"大模型配置",ctx:"上下文目录",upd:"更新源",rc:"公式缓存策略"};
function cfgCollect(){
  return {enabled:$("#llmSwitch").classList.contains("on"),provider:$("#providerSel").value,
    api:$("#llmApi").value.trim(),model:$("#llmModel").value.trim(),
    key:$("#rememberKey").checked?$("#llmKey").value.trim():"",   // 脱敏：未勾「记住」不落盘明文
    rememberKey:$("#rememberKey").checked,ctxDir:$("#ctxDir").value.trim(),updUrl:$("#updUrl").value.trim(),
    recalcMode:$("#recalcMode")?$("#recalcMode").value:"async",
    recalcTimeout:$("#recalcTimeout")?$("#recalcTimeout").value:"120"};
}
function cfgPick(src,dom){return CFG_DOMAINS[dom].reduce((o,k)=>{o[k]=src[k]!==undefined?src[k]:null;return o;},{});}
function cfgSnapDomain(dom){
  try{const s=JSON.parse(localStorage.getItem(CFG_SNAP_KEY)||"null");return cfgPick((s&&s.fields)||{},dom);}
  catch(e){return {};}
}
function cfgWriteSnap(dom){
  try{
    const s=JSON.parse(localStorage.getItem(CFG_SNAP_KEY)||"null")||{fields:{}};
    s.fields={...s.fields,...cfgPick(cfgCollect(),dom)};
    localStorage.setItem(CFG_SNAP_KEY,JSON.stringify(s.fields));
  }catch(e){/* localStorage 不可用时静默跳过 */}
}
function cfgWriteSnapAll(){Object.keys(CFG_DOMAINS).forEach(d=>cfgWriteSnap(d));}
function cfgHasDraft(){try{return !!localStorage.getItem(CFG_DRAFT_KEY);}catch(e){return false;}}
function cfgSaveDraft(){
  try{localStorage.setItem(CFG_DRAFT_KEY,JSON.stringify({fields:cfgCollect(),ts:Date.now()}));}
  catch(e){/* 隐私模式等场景不阻塞主流程 */}
}
function cfgRefreshDraft(){
  // 域保存成功后重算草稿：所有域都与快照一致则清除（已无未提交内容）
  try{
    const d=JSON.parse(localStorage.getItem(CFG_DRAFT_KEY)||"null");
    if(!d)return;
    const dirty=Object.keys(CFG_DOMAINS).some(dom=>JSON.stringify(cfgPick(d.fields,dom))!==JSON.stringify(cfgSnapDomain(dom)));
    if(!dirty)localStorage.removeItem(CFG_DRAFT_KEY);
  }catch(e){}
}
// FR-UI05/T01501（S3776）：原为一条 8 分支的 if/else if 链，认知复杂度超阈值。
// 改为「字段 → 处理器」分派表：新增字段只加一条映射，不再加一层嵌套判断。
const CFG_FIELD_HANDLERS={
  enabled(v){const sw=$("#llmSwitch");sw.classList.toggle("on",!!v);sw.setAttribute("aria-checked",v?"true":"false");},
  provider(v){const sel=$("#providerSel");if(sel.querySelector(`option[value="${v}"]`))sel.value=v;},
  rememberKey(v){$("#rememberKey").checked=!!v;},
  ctxDir(v){$("#ctxDir").value=v||"";},
  updUrl(v){$("#updUrl").value=v||"";},
  recalcMode(v){const el=$("#recalcMode");if(!el)return;
    const m=String(v||"async");if([...el.options].some(o=>o.value===m))el.value=m;},
  recalcTimeout(v){const el=$("#recalcTimeout");if(el)el.value=(v==null||v==="")?"":v;},
  key(v){$("#llmKey").value=v||"";},
  api(v){$("#llmApi").value=v||"";},
  model(v){$("#llmModel").value=v||"";},
};
function cfgApplyField(k,v){
  const h=CFG_FIELD_HANDLERS[k];
  if(h)h(v);
}
function cfgRestoreDraft(){
  try{
    const d=JSON.parse(localStorage.getItem(CFG_DRAFT_KEY)||"null");
    if(!d||!d.fields)return;
    const dirty=[];
    Object.keys(CFG_DOMAINS).forEach(dom=>{
      if(JSON.stringify(cfgPick(d.fields,dom))!==JSON.stringify(cfgSnapDomain(dom))){
        dirty.push(dom);
        CFG_DOMAINS[dom].forEach(k=>cfgApplyField(k,d.fields[k]));
      }
    });
    if(dirty.length){
      toast("已恢复未保存草稿："+dirty.map(x=>CFG_DOM_NAMES[x]).join("、")+"，确认后请点保存");
    }else{
      localStorage.removeItem(CFG_DRAFT_KEY);
    }
  }catch(e){/* 恢复失败不阻塞配置页 */}
}
// 表单变化防抖记草稿（事件委托：input/change 覆盖文本与下拉，click 覆盖开关与勾选）
let cfgDraftTimer=null;
function cfgScheduleDraft(){clearTimeout(cfgDraftTimer);cfgDraftTimer=setTimeout(cfgSaveDraft,600);}
(function(){
  const pg=document.querySelector("#pg-config");
  if(!pg)return;
  pg.addEventListener("input",cfgScheduleDraft);
  pg.addEventListener("change",cfgScheduleDraft);
  pg.addEventListener("click",e=>{
    if(e.target.closest(".switch")||e.target.id==="rememberKey")cfgScheduleDraft();
  });
})();
function onProviderChange(){
  // 选择预设厂商时自动填充 API 地址（避免手动录入），并刷新可用模型清单
  const key=$("#providerSel").value;
  const meta=providers[key];
  if(!meta)return;
  if(meta.api)$("#llmApi").value=meta.api;
  renderModels(PROVIDERS_DEFAULT_MODELS(key));
  if(meta.models&&meta.models.length)$("#llmModel").value=meta.models[0];
  toast(`已自动填充 ${meta.label} 配置`);
  cfgSaveDraft();   // JS 程序设值不触发 input 事件，手动记草稿
}
async function openDirPicker(){
  // 优先走本地服务弹原生目录选择对话框（返回绝对路径，选择后自动填入输入框）；
  // 本地服务不可用（纯静态部署）时回退浏览器目录选择器（仅能取到一级目录名）。
  try{
    const r=await fetch(API+"/api/pickdir",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
    const res=await r.json();
    if(res.ok&&res.path){
      $("#ctxDir").value=res.path;
      toast(`已选择目录：${res.path}`);
      return;
    }
    if(res.canceled)return;   // 用户在原生对话框取消，不改动输入框
  }catch(e){/* 本地服务不可达，回退浏览器选择器 */}
  const picker=$("#dirPicker");
  picker.onchange=()=>{
    const f=picker.files&&picker.files[0];
    if(f&&f.webkitRelativePath){
      const dir=f.webkitRelativePath.split("/")[0];
      $("#ctxDir").value=dir;
      toast(`已选择目录：${dir}`);
    }
    picker.value="";
  };
  picker.click();
}
async function saveCtxDir(){
  const dir=$("#ctxDir").value.trim();
  try{
    const r=await fetch(API+"/api/context/config",{method:"POST",headers:{'Content-Type':'application/json'},body:JSON.stringify({context_dir:dir})});
    const res=await r.json();
    if(!res.ok)throw new Error(res.msg||"保存失败");
    toast("上下文目录已保存，识别/估算时将注入项目级上下文");
    cfgWriteSnap("ctx");cfgRefreshDraft();   // 域快照更新：其余未提交域的草稿继续保留
    // 保存后立即尝试扫描，便于看到效果
    await analyzeCtx();
  }catch(e){toast("保存失败:"+e.message);}
}
async function analyzeCtx(){
  const dir=$("#ctxDir").value.trim();
  const box=$("#ctxOut");
  box.className="cfg-test wait";box.textContent="正在扫描项目上下文…";
  if(!dir){box.className="cfg-test";box.textContent="";toast("请先填写并保存目录");return;}
  try{
    const r=await fetch(API+"/api/context/analyze",{method:"POST",headers:{'Content-Type':'application/json'},body:JSON.stringify({context_dir:dir})});
    const res=await r.json();
    if(!res.ok)throw new Error(res.msg||"扫描失败");
    box.className="cfg-test ok";box.style.whiteSpace="pre-wrap";box.textContent=res.rendered;
  }catch(e){box.className="cfg-test bad";box.style.whiteSpace="pre-wrap";box.textContent=e.message;}
}
function PROVIDERS_DEFAULT_MODELS(key){return (providers[key]&&providers[key].models)||[];}
/* ============ 版本检测与一键更新（T00880） ============ */
let verLatest=null;   // 最近一次检测结果 {latest,url,notes,hasUpdate}
async function loadAppInfo(){
  try{
    const r=await fetch(API+"/api/app-info");
    const res=await r.json();
    if($("#verNow"))$("#verNow").textContent=res.version||"—";
  }catch(e){if($("#verNow"))$("#verNow").textContent="—";}
  window.lucide&&lucide.createIcons();
  checkUpdate(false);   // 进帮助页自动静默检测一次
}
// T01501（S3776）：原 checkUpdate 把「失败 / 有更新 / 无更新」三种终态的 DOM 操作
// 全塞在 try 里，与请求、异常处理交织。拆为三个渲染函数后主流程只做「取数 → 分派」，
// 各分支的文案与显隐规则集中可查，改文案不必读控制流。
function renderUpdateFailed(st,msg,manual){
  st.textContent=manual?("检测失败："+msg):(msg==="未配置更新源"?"未配置更新源（配置中心 → 应用更新）":"自动检测失败");
  $("#verUpdBtn").style.display="none";
  if(manual)toast(msg);
}
function renderUpdateFound(st,res,manual){
  verLatest=res;
  st.textContent=`发现新版本 ${res.latest}`;st.style.color="var(--ok)";
  $("#verUpdBtn").style.display="";
  const nt=$("#verNotes");
  if(res.notes){nt.style.display="";nt.className="cfg-test ok";nt.textContent="更新日志：\n"+res.notes;}
  if(manual)toast(`发现新版本 ${res.latest}，可一键更新`);
}
function renderUpToDate(st,manual){
  st.textContent="已是最新版本";st.style.color="var(--ok)";
  $("#verUpdBtn").style.display="none";
  $("#verNotes").style.display="none";
  if(manual)toast("已是最新版本");
}
async function checkUpdate(manual){
  const st=$("#verState");if(!st)return;
  st.textContent="检测中…";st.style.color="var(--muted)";
  try{
    const r=await fetch(API+"/api/update/check");
    const res=await r.json();
    if(!res.ok){renderUpdateFailed(st,res.msg,manual);return;}
    if(res.hasUpdate)renderUpdateFound(st,res,manual);
    else renderUpToDate(st,manual);
  }catch(e){
    st.textContent="检测失败："+e.message;
    if(manual)toast("检测失败："+e.message);
  }
}
async function doUpdate(){
  if(!verLatest||!verLatest.url){toast("未获取到更新包地址，请先检查更新");return;}
  const wrap=$("#verProgWrap");
  wrap.style.display="";
  $("#verRetryBtn").style.display="none";
  $("#verInstallBtn").style.display="none";
  $("#verProgTxt").textContent="开始下载…";
  try{
    const r=await fetch(API+"/api/update/download",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url:verLatest.url})});
    const res=await r.json();
    if(!res.ok)throw new Error(res.msg||"下载启动失败");
    pollUpdateProgress();
  }catch(e){
    $("#verProgTxt").textContent="下载失败："+e.message;
    $("#verRetryBtn").style.display="";
  }
}
let verPollTimer=null;
async function pollUpdateProgress(){
  clearTimeout(verPollTimer);
  try{
    const r=await fetch(API+"/api/update/progress");
    const res=await r.json();
    const pct=res.total>0?Math.floor(res.received*100/res.total):0;
    $("#verProgBar").style.width=pct+"%";
    $("#verProgPct").textContent=res.total>0?(pct+"%（"+(res.received/1048576).toFixed(1)+" / "+(res.total/1048576).toFixed(1)+" MB）"):((res.received/1048576).toFixed(1)+" MB");
    if(res.state==="downloading"){$("#verProgTxt").textContent="正在下载更新包…";}
    else if(res.state==="done"){
      $("#verProgTxt").textContent="下载完成，可安装更新";
      $("#verInstallBtn").style.display="";
      toast("更新包下载完成，点击「安装更新」开始安装");
      return;
    }else if(res.state==="error"){
      $("#verProgTxt").textContent="下载失败："+(res.error||"未知错误");
      $("#verRetryBtn").style.display="";
      return;
    }
  }catch(e){$("#verProgTxt").textContent="进度查询失败，仍在下载…";}
  verPollTimer=setTimeout(pollUpdateProgress,800);
}
async function installUpdate(){
  if(!confirm("安装更新将关闭应用并自动完成安装（本机配置会保留），确定继续？"))return;
  try{
    const r=await fetch(API+"/api/update/install",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
    const res=await r.json();
    if(!res.ok)throw new Error(res.msg||"启动安装器失败");
    $("#verProgTxt").textContent="安装器已启动，应用即将关闭…";
  }catch(e){toast("安装失败："+e.message);}
}
async function saveUpdateUrl(){
  const url=$("#updUrl").value.trim();
  try{
    const r=await fetch(API+"/api/update/config",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({update_url:url})});
    const res=await r.json();
    if(!res.ok)throw new Error(res.msg||"保存失败");
    toast(url?"更新源已保存，打开帮助页即可检测新版本":"已停用版本检测");
    cfgWriteSnap("upd");cfgRefreshDraft();
  }catch(e){toast("保存失败："+e.message);}
}
function readCfgForm(){
  const enabled=$("#llmSwitch").classList.contains("on");
  return {provider:$("#providerSel").value,
    llm:{enabled,api:$("#llmApi").value.trim(),model:$("#llmModel").value.trim(),key:$("#llmKey").value.trim()}};
}
async function saveCfg(){
  const cfg=readCfgForm();
  if(cfg.llm.enabled&&(!cfg.llm.api||!cfg.llm.key)){toast("启用增强前请填写 API 地址与 Key");return;}
  try{
    const r=await fetch(API+"/api/config",{method:"POST",headers:{'Content-Type':'application/json'},body:JSON.stringify(cfg)});
    const res=await r.json();
    if(!res.ok)throw new Error(res.msg||"保存失败");
    toast("配置已保存，识别时将使用新配置");
    cfgWriteSnap("llm");cfgRefreshDraft();
  }catch(e){toast("保存失败:"+e.message);}
}
async function saveRecalcCfg(){
  // T00962：成品表公式缓存策略（mode + timeout）单独保存，不与大模型配置混在一次提交
  const mode=$("#recalcMode").value,tv=Number.parseFloat($("#recalcTimeout").value);
  if(!(tv>=5&&tv<=1800)){toast("重算超时需在 5~1800 秒之间");return;}
  try{
    const r=await fetch(API+"/api/config",{method:"POST",headers:{'Content-Type':'application/json'},body:JSON.stringify({recalc:{mode,timeout:tv}})});
    const res=await r.json();
    if(!res.ok)throw new Error(res.msg||"保存失败");
    toast("公式缓存策略已保存："+(mode==="async"?"后台补算":mode==="sync"?"同步重算":"不重算"));
    cfgWriteSnap("rc");cfgRefreshDraft();
  }catch(e){toast("保存失败:"+e.message);}
}
async function testCfg(){
  const cfg=readCfgForm();
  const box=$("#cfgTestBox");
  box.className="cfg-test wait";box.textContent="正在连接…";
  try{
    const r=await fetch(API+"/api/config/test",{method:"POST",headers:{'Content-Type':'application/json'},body:JSON.stringify(cfg)});
    let res; try{res=await r.json()}catch(_){throw new Error(`后端返回非 JSON（HTTP ${r.status}），地址 ${API}`)}
    if(res.ok){
      box.className="cfg-test ok";box.textContent=`连接成功（${res.elapsed_s}s）模型 ${res.model} 回复：${res.reply||"(空)"}`;
    }else{
      box.className="cfg-test bad";box.textContent="连接失败："+res.msg;
    }
  }catch(e){
    box.className="cfg-test bad";
    box.textContent=`连接失败：${e.message}｜后端地址 ${API}，请确认引擎已启动（scripts/启动服务.bat，端口 8020）`;
  }
}
async function fetchModels(){
  // readCfgForm 的结果由 saveCfg 内部自行读取，此处不再暂存
  await saveCfg();  // 先落盘，后端 /models 用已存 key
  const box=$("#cfgTestBox");
  box.className="cfg-test wait";box.textContent="正在获取模型…";
  try{
    const r=await fetch(API+"/api/config/models",{method:"GET"});
    const res=await r.json();
    if(!res.ok)throw new Error(res.msg||"获取失败");
    renderModels(res.models);
    box.className="cfg-test ok";box.textContent=`共 ${res.models.length} 个可用模型（${llmCfg.provider}）`;
  }catch(e){box.className="cfg-test bad";box.textContent="获取失败："+e.message;}
}
function renderModels(list){
  const box=$("#modelList");
  if(!list||!list.length){box.innerHTML='<span style="font-size:12px;color:var(--muted)">无可用模型。</span>';return;}
  // FR-UI05：模型芯片是可点选控件，补 role=button + tabindex=0 + Enter/Space 键效
  box.innerHTML=list.map(m=>`<span class="model-chip" role="button" tabindex="0" data-m="${escAttr(m)}" onclick="pickModel(this.dataset.m)" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();pickModel(this.dataset.m)}">${escAttr(m)}</span>`).join("")+"";
}
function pickModel(m){$("#llmModel").value=m;
  document.querySelectorAll(".model-chip").forEach(c=>c.classList.toggle("sel",c.dataset.m===m));
}
function openConsole(){
  const key=$("#providerSel").value;
  const url=(providers[key]&&providers[key].console)||"";
  if(url)window.open(url,"_blank");else toast("当前开发商未提供控制台链接");
}
function resetCfg(){
  $("#llmSwitch").classList.remove("on");
  $("#llmApi").value=LLM_DEFAULTS.api;$("#llmModel").value=LLM_DEFAULTS.model;$("#llmKey").value="";
  const box=$("#cfgTestBox");box.className="cfg-test";box.textContent="";
  toast("已恢复默认配置");
  cfgSaveDraft();   // 默认值尚未提交，同样纳入草稿续录
}

/* 上传 */
const drop=$("#drop"),file=$("#file");
drop.addEventListener("click",()=>file.click());
// FR-UI05：拖放区原为纯 div+click，键盘不可达（SonarQube Web:S6848）。
// 补 Enter/Space 键效走同一 file.click() 路径，与鼠标点击行为完全一致。
drop.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();file.click();}});
// FR-UI04：上传区原先只有 dragover 的 preventDefault，拖入时毫无视觉反馈（无高亮）。
// 改用 bindDropZone：dragenter/leave 计数防子元素抖动，且 drop 后才取文件。
bindDropZone(drop,setFile);
file.addEventListener("change",()=>{if(file.files[0])setFile(file.files[0]);});
function setFile(f){curFile=f;histClearCtx();if(f.name.endsWith(".docx")){$("#fname").textContent=f.name;drop.classList.add("has");$("#startBtn").disabled=false;}else{toast("请选择 .docx 文件");}}
function rstFile(){curFile=null;histClearCtx();drop.classList.remove("has");file.value="";$("#startBtn").disabled=true;}

// T01079：必须监听 onerror——文件失效（被移动/删除/无权限）时 onload 永不触发，
// 无 reject 的 Promise 会让识别流程无限挂起、按钮永久灰显。
function toB64(f){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(",")[1]);r.onerror=()=>rej(new Error("文件读取失败（可能已被移动、删除或无访问权限）"));r.readAsDataURL(f);});}

// 开关（质量特性 / 大模型启用）点击切换 on 态
// FR-UI05：switch 原为 span+click，键盘不可达、读屏不播报状态。
// 统一走 toggleSwitch：同步 class + aria-checked，并支持 Enter/Space 键效。
function toggleSwitch(el){const on=el.classList.toggle("on");el.setAttribute("aria-checked",on?"true":"false");return on;}
document.querySelectorAll(".switch").forEach(s=>{
  s.addEventListener("click",()=>toggleSwitch(s));
  s.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();toggleSwitch(s);}});
});
$("#startBtn").addEventListener("click",async ()=>{
  if(!curFile)return;
  const b=$("#startBtn");b.disabled=true;const mk=$("#progressMark");mk.textContent="正在上传并识别…";
  try{
    // 大模型配置来源：配置中心已保存配置（llmCfg 为 null 时后端回退读 data/config.json）
    let params={};
    if(llmCfg){  // 已在会话中加载过配置中心，直接携带，保证即时性
      params={llm_enabled:llmCfg.llm.enabled,llm_api:llmCfg.llm.api,llm_model:llmCfg.llm.model,llm_key:llmCfg.llm.key};
    }else{  // 尚未进入过配置中心：不传 params，后端回退读已存配置
      params={};
    }
    const resp=await fetch(API+"/api/recognize",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({name:curFile.name,b64:await toB64(curFile),params})});
    const res=await resp.json();
    if(!res.ok)throw new Error(res.msg||"识别失败");
    items=res.items.map((it,i)=>({...it,seq:i+1,cx:it.cx||"中",ok:false,_ai:{type:it.type,reuse:it.reuse||"中",modify:it.modify||"修改"}}));
    const llmOn=res.meta&&res.meta.llm_enabled_effective?"（大模型增强已启用）":"";
    mk.textContent="识别完成，共 "+items.length+" 条候选"+llmOn;
    render();goStep("review");
  }catch(err){mk.textContent="识别失败："+err.message;toast(err.message);}
  b.disabled=false;b.innerHTML='<i aria-hidden="true" data-lucide="sparkles" style="width:15px;height:15px"></i>上传文档开始识别';window.lucide&&lucide.createIcons();
});

