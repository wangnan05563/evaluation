/* ===== M1/FR-1.1、1.8：估算历史（列表/重开/另存为/删除） ===== */
let reopenCtx=null;              // {group,title,version}：重开修订上下文（生成时随请求回传服务端）
async function histOpen(){
  try{
    const r=await fetch(API+"/api/history?limit=50",{cache:"no-store"});
    const j=await r.json();
    if(!j.ok)throw new Error(j.msg||"历史功能不可用");
    const rows=j.rows||[];
    $("#histRows").innerHTML=rows.length?rows.map(h=>`<tr>
      <td>${histEsc((h.created_at||"").replace("T"," ").slice(0,19))}</td>
      <td>${histEsc(h.title)}${h.version_no>1?` <b style="color:var(--brand)">v${h.version_no}</b>`:""}</td>
      <td>${h.count!=null?h.count:"—"}</td><td>${h.us_total!=null?h.us_total:"—"}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-ghost" onclick="histReopen('${h.id}')" title="载入该版本到审核功能点">重开</button>
        <button class="btn btn-ghost" onclick="histSaveAs('${h.id}')" title="载入后换标题另存为新记录">另存为</button>
        <button class="btn btn-ghost" onclick="histDel('${h.id}')" title="删除该记录（不影响已下载文件）">删除</button></td></tr>`).join("")
      :'<tr><td colspan="5" style="color:var(--muted)">暂无历史估算；完成一次生成后自动记录。</td></tr>';
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
