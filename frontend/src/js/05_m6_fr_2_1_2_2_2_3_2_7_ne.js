/* ===== M6/FR-2.1、2.2、2.3、2.7：NESMA 快算 + GB/T 36964 国标造价 ===== */
/* T01556（批次6）：本模块动态文案全量 key 化。
   - 数据域中文值（GB_CF 阶段键、swf/rdf 领域名、费率版本名、system 名）保持原值进属性/参数，
     仅显示文本走 t()/tf()；未知数据值原样显示。
   - 驻留 DOM（快算结果/造价因子/输出区）注册进 dyn 注册表，切语言 dynPaint 同步重绘
     （绘制函数依赖 __rates 缓存，加载后恒可用）。 */
const NESMA_PRE={ILF:35,EIF:15},NESMA_EST={ILF:7,EIF:5,EI:4,EO:5,EQ:4};
const GB_CF={预算:1.7,立项:1.45,招标:1.25,需求:1.1,设计:1};
// 阶段显示名 → 字典 key（值为数据，标签才翻译）
const GB_STAGE_KEYS={预算:"gb.stage.budget",立项:"gb.stage.kickoff",招标:"gb.stage.tender",需求:"gb.stage.req",设计:"gb.stage.design"};
const gbStageLabel=s=>GB_STAGE_KEYS[s]?t(GB_STAGE_KEYS[s]):s;
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
  box.innerHTML=keys.map(k=>`<label style="font-size:12px;color:var(--muted)">${tf("ne.count_label",{k})}<input data-k="${k}" type="number" min="0" value="${prev[k]||0}" style="width:100%;margin-top:4px"></label>`).join("");
  box.querySelectorAll("input").forEach(i=>i.addEventListener("input",fastCalc));
  document.getElementById("fastFormula").textContent=fastModeV==="pre"?t("ne.formula.pre"):t("ne.formula.est");
  document.querySelectorAll("#fastMode .btn").forEach(b=>{const on=b.dataset.m===fastModeV;
    b.style.borderColor=on?"var(--brand)":"var(--line)";b.style.color=on?"var(--brand)":"var(--ink-2)";});
  // 结果区驻留 DOM：注册 dyn 后切语言即按新语言重算重绘
  dynHtml("#fastResult",fastResultHTML);
  fastCalc();}
function fastCurCounts(){
  const box=document.getElementById("fastCounts");const counts={};
  if(!box)return counts;
  box.querySelectorAll("input").forEach(i=>{if(+i.value>0)counts[i.dataset.k]=+i.value;});
  return counts;}
function fastResultHTML(){  // 同步绘制：费率走 __rates 缓存（fastCalc 已先行加载）
  if(!__rates)return t("ne.input_hint");
  const counts=fastCurCounts();
  const table=fastModeV==="pre"?NESMA_PRE:NESMA_EST;
  const ufp=Object.entries(counts).reduce((acc,[k,v])=>acc+(table[k]||0)*v,0);
  const r=ratesCur();
  const S=ufp*GB_CF["需求"], ae=r.pdr*S, fee=Math.round(ae/174*r.rate+r.dnhc);
  window.__fastUfp=ufp;
  const method=fastModeV==="pre"?t("ne.mode.pre"):t("ne.mode.est");
  const locPerFp= +(localStorage.getItem("wl_loc_fp")||46);   // FR-1.9：语言换算系数（可配）
  const cc=cocomo_ii(ufp*locPerFp/1000);
  const pertRef=Math.round(r.pdr*ufp*GB_CF["需求"]/174*30);   // FR-1.9：UFP→PERT 三点参考（中值，±20% 带宽）
  return tf("ne.res_ufp",{ufp,method})+"<br>"+
    tf("ne.res_s",{S,stage:gbStageLabel("需求"),cf:GB_CF["需求"]})+"<br>"+
    tf("ne.res_ae",{ae,pm:(ae/174).toFixed(2)})+"<br>"+
    tf("ne.res_fee",{fee,ver:r.name})+"<br>"+
    `<small>${tf("ne.res_src",{src:r.source})}</small>`+
    `<br><small>${tf("ne.res_cocomo",{kloc:(ufp*locPerFp/1000).toFixed(1),loc:locPerFp,pm:cc.pm,tdev:cc.tdev})}</small>`+
    `<br><small>${tf("ne.res_pert",{o:Math.round(pertRef*0.8),m:pertRef,p:Math.round(pertRef*1.2)})}</small>`;}
function ratesCur(){  // 同步版 ratesGet（依赖 __rates 缓存；dyn 绘制函数不可异步）
  const name=__rates.selected||Object.keys(__rates.versions||{})[0];
  const v=(__rates.versions||{})[name]||{};
  return {name,v,pdr:+v.pdr||6.96,rate:+v.rate||28000,dnhc:+v.dnhc||0,source:v.source||"CSBMK 基准",swf:v.swf||{},rdf:v.rdf||{}};}
async function fastCalc(){
  if(!__rates)await ratesGet();
  const el=document.getElementById("fastResult");
  if(el){const v=fastResultHTML();if(v!=null)el.innerHTML=v;}   // 即时重算（dyn 注册负责后续语言切换）
}
function fastToGb(){  // FE01→FE02 串联：快算结果带入国标造价
  if(items.length){goStep("result");gbTab("gb");gbRender();}
  else{gbUfpSrc={kind:"fast",v:window.__fastUfp||0};toast(t("ne.togb_toast"));}}
/* FR-2.2/2.7：国标造价页签 */
function gbTab(which){
  const vr=document.querySelector("#v-result");
  [...vr.children].forEach(el=>{if(!el.classList.contains("r-tabs")&&el.id!=="gbCard")el.style.display=which==="sum"?"":"none";});
  document.getElementById("gbCard").style.display=which==="gb"?"block":"none";
  document.getElementById("tabSum").style.fontWeight=which==="sum"?"700":"500";
  document.getElementById("tabGb").style.fontWeight=which==="gb"?"700":"500";
  if(which==="gb")gbRender();}
function gbFactorsHTML(){  // 因子表单（同步绘制；dyn 注册后可随语言重绘）
  const r=ratesCur();
  if(!gbState)gbState={stage:"招标",domain:"金融",app:"后台核心",lang:"Java",team:"一般",gsc:1,custom:{}};
  const domains=Object.keys(r.swf),langs=Object.keys(r.rdf);
  const apps=Object.keys(r.swf[gbState.domain]||{"后台核心":1});
  const teams=Object.keys(r.rdf[gbState.lang]||{"一般":1});
  const ufp=gSummary?gSummary.ufp:(gbUfpSrc?gbUfpSrc.v:0);
  const ufTag=gSummary?t("gb.src_detail"):(gbUfpSrc?t("gb.src_fast"):t("gb.src_manual"));
  const opt=(o,val)=>"<option"+(o===val?" selected":"")+">"+o+"</option>";
  const stageOpt=o=>"<option"+(o===gbState.stage?" selected":"")+">"+gbStageLabel(o)+"</option>";
  const sel=(id,opts,val)=>`<select id="${id}" onchange="gbChange()">${opts.map(o=>opt(o,val)).join("")}</select>`;
  const num=(id,val)=>`<input id="${id}" type="number" step="0.01" value="${val}" style="width:100%" onchange="gbChange()">`;
  const ck=(k,base)=>`<input type="checkbox" id="gb${k[0].toUpperCase()+k.slice(1)}Ck" ${gbState.custom[k]!==undefined?"checked":""} onchange="gbToggle('${k}')">${t("gb.custom",{base})}`;
  const lb=(key,inner)=>`<label style="font-size:12px;color:var(--muted)">${key}${inner}</label>`;
  return lb(tf("gb.ufp_src",{tag:ufTag}),`<input id="gbUfpIn" type="number" value="${ufp}" style="width:100%;margin-top:4px" onchange="gbChange()">`)+
    lb(t("gb.stage"),`<select id="gbStage" onchange="gbChange()">${Object.keys(GB_CF).map(stageOpt).join("")}</select>`)+
    lb(t("gb.gsc"),(gbState.custom.gsc!==undefined?num("gbGsc",gbState.custom.gsc):sel("gbGscSel",["1.0"],String(gbState.gsc)))+ck("gsc","1.0"))+
    lb(t("gb.domain"),sel("gbDomain",domains,gbState.domain))+
    lb(t("gb.app"),sel("gbApp",apps,gbState.app))+
    lb(tf("gb.swf",{swf:(+gbEvalSwf(r)).toFixed(2)}),(gbState.custom.swf!==undefined?num("gbSwf",gbState.custom.swf):"")+ck("swf",""+(+gbEvalSwf(r)).toFixed(2)))+
    lb(t("gb.lang"),sel("gbLang",langs,gbState.lang))+
    lb(t("gb.team"),sel("gbTeam",teams,gbState.team))+
    lb(tf("gb.rdf",{rdf:(+gbEvalRdf(r)).toFixed(2)}),(gbState.custom.rdf!==undefined?num("gbRdf",gbState.custom.rdf):"")+ck("rdf",""+(+gbEvalRdf(r)).toFixed(2)))+
    lb(tf("gb.pdr",{ver:r.name}),(gbState.custom.pdr!==undefined?num("gbPdr",gbState.custom.pdr):"")+ck("pdr",r.pdr))+
    lb(tf("gb.rate",{ver:r.name}),(gbState.custom.rate!==undefined?num("gbRate",gbState.custom.rate):"")+ck("rate",r.rate))+
    lb(t("gb.dnhc"),num("gbDnhc",gbState.custom.dnhc!==undefined?gbState.custom.dnhc:0));}
async function gbRender(){
  const r=await ratesGet(true);
  dynHtml("#gbRatesVer",()=>t("gb.ver_label")+`<select id="gbVerSel" style="max-width:130px;font-size:12px" onchange="gbVerChange()">${Object.keys(__rates.versions||{}).map(n=>"<option"+(n===(__rates.selected||"")?" selected":"")+">"+n+"</option>").join("")}</select>`);
  const oldSel=document.getElementById("gbVerSel");if(oldSel&&oldSel.value!==r.name){oldSel.value=r.name;}
  dynHtml("#gbFactors",gbFactorsHTML);
  dynHtml("#gbOut",gbOutHTML);
  gbCalc(ratesCur());}
function gbVerSelSet(name){const sel=document.getElementById("gbVerSel");
  if(!sel){const _r=gbRender;gbRender=async()=>{await _r();const s2=document.getElementById("gbVerSel");if(s2){s2.value=name;s2.dispatchEvent(new Event('change'));}gbRender=_r;};gbRender();return;}
  sel.value=name;sel.dispatchEvent(new Event('change'));}
async function gbVerChange(){  // FR-2.3：结果页切换基准版本（服务端持久化 selected，估算记录在结果中）
  const doc=structuredClone(__rates);doc.selected=document.getElementById("gbVerSel").value;
  const r=await(await fetch(API+"/api/rates/save",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(doc)})).json();
  if(!r.ok){toast(t("gb.ver_fail")+"："+lm(r.msg));return;}
  __rates=null;gbState=null;gbRender();toast(tf("gb.ver_selected",{name:document.getElementById("gbVerSel").value,v:r.version.version}));}
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
function gbVals(r){  // 生效值（自定义优先）——gbOutHTML/gbCalc 共用，口径一致
  const g=id=>{const el=document.getElementById(id);return el?(+el.value||0):0;};
  const ufp= +(document.getElementById("gbUfpIn")?.value||0);
  const cf=GB_CF[gbState.stage]||1;
  const gsc=gbState.custom.gsc!==undefined?+gbState.custom.gsc:gbState.gsc;
  const swf=gbState.custom.swf!==undefined?+gbState.custom.swf:gbEvalSwf(r);
  const rdf=gbState.custom.rdf!==undefined?+gbState.custom.rdf:gbEvalRdf(r);
  const pdr=gbState.custom.pdr!==undefined?+gbState.custom.pdr:r.pdr;
  const rate=gbState.custom.rate!==undefined?+gbState.custom.rate:r.rate;
  const dnhc= +(document.getElementById("gbDnhc")?.value||0);
  const S=ufp*gsc*cf, ae=pdr*S*swf*rdf, fee=Math.round(ae/174*rate+dnhc);
  return {ufp,cf,gsc,swf,rdf,pdr,rate,dnhc,S,ae,fee,g};}
function gbOutHTML(){  // 同步输出区（dyn 注册用）
  if(!__rates||!gbState)return "";
  const r=ratesCur(),o=gbVals(r);
  const tag=k=>gbState.custom[k]!==undefined?' <span class="mark" style="padding:1px 6px">'+t("result.gb.manual_adjust")+'</span>':"";
  gbState.out={ufp:o.ufp,stage:gbState.stage,cf:o.cf,gsc:o.gsc,swf:o.swf,rdf:o.rdf,pdr:o.pdr,rate:o.rate,dnhc:o.dnhc,S:o.S,ae:o.ae,fee:o.fee};
  return tf("gb.out_s",{ufp:o.ufp,gsc:o.gsc+tag("gsc"),stage:gbStageLabel(gbState.stage),cf:o.cf,S:o.S})+"<br>"+
    tf("gb.out_ae",{pdr:o.pdr+tag("pdr"),swf:o.swf+tag("swf"),rdf:o.rdf+tag("rdf"),ae:o.ae,pm:(o.ae/174).toFixed(2)})+"<br>"+
    tf("gb.out_fee",{rate:o.rate+tag("rate"),dnhc:o.dnhc,fee:o.fee,w:(o.fee/10000).toFixed(2)})+"<br>"+
    `<small>${tf("gb.out_note",{stage:gbStageLabel(gbState.stage),cf:o.cf,src:r.source})}</small>`;}
function gbCalc(r){  // 实时联动：S/AE/费用 + 出处 + 人工调整标注
  const el=document.getElementById("gbOut");if(!el)return;
  const v=gbOutHTML();if(v!=null)el.innerHTML=v;}
/* FR-2.3：费率与基准卡片（多版本增删改查） */
async function ratesLoad(){
  if(!document.getElementById("ratesSel"))return;
  const r=await ratesGet(true);
  document.getElementById("ratesVer").textContent=tf("rates.ver_count",{v:__rates.version,n:Object.keys(__rates.versions).length});
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
  if(!r.ok)throw new Error(r.msg?lm(r.msg):t("common.save_fail"));
  __rates=null;await ratesLoad();toast(tf("rates.saved",{v:r.version.version}));
}catch(e){toast(tf("common.save_failed",{msg:e.message}));}}
async function ratesAdd(){const name=prompt(t("rates.prompt_add"));if(!name||!name.trim())return;
  const doc=ratesCollect();doc.versions[name.trim()]=structuredClone(doc.versions[doc.selected]||{pdr:6.96,rate:28000});
  doc.selected=name.trim();
  const r=await(await fetch(API+"/api/rates/save",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(doc)})).json();
  if(!r.ok){toast(t("rates.add_fail")+"："+lm(r.msg));return;}__rates=null;await ratesLoad();toast(t("rates.added"));}
async function ratesDel(){const name=document.getElementById("ratesSel").value;
  if(Object.keys(__rates.versions).length<=1){toast(t("rates.del_last"));return;}
  if(!confirm(tf("rates.del_confirm",{name})))return;
  const doc=ratesCollect();delete doc.versions[name];doc.selected=Object.keys(doc.versions)[0];
  const r=await(await fetch(API+"/api/rates/save",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(doc)})).json();
  if(!r.ok){toast(t("rates.del_fail")+"："+lm(r.msg));return;}__rates=null;await ratesLoad();toast(t("rates.deleted"));}
