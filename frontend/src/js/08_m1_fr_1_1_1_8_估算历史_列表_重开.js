/* ===== M1/FR-1.1、1.8：估算历史（列表/重开/另存为/删除） ===== */
let reopenCtx=null;              // {group,title,version}：重开修订上下文（生成时随请求回传服务端）
let diffSel=[], lastDiff=null;   // FR-FE05：版本对比选择（限 2）与最近一次 diff 结果
async function histOpen(){
  try{
    const r=await fetch(API+"/api/history?limit=50",{cache:"no-store"});
    const j=await r.json();
    if(!j.ok)throw new Error(j.msg||"历史功能不可用");
    const rows=j.rows||[];
    $("#histRows").innerHTML=rows.length?rows.map(h=>`<tr data-hid="${h.id}">
      <td style="text-align:center"><input type="checkbox" class="hdif" ${diffSel.includes(h.id)?'checked':''} onchange="histDiffToggle('${h.id}')"></td>
      <td>${histEsc((h.created_at||"").replace("T"," ").slice(0,19))}</td>
      <td>${histEsc(h.title)}${h.version_no>1?` <b style="color:var(--brand)">v${h.version_no}</b>`:""}</td>
      <td>${h.count!=null?h.count:"—"}</td><td>${h.us_total!=null?h.us_total:"—"}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-ghost" onclick="histReopen('${h.id}')" title="载入该版本到审核功能点">重开</button>
        <button class="btn btn-ghost" onclick="histSaveAs('${h.id}')" title="载入后换标题另存为新记录">另存为</button>
        <button class="btn btn-ghost" onclick="histDel('${h.id}')" title="删除该记录（不影响已下载文件）">删除</button></td></tr>`).join("")
      :'<tr><td colspan="6" style="color:var(--muted)">暂无历史估算；完成一次生成后自动记录。</td></tr>';
    goStep("history");
  }catch(e){
    $("#histRows").innerHTML=`<tr><td colspan="5">${errorBox(e.message,"histOpen()")}</td></tr>`;
    window.lucide&&lucide.createIcons();toast("历史加载失败："+e.message);}
}
function histSearch(){histOpen();}
function histClose(){goStep(items.length?"review":"upload");}
function histEsc(s){return String(s??"").replaceAll(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));}
async function histDetail(id){const r=await fetch(API+"/api/history/"+id,{cache:"no-store"});return r.json();}
async function histLoad(id){
  const j=await histDetail(id);
  if(!j.ok)throw new Error(j.msg||"读取失败");
  const row=j.row;
  items=(row.items||[]).map((it,i)=>({...it,seq:i+1,cx:it.cx||"中",ok:false}));
  return row;
}
async function histReopen(id){
  try{
    const row=await histLoad(id);
    reopenCtx={group:row.version_group,title:row.title,version:row.version_no};
    if(!curFile||!curFile.name)curFile={name:row.title+".docx"};
    const sel=$("#methodSel");if(row.method&&[...sel.options].some(o=>o.value===row.method))sel.value=row.method;
    render();goStep("review");
    const b=$("#reopenBanner");b.style.display="block";
    b.innerHTML=`<b>正在修订：第 ${row.version_no} 版</b>（基于 ${histEsc((row.created_at||"").replace("T"," ").slice(0,19))}）· 重新生成将自动记为下一版本`;
    window.lucide&&lucide.createIcons();
    toast("已载入第 "+row.version_no+" 版（"+items.length+" 条功能点），修改后可直接生成");
  }catch(e){toast("重开失败："+e.message);}
}
async function histSaveAs(id){
  try{
    const row=await histLoad(id);
    const nt=prompt("另存为的新需求标题：",row.title);
    if(nt===null)return;
    const t=String(nt).trim();
    if(!t){toast("标题不能为空");return;}
    reopenCtx=null;curFile={name:t+".docx"};
    render();goStep("review");
    const b=$("#reopenBanner");b.style.display="block";
    b.innerHTML="<b>另存为新估算</b>：标题已改为「"+histEsc(t)+"」，重新生成将建立新的版本记录";
    toast("已载入并改标题，生成后即为独立新记录");
  }catch(e){toast("另存失败："+e.message);}
}
async function histDel(id){
  if(!confirm("删除该条历史记录？（不影响已下载的成品表文件）"))return;
  try{
    const r=await fetch(API+"/api/history/"+id,{method:"POST",headers:{"Content-Type":"application/json"}});
    const j=await r.json();
    if(!j.ok)throw new Error("删除失败");
    toast("已删除");histOpen();
  }catch(e){toast("删除失败："+e.message);}
}
function histClearCtx(){reopenCtx=null;const b=$("#reopenBanner");if(b)b.style.display="none";}
async function histRestorePrompt(){
  /* FR-1.8 二次兜底：表单断点续录（saveFormState）已覆盖常规刷新；此处处理"清了浏览器存储/换机"场景 */
  try{
    const last=localStorage.getItem("wl_last_history");
    if(!last||items.length)return;
    const j=await histDetail(last);
    if(!j.ok)return;
    const row=j.row,bar=$("#restoreBar");
    bar.style.display="block";
    bar.innerHTML=`检测到上次估算「${histEsc(row.title)}」（v${row.version_no}，${histEsc((row.created_at||"").replace("T"," ").slice(0,19))}） <button class="btn btn-ghost" onclick="histReopen('${last}');this.parentElement.style.display='none'">恢复</button> <button class="btn btn-ghost" onclick="localStorage.removeItem('wl_last_history');this.parentElement.style.display='none'">忽略</button>`;
  }catch(e){/* 恢复提示失败不打断 */}
}

/* ===== M1/FR-FE05：版本间 diff 对比（三色高亮 + 摘要导出） ===== */
const DIFF_FIELDS=[["system","系统"],["type","类型"],["cx","复杂度"],["reuse","重用度"],["modify","修改类型"],["count_item","计数项"]];
const DIFF_KIND={added:"新增",removed:"删除",changed:"变更"};   // 导出与页面徽标口径一致（不直出 added/removed/changed）
function histDiffFName(it){return histEsc((it&&it.desc)||"未命名功能点");}
function histDiffToggle(id){
  const i=diffSel.indexOf(id);
  if(i>=0)diffSel.splice(i,1);
  else{diffSel.push(id); if(diffSel.length>2)diffSel.shift();}        // 仅保留最近两个
  document.querySelectorAll(".hdif").forEach(cb=>{const hid=cb.closest("tr").dataset.hid; cb.checked=diffSel.includes(hid);});
  const btn=$("#hdifBtn"); if(btn){btn.disabled=diffSel.length!==2; btn.innerHTML=`<i aria-hidden="true" data-lucide="git-compare" style="width:15px;height:15px"></i>对比所选（${diffSel.length}/2）`;}
}
function histDiffAll(checked){
  diffSel=[];
  document.querySelectorAll(".hdif").forEach(cb=>cb.checked=false);
  const btn=$("#hdifBtn"); if(btn){btn.disabled=true; btn.innerHTML=`<i aria-hidden="true" data-lucide="git-compare" style="width:15px;height:15px"></i>对比所选（0/2）`;}
}
async function histDiff(){
  if(diffSel.length!==2){toast("请先勾选两个版本进行对比");return;}
  try{
    const url=API+`/api/history/diff?a=${diffSel[0]}&b=${diffSel[1]}`;
    const r=await fetch(url,{cache:"no-store"}); const j=await r.json();
    if(!j.ok)throw new Error(j.msg||"对比失败");
    lastDiff=j; histDiffRender(j);
  }catch(e){toast("对比失败："+e.message);}
}
function histDiffRender(d){
  const box=$("#histDiff"); box.style.display="block";
  const a=d.a,b=d.b;
  const usA=a.us_total!=null?a.us_total:"—", usB=b.us_total!=null?b.us_total:"—";
  const usDelta=(typeof a.us_total==="number"&&typeof b.us_total==="number")?(b.us_total-a.us_total):null;
  let rows="";
  for(const c of (d.changes||[])){
    if(c.kind==="added"){
      const it=c.item||{};
      rows+=`<tr class="d-added"><td><span class="badge b-add">新增</span></td><td>${histDiffFName(it)}</td><td>${histEsc(it.system||"")}</td><td colspan="6">${DIFF_FIELDS.map(([k])=>histEsc(it[k]||"")).join(" / ")}</td></tr>`;
    }else if(c.kind==="removed"){
      const it=c.item||{};
      rows+=`<tr class="d-removed"><td><span class="badge b-del">删除</span></td><td>${histDiffFName(it)}</td><td>${histEsc(it.system||"")}</td><td colspan="6">${DIFF_FIELDS.map(([k])=>histEsc(it[k]||"")).join(" / ")}</td></tr>`;
    }else{
      const fld=c.fields.map(f=>{const lab=(DIFF_FIELDS.find(x=>x[0]===f.field)||[f.field])[1];return `${lab}：<b class="old">${histEsc(f.a??"")}</b> → <b class="new">${histEsc(f.b??"")}</b>`;}).join("；");
      rows+=`<tr class="d-changed"><td><span class="badge b-chg">变更</span></td><td>${histDiffFName(c.b)}</td><td>${histEsc(c.system||"")}</td><td colspan="6">${fld}</td></tr>`;
    }
  }
  if(!rows)rows=`<tr><td colspan="8" style="color:var(--muted)">两个版本功能点完全一致，无差异。</td></tr>`;
  box.innerHTML=`
    <div class="card-title"><i aria-hidden="true" data-lucide="git-compare"></i>版本对比
      <span style="flex:1"></span>
      <button class="btn btn-ghost" onclick="histDiffExp('csv')"><i aria-hidden="true" data-lucide="file-spreadsheet" style="width:14px;height:14px"></i>CSV</button>
      <button class="btn btn-ghost" onclick="histDiffExp('json')"><i aria-hidden="true" data-lucide="file-json" style="width:14px;height:14px"></i>JSON</button>
      <button class="btn btn-ghost" onclick="histDiffExp('md')"><i aria-hidden="true" data-lucide="file-text" style="width:14px;height:14px"></i>Markdown</button>
      <button class="btn btn-ghost" onclick="document.getElementById('histDiff').style.display='none'"><i aria-hidden="true" data-lucide="x" style="width:14px;height:14px"></i>收起</button></div>
    <div class="diff-sum"><b>基准</b> v${a.version_no}「${histEsc(a.title)}」(${a.count??"—"} 项 · US ${usA}) &nbsp;→&nbsp; <b>对比</b> v${b.version_no}「${histEsc(b.title)}」(${b.count??"—"} 项 · US ${usB})${usDelta!=null?` &nbsp;·&nbsp; <b>ΔUS ${usDelta>=0?"+":""}${usDelta.toFixed(2)}</b>`:""}
      &nbsp;·&nbsp; <span class="b-add">新增 ${d.summary.added}</span> / <span class="b-del">删除 ${d.summary.removed}</span> / <span class="b-chg">变更 ${d.summary.changed}</span></div>
    <table><thead><tr><th>类型</th><th>功能点</th><th>系统</th><th colspan="6">详情</th></tr></thead><tbody>${rows}</tbody></table>`;
  window.lucide&&lucide.createIcons();
  box.scrollIntoView({behavior:"smooth",block:"nearest"});
}
function histDiffExp(fmt){
  if(!lastDiff){toast("无对比数据");return;}
  const d=lastDiff,a=d.a,b=d.b,tag=`v${a.version_no}-v${b.version_no}`;
  if(fmt==="json"){_dl(`版本对比_${tag}.json`, JSON.stringify(d,null,2), "application/json"); toast("JSON 已导出"); return;}
  if(fmt==="md"){
    let md=`# 版本对比：v${a.version_no}「${a.title}」 → v${b.version_no}「${b.title}」\n\n- 基准：${a.count??"?"} 项 · US ${a.us_total??"—"}\n- 对比：${b.count??"?"} 项 · US ${b.us_total??"—"}\n- 新增 ${d.summary.added} · 删除 ${d.summary.removed} · 变更 ${d.summary.changed}\n\n`;
    const fldName=f=>(DIFF_FIELDS.find(x=>x[0]===f.field)||[f.field])[1];
    const added=d.changes.filter(c=>c.kind==="added"),removed=d.changes.filter(c=>c.kind==="removed"),changed=d.changes.filter(c=>c.kind==="changed");
    if(added.length)md+="## 新增\n"+added.map(c=>`- ${c.item.desc}（${c.item.system||""}）`).join("\n")+"\n";
    if(removed.length)md+="## 删除\n"+removed.map(c=>`- ${c.item.desc}（${c.item.system||""}）`).join("\n")+"\n";
    if(changed.length)md+="## 变更\n"+changed.map(c=>`- ${c.b.desc}（${c.system||""}）：${c.fields.map(f=>`${fldName(f)}: ${f.a??""} → ${f.b??""}`).join("；")}`).join("\n")+"\n";
    _dl(`版本对比_${tag}.md`, md, "text/markdown"); toast("Markdown 已导出"); return;
  }
  const esc=v=>`"${String(v??"").replaceAll('"','""')}"`;
  const head="类型,功能点,系统,变化摘要,"+DIFF_FIELDS.map(f=>f[1]).join(",");
  const rows=d.changes.map(c=>{
    const it=c.kind==="changed"?c.b:(c.item||{});
    const summary=c.kind==="changed"?c.fields.map(f=>{const m=DIFF_FIELDS.find(x=>x[0]===f.field);return `${m?m[1]:f.field}: ${f.a??""}→${f.b??""}`;}).join("；"):"";
    const vals=DIFF_FIELDS.map(([k])=>it[k]||"");
    return [DIFF_KIND[c.kind]||c.kind, it.desc||"", it.system||"", summary, ...vals].map(esc).join(",");
  });
  _dl(`版本对比_${tag}.csv`, "﻿"+head+"\n"+rows.join("\n")+"\n", "text/csv;charset=utf-8");
  toast("CSV 已导出");
}
