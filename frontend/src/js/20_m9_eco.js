/* ===== M9：FR-2.4 COCOMO II（前端同构）/ FR-2.6 故事生成与推送 / FR-2.8 母版多选 / FR-5.5 i18n ===== */
function cocomo_ii(kloc, eaf, sfSum){  // FR-2.4：与 gb_engine.cocomo_ii 同构
  kloc=+kloc||0; eaf=eaf==null?1:+eaf; sfSum=sfSum==null?3.72:+sfSum;
  if(kloc<=0)return {e:0.9472,pm:0,tdev:0,staff:0};
  const E=0.91+0.01*sfSum, pm=2.94*eaf*Math.pow(kloc,E), tdev=3.67*Math.pow(pm,0.28+0.2*(E-0.91));
  return {e:+E.toFixed(4),pm:+pm.toFixed(2),tdev:+tdev.toFixed(2),staff:+(pm/tdev).toFixed(2)};
}
/* FR-2.6：用户故事生成（INVEST 模板化，非 LLM 依赖）+ 可编辑 + MD/CSV 导出 + GitHub 推送 */
/* T01556（批次6）：故事「模板骨架」随界面语言生成（数据字段 system/desc 等保持原文）；
   默认中文态产物与此前逐字一致，英文态由字典承接（产品决策落地）。 */
function storyGen(){
  const src=items.filter(x=>x.ok);
  if(!src.length){toast(t("eco.story_need_ok"));return;}
  const stories=src.map((it,i)=>({
    title:tf("eco.story_title",{type:it.type,sys:it.system,need:it.desc||it.count_item}),
    body:tf("eco.story_body",{sys:it.system,need:it.desc||it.count_item,m1:it.m1||t("eco.story_biz_default"),ci:it.count_item,type:it.type,
      reuse:t("common.lv."+LV[it.reuse]),modify:t("common.mod."+LV[it.modify]),fp:ufp({...it,cx:it.reuse}).toFixed(2)}),
    fp:ufp({...it,cx:it.reuse}).toFixed(2)
  }));
  window.__stories=stories;
  const box=document.getElementById("storyBox");
  box.style.display="block";
  box.querySelector("textarea").value=stories.map(s=>`### ${s.title}\n${s.body}\n`).join("\n");
  window.lucide&&lucide.createIcons();
}
function storyDl(kind){
  const txt=document.querySelector("#storyBox textarea").value;
  const b=new Blob([txt],{type:"text/plain;charset=utf-8"});
  const a=document.createElement("a");a.href=URL.createObjectURL(b);
  a.download=baseName()+(kind==="csv"?"-stories.csv":"-stories.md");a.click();URL.revokeObjectURL(a.href);
  toast(t("eco.story_exported"));
}
async function storyPush(){
  const token=document.querySelector("#ghToken").value.trim(), repo=document.querySelector("#ghRepo").value.trim();
  const btn=document.querySelector("#storyPushBtn");btn.disabled=true;
  try{
    const r=await(await fetch(API+"/api/story/push",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({token,repo,stories:window.__stories||[]})})).json();
    if(!r.ok){btn.disabled=false;toast(tf("eco.push_fail",{msg:lm(r)}));return;}
    btn.disabled=false;
    const failMsg=(r.errors&&r.errors.length)?tf("eco.push_partial",{n:r.errors.length}):"";
    toast(tf("eco.pushed",{n:r.pushed})+failMsg);
  }catch(e){btn.disabled=false;toast(tf("eco.push_retry_fail",{msg:e.message}));}
}
/* FR-2.8：母版多选（结果页选择 + 配置中心上传） */
async function tplLoad(){
  try{
    const r=await(await fetch(API+"/api/templates")).json();
    window.__tpls=r.templates||[];
    const sel=document.getElementById("tplSel");
    if(sel){const cur=localStorage.getItem("wl_tpl")||"默认母版";
      sel.innerHTML=__tpls.map(t=>`<option value="${t.name}" ${t.name===cur?"selected":""}>${t.name}</option>`).join("");}

  }catch(e){/* 母版列表加载失败不阻塞 */}
}
function tplPick(name){localStorage.setItem("wl_tpl",name);toast(tf("eco.tpl_picked",{name}));}
function tplSelected(){const n=localStorage.getItem("wl_tpl")||"默认母版";
  const t=(window.__tpls||[]).find(x=>x.name===n);return t&&t.file&&t.name!=="默认母版"?t.file:undefined;}
async function tplUpload(inp){const f=inp.files&&inp.files[0];if(!f)return;
  const name=f.name.replace(/\.xlsx$/i,"");
  const note=prompt(t("eco.tpl_note_prompt"),"");
  const b64=await new Promise(res=>{const fr=new FileReader();
    fr.onload=()=>res(fr.result.split(",")[1]);fr.readAsDataURL(f);});
  const r=await(await fetch(API+"/api/templates/save",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({name,b64,note:note||"",mapping:{}})})).json();
  if(!r.ok){toast(tf("eco.upload_fail",{msg:lm(r)}));return;}
  tplPick(name);await tplLoad();toast(tf("eco.tpl_uploaded",{name}));
  inp.value="";}
/* FR-5.5：界面多语言。字典经 /api/i18n?lang= 读取（不走 /static/ ——该路由
   白名单只放行 .js/.css 且禁子路径，放行 .json 会扩大目录穿越面）。
   t(key) 缺译文时回退显示 key 本身（key 即中文原文），故未配置语言也不会白屏。 */
const I18N_DEFAULT = "zh-CN";
let __I18N = null;          // 当前语言字典 {key: 文案}
let __I18N_LANG = "";
async function i18nLoad(lang){
  lang = lang || localStorage.getItem("wl_lang") || I18N_DEFAULT;
  if(__I18N && __I18N_LANG === lang) return __I18N;
  try{
    const r = await(await fetch(API + "/api/i18n?lang=" + encodeURIComponent(lang), {cache:"no-store"})).json();
    __I18N = (r && r.ok && r.strings) ? r.strings : {};
  }catch(e){ __I18N = {}; }   // 字典服务不可用：回退显示 key，不阻塞页面
  __I18N_LANG = lang;
  return __I18N;
}
function t(key){ return (__I18N && __I18N[key]) || key; }
/** T01556（批次6）：带中文兜底的取值——供外置脚本（guide.js 等）在「字典未就绪/缺键」时
 *  回退原文而不露 key。函数声明在拼接后的单一 <script> 顶层，天然挂到 window 供外部分享。 */
function tl(key, fallback){ return (__I18N && __I18N[key]) || fallback; }
/** 带插值的取文案：tf("review.count", {n: 5}) → "5 条候选" / "5 candidates"。
 *  用于「数值由 JS 运行时填充」的场景——这类文案不能靠 applyI18n 写 textContent
 * （会覆盖 JS 刚写入的数字），也不宜把变量塞进字典。
 * 字典里用 {name} 占位；缺译文时回落为 key 本身（不做插值，避免露出 {n}）。 */
function tf(key, vars){
  const s = t(key);
  if(s === key) return s;          // 未命中：直接返回 key，不插值
  return s.replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null) ? vars[k] : m);
}
/** 切换语言：落盘 → 重载字典 → 重刷 data-i18n 标注的节点 */
async function setLang(lang){
  if(!lang || lang === __I18N_LANG) return;
  localStorage.setItem("wl_lang", lang);
  await i18nLoad(lang);
  applyI18n();
  document.documentElement.lang = lang;
  if(typeof langSegPaint === "function") langSegPaint();
  // T01556：品牌色预置名（title 属性）随语言重绘
  if(typeof brandPaint === "function") brandPaint();
  // 动态生成的文案（计数、空态、徽章、图表标题）不在 data-i18n 标注范围内——
  // applyI18n 只处理静态节点，这些由渲染函数产出。故切换语言后必须重渲染，
  // 否则会停留在旧语言：实测「2 条候选」在英文界面下仍显示中文。
  // 逐个 typeof 守卫：本函数在 01_core 之后定义，调用方页面可能尚未加载对应模块。
  if(typeof render === "function" && Array.isArray(items)) render();
  if(typeof refreshCharts === "function" && Object.keys(_charts || {}).length) refreshCharts();
  if(typeof rulesLoad === "function" && document.body.dataset.page === "config") rulesLoad();
  // PERT 页的计数/汇总同理，需重算才能反映新语言
  if(typeof pertSyncStart === "function" && document.body.dataset.page === "pert") pertSyncStart();
  // T01556：PERT 阶段下拉的标签按新语言重建（数据值不变）
  if(typeof pertFillPhase === "function" && document.body.dataset.page === "pert") pertFillPhase();
  // T01555（批次5）：PERT 估算明细行的 title/待填徽标按新语言重绘
  if(typeof renderPert === "function" && document.body.dataset.page === "pert" && Array.isArray(pertItems) && pertItems.length) renderPert();
  // T01555：驻留 DOM 的动态文案（进度条/状态框/文件提示…）按注册的状态函数重算重绘
  if(typeof dynPaint === "function") dynPaint();
  // 帮助页更新区的动态状态（检测中/发现新版本/下载进度…）按保存的状态重绘（T01548 批次4a）
  if(typeof verPaint === "function") verPaint();
  // T01556：外置引导脚本若正在演示，按新语言重绘当前卡片
  if(window.WLGuide && window.WLGuide.refresh) window.WLGuide.refresh();
  toast(t("common.lang_switched"));
}
/* data-i18n 机制：把文案与结构解耦，避免为每种语言复制一份 DOM。
   - <span data-i18n="key">替换文本内容
   - <span data-i18n="text=key">    同上（显式形态）
   - <div  data-i18n="title=key">   只替换 title 属性，不动子节点
   - <div  data-i18n="title=key|text=key">  两者都换
   - <input data-i18n-ph="key">     替换 placeholder

   两条硬约束（均由S12 实测暴露后加固）：
   1) 带 attr= 形态的节点常含子元素（图标、嵌套 span）。若把裸 key 当文本替换，
      textContent 赋值会摧毁这些子节点——故裸 key 只在「无子元素」时才写文本，
      有子元素则跳过并 console.warn 提示改用 attr= 形态。
   2) key 是语义化的英文标识（如 app.title），t() 的回退值就是key 本身。
      若缺译文时写入 key，用户会直接看到 "app.title" 这类内部标识——
      故缺译文时**一律不动 DOM**，保留服务端渲染的中文原文。
      只有 applyI18n 才改 DOM，且必须 t(key) 命中才改。 */
function applyI18n(root){
  const scope = root || document;
  scope.querySelectorAll("[data-i18n]").forEach(el => {
    const spec = el.getAttribute("data-i18n") || "";
    // 先确认该 key 在当前字典里有译文，再决定是否动 DOM（属性/文本统一口径）
    const parts = spec.split("|").map(p => (p.includes("=") ? p.split("=") : [null, p]));
    if (parts.some(([, k]) => k && k.trim() && !__I18N?.[k.trim()])) return;   // 缺译文：原样保留
    parts.forEach(([attr, key]) => {
      if(!key) return;
      const v = t(key.trim());
      if(!v) return;
      if(attr === null){
        if(el.children.length === 0){ el.textContent = v; }
        else { console.warn("[i18n] 跳过含子元素的裸 key（会摧毁 DOM），请改用 attr= 形态:", key.trim()); }
      }else{
        el.setAttribute(attr.trim(), v);
      }
    });
  });
  scope.querySelectorAll("[data-i18n-ph]").forEach(el => {
    const key = el.getAttribute("data-i18n-ph");
    if(!__I18N?.[key]) return;              // 缺译文：保留原 placeholder
    el.setAttribute("placeholder", t(key));
  });
}
window.addEventListener("DOMContentLoaded",async ()=>{
  await i18nLoad();          // 字典就绪后再刷文案，避免首屏闪中文
  applyI18n();
  tplLoad();
  if(typeof brandPaint==="function") brandPaint();   // 预置色名按新字典重绘（首绘在字典前，见 07）
  // T01556（批次6）：断点续录恢复必须在字典就绪后执行（见 07 bootRestoreChain 注释），
  // 否则恢复出来的表格/toast 会把 i18n key 当文案露在首屏。
  if(typeof bootRestoreChain==="function") bootRestoreChain();
  else{try{saveFormState();}catch(e){}}
});
