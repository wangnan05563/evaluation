/* ===== M1/FR-1.1、1.8：估算历史（列表/重开/另存为/删除） ===== */
/* T01556（批次6）：历史页动态文案全量 key 化。
   驻留 DOM（列表/横幅/恢复条/diff 区/对比按钮）注册进 dyn 注册表，数据态存模块变量，
   绘制函数每次求值现取 t()/tf()，切语言 dynPaint 按新语言重算重绘。
   导出件（diff CSV/MD/JSON 正文与文件名）属交付物口径，维持中文基线（见 T01556 回传说明）。 */
let reopenCtx=null;              // {group,title,version}：重开修订上下文（生成时随请求回传服务端）
let diffSel=[], lastDiff=null;   // FR-FE05：版本对比选择（限 2）与最近一次 diff 结果
let histRowsCur=null, histRowsErr=null;  // 列表数据态 / 错误态（builder 每次重绘现取文案）
async function histOpen(){
  // FR-UI04：先铺骨架屏再取数，避免「加载中…」纯文字造成的空窗与布局跳动
  histRowsCur=null;histRowsErr=null;
  dynHtml("#histRows",histRowsHTML);
  $("#histRows").innerHTML=skeletonTable(6,4);
  goStep("history");
  try{
    const r=await fetch(API+"/api/history?limit=50",{cache:"no-store"});
    const j=await r.json();
    if(!j.ok)throw new Error(j.msg?lm(j.msg):t("history.unavail"));
    histRowsCur=j.rows||[];histRowsErr=null;
    dynPaint();
  }catch(e){
    // colspan 原为 5，与6 列表头不符（错误态会少铺一列宽），一并修正
    histRowsErr={msg:e.message};histRowsCur=null;
    dynPaint();window.lucide&&lucide.createIcons();toast(tf("history.load_fail",{msg:e.message}));}
}
function histRowsHTML(){
  const box=document.getElementById("histRows");if(!box)return "";
  if(histRowsErr)return `<tr><td colspan="6">${errorBox(histRowsErr.msg,"histOpen()")}</td></tr>`;
  if(!histRowsCur)return skeletonTable(6,4);
  const rows=histRowsCur;
  return rows.length?rows.map(h=>`<tr data-hid="${h.id}">
      <td style="text-align:center"><input type="checkbox" class="hdif" ${diffSel.includes(h.id)?'checked':''} onchange="histDiffToggle('${h.id}')"></td>
      <td>${histEsc((h.created_at||"").replace("T"," ").slice(0,19))}</td>
      <td>${histEsc(h.title)}${h.version_no>1?` <b style="color:var(--brand)">v${h.version_no}</b>`:""}</td>
      <td>${h.count!=null?h.count:"—"}</td><td>${h.us_total!=null?h.us_total:"—"}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-ghost" onclick="histReopen('${h.id}')" title="${escAttr(t("history.reopen.title"))}">${t("history.reopen")}</button>
        <button class="btn btn-ghost" onclick="histSaveAs('${h.id}')" title="${escAttr(t("history.saveas.title"))}">${t("history.save_as")}</button>
        <button class="btn btn-ghost" onclick="histDel('${h.id}')" title="${escAttr(t("history.del.title"))}">${t("history.del")}</button></td></tr>`).join("")
      :`<tr><td colspan="6">${emptyState("inbox",t("history.empty"),t("history.empty_desc"),"")}</td></tr>`;
}
function histSearch(){histOpen();}
function histClose(){goStep(items.length?"review":"upload");}
function histEsc(s){return String(s??"").replaceAll(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));}
async function histDetail(id){const r=await fetch(API+"/api/history/"+id,{cache:"no-store"});return r.json();}
async function histLoad(id){
  const j=await histDetail(id);
  if(!j.ok)throw new Error(j.msg?lm(j.msg):t("history.read_fail"));
  const row=j.row;
  items=(row.items||[]).map((it,i)=>({...it,seq:i+1,cx:it.cx||"中",ok:false}));
  return row;
}
let histBannerCur=null;   // {kind:"revise",v,at} | {kind:"saveas",title}
function histBannerHTML(){
  if(!histBannerCur)return "";
  if(histBannerCur.kind==="revise")
    return `<b>${tf("history.revise_b",{v:histBannerCur.v})}</b>${tf("history.revise_tail",{at:histEsc(histBannerCur.at)})}`;
  return `<b>${t("history.saveas_b")}</b>${tf("history.saveas_tail",{title:histEsc(histBannerCur.title)})}`;
}
async function histReopen(id){
  try{
    const row=await histLoad(id);
    reopenCtx={group:row.version_group,title:row.title,version:row.version_no};
    if(!curFile||!curFile.name)curFile={name:row.title+".docx"};
    const sel=$("#methodSel");if(row.method&&[...sel.options].some(o=>o.value===row.method))sel.value=row.method;
    render();goStep("review");
    const b=$("#reopenBanner");b.style.display="block";
    histBannerCur={kind:"revise",v:row.version_no,at:(row.created_at||"").replace("T"," ").slice(0,19)};
    dynHtml(b,histBannerHTML);
    window.lucide&&lucide.createIcons();
    toast(tf("history.reopened",{v:row.version_no,n:items.length}));
  }catch(e){toast(tf("history.reopen_fail",{msg:e.message}));}
}
async function histSaveAs(id){
  try{
    const row=await histLoad(id);
    const nt=prompt(t("history.saveas_prompt"),row.title);
    if(nt===null)return;
    const t0=String(nt).trim();
    if(!t0){toast(t("history.title_empty"));return;}
    reopenCtx=null;curFile={name:t0+".docx"};
    render();goStep("review");
    const b=$("#reopenBanner");b.style.display="block";
    histBannerCur={kind:"saveas",title:t0};
    dynHtml(b,histBannerHTML);
    toast(t("history.saved_loaded"));
  }catch(e){toast(tf("history.save_fail",{msg:e.message}));}
}
async function histDel(id){
  if(!confirm(t("history.del_confirm")))return;
  try{
    const r=await fetch(API+"/api/history/"+id,{method:"POST",headers:{"Content-Type":"application/json"}});
    const j=await r.json();
    if(!j.ok)throw new Error(t("history.del_fail_word"));
    toast(t("history.deleted"));histOpen();
  }catch(e){toast(tf("history.del_fail",{msg:e.message}));}
}
function histClearCtx(){reopenCtx=null;histBannerCur=null;const b=$("#reopenBanner");if(b)b.style.display="none";}
let histRestoreCur=null;   // {id,title,v,at}
function histRestoreHTML(){
  if(!histRestoreCur)return "";
  const c=histRestoreCur;
  return `${tf("history.detected",{title:histEsc(c.title),v:c.v,at:histEsc(c.at)})} <button class="btn btn-ghost" onclick="histReopen('${c.id}');this.parentElement.style.display='none'">${t("history.restore")}</button> <button class="btn btn-ghost" onclick="localStorage.removeItem('wl_last_history');this.parentElement.style.display='none'">${t("history.ignore")}</button>`;
}
async function histRestorePrompt(){
  /* FR-1.8 二次兜底：表单断点续录（saveFormState）已覆盖常规刷新；此处处理"清了浏览器存储/换机"场景 */
  try{
    const last=localStorage.getItem("wl_last_history");
    if(!last||items.length)return;
    const j=await histDetail(last);
    if(!j.ok)return;
    const row=j.row,bar=$("#restoreBar");
    histRestoreCur={id:last,title:row.title,v:row.version_no,at:(row.created_at||"").replace("T"," ").slice(0,19)};
    bar.style.display="block";
    dynHtml(bar,histRestoreHTML);
  }catch(e){/* 恢复提示失败不打断 */}
}

/* ===== M1/FR-FE05：版本间 diff 对比（三色高亮 + 摘要导出） ===== */
// [字段键, UI 标签字典 key]——导出件仍用中文标签（zh 字典与导出同源）
const DIFF_FIELDS=[["system","history.f.system"],["type","history.f.type"],["cx","review.th.cx"],["reuse","history.f.reuse"],["modify","history.f.modify"],["count_item","history.f.count_item"]];
const DIFF_KIND={added:"新增",removed:"删除",changed:"变更"};   // 导出与页面徽标口径一致（不直出 added/removed/changed）
const DIFF_KIND_KEYS={added:"common.mod.new",removed:"common.mod.del",changed:"history.kind_changed"};
function histDiffFName(it){return histEsc((it&&it.desc)||t("history.unnamed"));}
function histDiffBtnHTML(){  // 对比按钮：dyn 注册后 n/2 计数与文案随语言/选择重绘
  return `<i aria-hidden="true" data-lucide="git-compare" style="width:15px;height:15px"></i>${tf("history.diff_btn",{n:diffSel.length})}`;
}
function histDiffToggle(id){
  const i=diffSel.indexOf(id);
  if(i>=0)diffSel.splice(i,1);
  else{diffSel.push(id); if(diffSel.length>2)diffSel.shift();}        // 仅保留最近两个
  document.querySelectorAll(".hdif").forEach(cb=>{const hid=cb.closest("tr").dataset.hid; cb.checked=diffSel.includes(hid);});
  const btn=$("#hdifBtn"); if(btn){btn.disabled=diffSel.length!==2; dynHtml(btn,histDiffBtnHTML);}
}
function histDiffAll(checked){
  diffSel=[];
  document.querySelectorAll(".hdif").forEach(cb=>cb.checked=false);
  const btn=$("#hdifBtn"); if(btn){btn.disabled=true; dynHtml(btn,histDiffBtnHTML);}
}
async function histDiff(){
  if(diffSel.length!==2){toast(t("history.pick2"));return;}
  try{
    const url=API+`/api/history/diff?a=${diffSel[0]}&b=${diffSel[1]}`;
    const r=await fetch(url,{cache:"no-store"}); const j=await r.json();
    if(!j.ok)throw new Error(j.msg?lm(j.msg):t("history.diff_fail_word"));
    lastDiff=j; histDiffRender(j);
  }catch(e){toast(tf("history.diff_fail",{msg:e.message}));}
}
function histDiffBody(){  // 同步产出 diff 区 html（dyn 注册；lastDiff 为空返回空串）
  const d=lastDiff;if(!d)return "";
  const a=d.a,b=d.b;
  const usA=a.us_total!=null?a.us_total:"—", usB=b.us_total!=null?b.us_total:"—";
  const usDelta=(typeof a.us_total==="number"&&typeof b.us_total==="number")?(b.us_total-a.us_total):null;
  let rows="";
  const fldLabel=f=>(DIFF_FIELDS.find(x=>x[0]===f.field)||[f.field,null])[1];
  for(const c of (d.changes||[])){
    if(c.kind==="added"){
      const it=c.item||{};
      rows+=`<tr class="d-added"><td><span class="badge b-add">${t(DIFF_KIND_KEYS.added)}</span></td><td>${histDiffFName(it)}</td><td>${histEsc(it.system||"")}</td><td colspan="6">${DIFF_FIELDS.map(([k])=>histEsc(it[k]||"")).join(" / ")}</td></tr>`;
    }else if(c.kind==="removed"){
      const it=c.item||{};
      rows+=`<tr class="d-removed"><td><span class="badge b-del">${t(DIFF_KIND_KEYS.removed)}</span></td><td>${histDiffFName(it)}</td><td>${histEsc(it.system||"")}</td><td colspan="6">${DIFF_FIELDS.map(([k])=>histEsc(it[k]||"")).join(" / ")}</td></tr>`;
    }else{
      const fld=c.fields.map(f=>{const lab=fldLabel(f)?t(fldLabel(f)):f.field;return `${lab}：<b class="old">${histEsc(f.a??"")}</b> → <b class="new">${histEsc(f.b??"")}</b>`;}).join("；");
      rows+=`<tr class="d-changed"><td><span class="badge b-chg">${t(DIFF_KIND_KEYS.changed)}</span></td><td>${histDiffFName(c.b)}</td><td>${histEsc(c.system||"")}</td><td colspan="6">${fld}</td></tr>`;
    }
  }
  if(!rows)rows=`<tr><td colspan="8" style="color:var(--muted)">${t("history.none")}</td></tr>`;
  return `
    <div class="card-title"><i aria-hidden="true" data-lucide="git-compare"></i>${t("history.diff_title")}
      <span style="flex:1"></span>
      <button class="btn btn-ghost" onclick="histDiffExp('csv')"><i aria-hidden="true" data-lucide="file-spreadsheet" style="width:14px;height:14px"></i>CSV</button>
      <button class="btn btn-ghost" onclick="histDiffExp('json')"><i aria-hidden="true" data-lucide="file-json" style="width:14px;height:14px"></i>JSON</button>
      <button class="btn btn-ghost" onclick="histDiffExp('md')"><i aria-hidden="true" data-lucide="file-text" style="width:14px;height:14px"></i>Markdown</button>
      <button class="btn btn-ghost" onclick="document.getElementById('histDiff').style.display='none'"><i aria-hidden="true" data-lucide="x" style="width:14px;height:14px"></i>${t("history.collapse")}</button></div>
    <div class="diff-sum"><b>${t("history.base")}</b> v${a.version_no}「${histEsc(a.title)}」(${tf("history.items_us",{n:a.count??"—",us:usA})}) &nbsp;→&nbsp; <b>${t("history.compare_to")}</b> v${b.version_no}「${histEsc(b.title)}」(${tf("history.items_us",{n:b.count??"—",us:usB})})${usDelta!=null?` &nbsp;·&nbsp; <b>ΔUS ${usDelta>=0?"+":""}${usDelta.toFixed(2)}</b>`:""}
      &nbsp;·&nbsp; <span class="b-add">${tf("history.sum_add",{n:d.summary.added})}</span> / <span class="b-del">${tf("history.sum_del",{n:d.summary.removed})}</span> / <span class="b-chg">${tf("history.sum_chg",{n:d.summary.changed})}</span></div>
    <table><thead><tr><th>${t("history.th_kind")}</th><th>${t("history.col.fp")}</th><th>${t("history.f.system")}</th><th colspan="6">${t("history.th_detail")}</th></tr></thead><tbody>${rows}</tbody></table>`;
}
function histDiffRender(d){
  const box=$("#histDiff"); box.style.display="block";
  dynHtml(box,histDiffBody);
  window.lucide&&lucide.createIcons();
  box.scrollIntoView({behavior:"smooth",block:"nearest"});
}
function histDiffExp(fmt){
  if(!lastDiff){toast(t("history.no_diff"));return;}
  const d=lastDiff,a=d.a,b=d.b,tag=`v${a.version_no}-v${b.version_no}`;
  if(fmt==="json"){_dl(`版本对比_${tag}.json`, JSON.stringify(d,null,2), "application/json"); toast(t("history.exp_json")); return;}
  if(fmt==="md"){
    let md=`# 版本对比：v${a.version_no}「${a.title}」 → v${b.version_no}「${b.title}」\n\n- 基准：${a.count??"?"} 项 · US ${a.us_total??"—"}\n- 对比：${b.count??"?"} 项 · US ${b.us_total??"—"}\n- 新增 ${d.summary.added} · 删除 ${d.summary.removed} · 变更 ${d.summary.changed}\n\n`;
    const fldName=f=>{const e=DIFF_FIELDS.find(x=>x[0]===f.field);return e?t(e[1]):f.field;};
    const added=d.changes.filter(c=>c.kind==="added"),removed=d.changes.filter(c=>c.kind==="removed"),changed=d.changes.filter(c=>c.kind==="changed");
    if(added.length)md+="## 新增\n"+added.map(c=>`- ${c.item.desc}（${c.item.system||""}）`).join("\n")+"\n";
    if(removed.length)md+="## 删除\n"+removed.map(c=>`- ${c.item.desc}（${c.item.system||""}）`).join("\n")+"\n";
    if(changed.length)md+="## 变更\n"+changed.map(c=>`- ${c.b.desc}（${c.system||""}）：${c.fields.map(f=>`${fldName(f)}: ${f.a??""} → ${f.b??""}`).join("；")}`).join("\n")+"\n";
    _dl(`版本对比_${tag}.md`, md, "text/markdown"); toast(t("history.exp_md")); return;
  }
  const esc=v=>`"${String(v??"").replaceAll('"','""')}"`;
  const head="类型,功能点,系统,变化摘要,"+DIFF_FIELDS.map(f=>t(f[1])===f[1]?f[1]:t(f[1])).join(",");
  const rows=d.changes.map(c=>{
    const it=c.kind==="changed"?c.b:(c.item||{});
    const summary=c.kind==="changed"?c.fields.map(f=>{const m=DIFF_FIELDS.find(x=>x[0]===f.field);return `${m?t(m[1]):f.field}: ${f.a??""}→${f.b??""}`;}).join("；"):"";
    const vals=DIFF_FIELDS.map(([k])=>it[k]||"");
    return [DIFF_KIND[c.kind]||c.kind, it.desc||"", it.system||"", summary, ...vals].map(esc).join(",");
  });
  _dl(`版本对比_${tag}.csv`, "﻿"+head+"\n"+rows.join("\n")+"\n", "text/csv;charset=utf-8");
  toast(t("history.exp_csv"));
}
