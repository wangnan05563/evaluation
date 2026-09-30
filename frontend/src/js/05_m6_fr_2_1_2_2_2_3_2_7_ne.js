/* ===== M6/FR-2.1、2.2、2.3、2.7：NESMA 快算 + GB/T 36964 国标造价 ===== */
const NESMA_PRE={ILF:35,EIF:15},NESMA_EST={ILF:7,EIF:5,EI:4,EO:5,EQ:4};
const GB_CF={预算:1.7,立项:1.45,招标:1.25,需求:1.1,设计:1};
let fastModeV="est",gbUfpSrc=null,gbState=null,__rates=null;
async function ratesGet(force){  // FR-2.3：费率版本（缓存 + 强刷）
  if(!__rates||force) __rates=await(await fetch(API+"/api/rates",{cache:"no-store"})).json();
  const name=__rates.selected||Object.keys(__rates.versions||{})[0];
  const v=(__rates.versions||{})[name]||{};
  return {name,v,pdr:+v.pdr||6.96,rate:+v.rate||28000,dnhc:+v.dnhc||0,source:v.source||"CSBMK 基准",swf:v.swf||{},rdf:v.rdf||{}};
}
/* FR-2.1：NESMA 快算（输入即算） */
function fastMode(m){fastModeV=m;fastRender();}
function fastRender(){
  const box=document.getElementById("fastCounts");
  const keys=fastModeV==="pre"?["ILF","EIF"]:["ILF","EIF","EI","EO","EQ"];
  const prev={};box.querySelectorAll("input").forEach(i=>prev[i.dataset.k]=i.value);
  box.innerHTML=keys.map(k=>`<label style="font-size:12px;color:var(--muted)">${k} 计数<input data-k="${k}" type="number" min="0" value="${prev[k]||0}" style="width:100%;margin-top:4px"></label>`).join("");
  box.querySelectorAll("input").forEach(i=>i.addEventListener("input",fastCalc));
  document.getElementById("fastFormula").textContent=fastModeV==="pre"
    ?"预估法：UFP = 35×ILF + 15×EIF —— 出处：GB/T 42588-2023 / NESMA 2.1（适合立项/招投标无明细阶段）"
    :"估算法：UFP = 7×ILF+5×EIF+4×EI+5×EO+4×EQ —— 出处：GB/T 42588-2023 / NESMA 2.1";
  document.querySelectorAll("#fastMode .btn").forEach(b=>{const on=b.dataset.m===fastModeV;
    b.style.borderColor=on?"var(--brand)":"var(--line)";b.style.color=on?"var(--brand)":"var(--ink-2)";});
  fastCalc();}
async function fastCalc(){
  const box=document.getElementById("fastCounts");const counts={};
  box.querySelectorAll("input").forEach(i=>{if(+i.value>0)counts[i.dataset.k]=+i.value;});
  const table=fastModeV==="pre"?NESMA_PRE:NESMA_EST;
  const ufp=Object.entries(counts).reduce((acc,[k,v])=>acc+(table[k]||0)*v,0);
  const r=await ratesGet();
  const S=ufp*GB_CF["需求"], ae=r.pdr*S, fee=Math.round(ae/174*r.rate+r.dnhc);
  document.getElementById("fastResult").innerHTML=
    `UFP = <b>${ufp}</b> FP（${fastModeV==="pre"?"预估法":"估算法"}）<br>`+
    `S = UFP×GSC×CF = ${S}（GSC=1.0，阶段=需求 CF=${GB_CF["需求"]}）<br>`+
    `AE = PDR×S×SWF×RDF = ${ae} 人时 ≈ ${(ae/174).toFixed(2)} 人月<br>`+
    `费用 = AE/174×费率 + DNHC = <b>${fee}</b> 元（基准版本：${r.name}）<br>`+
    `<small>出处：GB/T 36964-2018 · ${r.source}</small>`;
  window.__fastUfp=ufp;
  const locPerFp= +(localStorage.getItem("wl_loc_fp")||46);   // FR-1.9：语言换算系数（可配）
  const cc=cocomo_ii(ufp*locPerFp/1000);
  const pertRef=Math.round(r.pdr*ufp*GB_CF["需求"]/174*30);   // FR-1.9：UFP→PERT 三点参考（中值，±20% 带宽）
  document.getElementById("fastResult").innerHTML+=
    `<br><small>COCOMO II 参考（KLOC=${(ufp*locPerFp/1000).toFixed(1)}，1FP≈${locPerFp}LOC 可配）：PM=${cc.pm} 人月 · TDEV=${cc.tdev} 月 —— 出处：COCOMO II 2000</small>`+
    `<br><small>PERT 三点参考（FR-1.9 互导）：乐观 ${Math.round(pertRef*0.8)} / 最可能 ${pertRef} / 悲观 ${Math.round(pertRef*1.2)} 人天</small>`;}
function fastToGb(){  // FE01→FE02 串联：快算结果带入国标造价
  if(items.length){goStep("result");gbTab("gb");gbRender();}
  else{gbUfpSrc={kind:"fast",v:window.__fastUfp||0};toast("快算 UFP 已记录；完成详细估算后将在结果页并排对照");}}
/* FR-2.2/2.7：国标造价页签 */
function gbTab(which){
  const vr=document.querySelector("#v-result");
  [...vr.children].forEach(el=>{if(!el.classList.contains("r-tabs")&&el.id!=="gbCard")el.style.display=which==="sum"?"":"none";});
  document.getElementById("gbCard").style.display=which==="gb"?"block":"none";
  document.getElementById("tabSum").style.fontWeight=which==="sum"?"700":"500";
  document.getElementById("tabGb").style.fontWeight=which==="gb"?"700":"500";
  if(which==="gb")gbRender();}
async function gbRender(){
  const r=await ratesGet(true);
  document.getElementById("gbRatesVer").innerHTML=`基准版本：<select id="gbVerSel" style="max-width:130px;font-size:12px" onchange="gbVerChange()">${Object.keys(__rates.versions||{}).map(n=>"<option"+(n===(__rates.selected||"")?" selected":"")+">"+n+"</option>").join("")}</select>`;
  const oldSel=document.getElementById("gbVerSel");if(oldSel&&oldSel.value!==r.name){oldSel.value=r.name;}
  document.getElementById("gbSource").textContent=r.source;
  if(!gbState)gbState={stage:"招标",domain:"金融",app:"后台核心",lang:"Java",team:"一般",gsc:1,custom:{}};
  const domains=Object.keys(r.swf),langs=Object.keys(r.rdf);
  const apps=Object.keys(r.swf[gbState.domain]||{"后台核心":1});
  const teams=Object.keys(r.rdf[gbState.lang]||{"一般":1});
  const ufp=gSummary?gSummary.ufp:(gbUfpSrc?gbUfpSrc.v:0);
  const ufTag=gSummary?"详细功能点法":(gbUfpSrc?"NESMA 快算":"手动输入");
  const f=document.getElementById("gbFactors");
  const opt=(o,val)=>"<option"+(o===val?" selected":"")+">"+o+"</option>";
  const sel=(id,opts,val)=>`<select id="${id}" onchange="gbChange()">${opts.map(o=>opt(o,val)).join("")}</select>`;
  const num=(id,val)=>`<input id="${id}" type="number" step="0.01" value="${val}" style="width:100%" onchange="gbChange()">`;
  const ck=(k,label,base)=>`<input type="checkbox" id="gb${k[0].toUpperCase()+k.slice(1)}Ck" ${gbState.custom[k]!==undefined?"checked":""} onchange="gbToggle('${k}')">自定义（基准 ${base}）`;
  f.innerHTML=`
    <label style="font-size:12px;color:var(--muted)">UFP 来源（${ufTag}）<input id="gbUfpIn" type="number" value="${ufp}" style="width:100%;margin-top:4px" onchange="gbChange()"></label>
    <label style="font-size:12px;color:var(--muted)">估算阶段（FR-2.7）${sel("gbStage",Object.keys(GB_CF),gbState.stage)}</label>
    <label style="font-size:12px;color:var(--muted)">GSC 全局调整 ${gbState.custom.gsc!==undefined?num("gbGsc",gbState.custom.gsc):sel("gbGscSel",["1.0"],String(gbState.gsc))} ${ck("gsc","GSC","1.0")}</label>
    <label style="font-size:12px;color:var(--muted)">业务领域 ${sel("gbDomain",domains,gbState.domain)}</label>
    <label style="font-size:12px;color:var(--muted)">应用类型 ${sel("gbApp",apps,gbState.app)}</label>
    <label style="font-size:12px;color:var(--muted)">SWF ${gbState.custom.swf!==undefined?num("gbSwf",gbState.custom.swf):""} ${ck("swf","SWF",(+gbEvalSwf(r)).toFixed(2))}</label>
    <label style="font-size:12px;color:var(--muted)">开发语言 ${sel("gbLang",langs,gbState.lang)}</label>
    <label style="font-size:12px;color:var(--muted)">团队背景 ${sel("gbTeam",teams,gbState.team)}</label>
    <label style="font-size:12px;color:var(--muted)">RDF ${gbState.custom.rdf!==undefined?num("gbRdf",gbState.custom.rdf):""} ${ck("rdf","RDF",(+gbEvalRdf(r)).toFixed(2))}</label>
    <label style="font-size:12px;color:var(--muted)">PDR（${r.name}）${gbState.custom.pdr!==undefined?num("gbPdr",gbState.custom.pdr):""} ${ck("pdr","PDR",r.pdr)}</label>
    <label style="font-size:12px;color:var(--muted)">人月费率（${r.name}）${gbState.custom.rate!==undefined?num("gbRate",gbState.custom.rate):""} ${ck("rate","费率",r.rate)}</label>
    <label style="font-size:12px;color:var(--muted)">DNHC 直接非人力成本（元）${num("gbDnhc",gbState.custom.dnhc!==undefined?gbState.custom.dnhc:0)}</label>`;
  gbCalc(r);}
function gbVerSelSet(name){const sel=document.getElementById("gbVerSel");
  if(!sel){const _r=gbRender;gbRender=async()=>{await _r();const s2=document.getElementById("gbVerSel");if(s2){s2.value=name;s2.dispatchEvent(new Event('change'));}gbRender=_r;};gbRender();return;}
  sel.value=name;sel.dispatchEvent(new Event('change'));}
async function gbVerChange(){  // FR-2.3：结果页切换基准版本（服务端持久化 selected，估算记录在结果中）
  const doc=structuredClone(__rates);doc.selected=document.getElementById("gbVerSel").value;
  const r=await(await fetch(API+"/api/rates/save",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(doc)})).json();
  if(!r.ok){toast("版本切换失败："+r.msg);return;}
  __rates=null;gbState=null;gbRender();toast(`已选用 ${document.getElementById("gbVerSel").value} 基准版本（v${r.version.version}）`);}
function gbEvalSwf(r){return ((r.swf[gbState.domain]||{})[gbState.app])||1;}
function gbEvalRdf(r){return ((r.rdf[gbState.lang]||{})[gbState.team])||1;}
function gbChange(){
  const g=id=>{const el=document.getElementById(id);return el?(+el.value||0):null;};
  const tv=id=>{const el=document.getElementById(id);return el?el.value:null;};
  if(tv("gbStage"))gbState.stage=tv("gbStage");
  if(tv("gbDomain")){gbState.domain=tv("gbDomain");gbState.app=undefined;}
  if(tv("gbApp"))gbState.app=tv("gbApp");
  if(tv("gbLang")){gbState.lang=tv("gbLang");gbState.team=undefined;}
  if(tv("gbTeam"))gbState.team=tv("gbTeam");
  if(g("gbUfpIn"))gbUfpSrc={kind:"manual",v:g("gbUfpIn")};
  gbRender();}
function gbToggle(k){
  if(gbState.custom[k]!==undefined){delete gbState.custom[k];gbRender();return;}
  const nm=__rates.selected||Object.keys(__rates.versions)[0];
  const ver=__rates.versions[nm]||{};
  const base={swf:((ver.swf||{})[gbState.domain]||{})[gbState.app],
              rdf:((ver.rdf||{})[gbState.lang]||{})[gbState.team],
              pdr:+ver.pdr,rate:+ver.rate,gsc:gbState.gsc,cf:GB_CF[gbState.stage]}[k];
  gbState.custom[k]=base;gbRender();}
function gbCalc(r){  // 实时联动：S/AE/费用 + 出处 + 人工调整标注
  const ufp= +(document.getElementById("gbUfpIn")?.value||0);
  const cf=GB_CF[gbState.stage]||1;
  const gsc=gbState.custom.gsc!==undefined?+gbState.custom.gsc:gbState.gsc;
  const swf=gbState.custom.swf!==undefined?+gbState.custom.swf:gbEvalSwf(r);
  const rdf=gbState.custom.rdf!==undefined?+gbState.custom.rdf:gbEvalRdf(r);
  const pdr=gbState.custom.pdr!==undefined?+gbState.custom.pdr:r.pdr;
  const rate=gbState.custom.rate!==undefined?+gbState.custom.rate:r.rate;
  const dnhc= +(document.getElementById("gbDnhc")?.value||0);
  const S=ufp*gsc*cf, ae=pdr*S*swf*rdf, fee=Math.round(ae/174*rate+dnhc);
  const tag=k=>gbState.custom[k]!==undefined?' <span class="mark" style="padding:1px 6px">人工调整</span>':"";
  gbState.out={ufp,stage:gbState.stage,cf,gsc,swf,rdf,pdr,rate,dnhc,S,ae,fee};
  document.getElementById("gbOut").innerHTML=
    `S = UFP(${ufp}) × GSC(${gsc}${tag("gsc")}) × CF(${gbState.stage}=${cf}) = <b>${S}</b><br>`+
    `AE = PDR(${pdr}${tag("pdr")}) × S × SWF(${swf}${tag("swf")}) × RDF(${rdf}${tag("rdf")}) = <b>${ae}</b> 人时 ≈ <b>${(ae/174).toFixed(2)}</b> 人月<br>`+
    `费用 = AE/174 × 费率(${rate}${tag("rate")}) + DNHC(${dnhc}) = <b>${fee} 元</b>（≈ ${(fee/10000).toFixed(2)} 万元）<br>`+
    `<small>本测算基于 ${gbState.stage} 阶段，CF=${cf} —— 出处：GB/T 36964-2018 · ${r.source}</small>`;}
/* FR-2.3：费率与基准卡片（多版本增删改查） */
async function ratesLoad(){
  if(!document.getElementById("ratesSel"))return;
  const r=await ratesGet(true);
  document.getElementById("ratesVer").textContent=`v${__rates.version} · ${Object.keys(__rates.versions).length} 套`;
  const sel=document.getElementById("ratesSel");
  sel.innerHTML=Object.keys(__rates.versions).map(n=>`<option ${n===(__rates.selected||r.name)?"selected":""}>${n}</option>`).join("");
  ratesPaint(r.name,r.v);}
function ratesPaint(name,v){document.getElementById("ratesPdr").value=v.pdr;
  document.getElementById("ratesRate").value=v.rate;document.getElementById("ratesPrice").value=v.unit_price||0;
  document.getElementById("ratesDnhc").value=v.dnhc||0;document.getElementById("ratesSource").value=v.source||"";}
function ratesPick(){const name=document.getElementById("ratesSel").value;
  const v=(__rates.versions||{})[name];if(v)ratesPaint(name,v);}
function ratesCollect(){const name=document.getElementById("ratesSel").value;
  const doc=structuredClone(__rates);doc.selected=name;
  doc.versions[name]={...doc.versions[name],
    pdr:+document.getElementById("ratesPdr").value,rate:+document.getElementById("ratesRate").value,
    unit_price:+document.getElementById("ratesPrice").value,dnhc:+document.getElementById("ratesDnhc").value,
    source:document.getElementById("ratesSource").value};
  return doc;}
async function ratesSave(){try{
  const r=await(await fetch(API+"/api/rates/save",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify(ratesCollect())})).json();
  if(!r.ok)throw new Error(r.msg||"保存失败");
  __rates=null;await ratesLoad();toast(`费率版本已保存（v${r.version.version}），估算时选用即记录`);
}catch(e){toast("保存失败："+e.message);}}
async function ratesAdd(){const name=prompt("新版本名称（如 CSBMK-2025）：");if(!name||!name.trim())return;
  const doc=ratesCollect();doc.versions[name.trim()]=structuredClone(doc.versions[doc.selected]||{pdr:6.96,rate:28000});
  doc.selected=name.trim();
  const r=await(await fetch(API+"/api/rates/save",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(doc)})).json();
  if(!r.ok){toast("新增失败："+r.msg);return;}__rates=null;await ratesLoad();toast("已新增版本");}
async function ratesDel(){const name=document.getElementById("ratesSel").value;
  if(Object.keys(__rates.versions).length<=1){toast("至少保留一个版本");return;}
  if(!confirm(`确定删除版本 ${name}？`))return;
  const doc=ratesCollect();delete doc.versions[name];doc.selected=Object.keys(doc.versions)[0];
  const r=await(await fetch(API+"/api/rates/save",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(doc)})).json();
  if(!r.ok){toast("删除失败："+r.msg);return;}__rates=null;await ratesLoad();toast("已删除版本");}


