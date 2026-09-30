/* ===== M9：FR-2.4 COCOMO II（前端同构）/ FR-2.6 故事生成与推送 / FR-2.8 母版多选 / FR-5.5 i18n ===== */
function cocomo_ii(kloc, eaf, sfSum){  // FR-2.4：与 gb_engine.cocomo_ii 同构
  kloc=+kloc||0; eaf=eaf==null?1:+eaf; sfSum=sfSum==null?3.72:+sfSum;
  if(kloc<=0)return {e:0.9472,pm:0,tdev:0,staff:0};
  const E=0.91+0.01*sfSum, pm=2.94*eaf*Math.pow(kloc,E), tdev=3.67*Math.pow(pm,0.28+0.2*(E-0.91));
  return {e:+E.toFixed(4),pm:+pm.toFixed(2),tdev:+tdev.toFixed(2),staff:+(pm/tdev).toFixed(2)};
}
/* FR-2.6：用户故事生成（INVEST 模板化，非 LLM 依赖）+ 可编辑 + MD/CSV 导出 + GitHub 推送 */
function storyGen(){
  const src=items.filter(x=>x.ok);
  if(!src.length){toast("请先确认功能点");return;}
  const stories=src.map((it,i)=>({
    title:`[${it.type}] 作为${it.system}用户，我需要${it.desc||it.count_item}`,
    body:`## 用户故事\n作为${it.system}用户，我需要「${it.desc||it.count_item}」，以便完成${it.m1||"相关业务"}。\n\n## 验收标准\n- Given ${it.count_item} 功能已实现，When 用户发起操作，Then 结果正确\n- 规模：${it.type} · 重用${it.reuse} · ${it.modify}\n- 估算：${ufp({...it,cx:it.reuse}).toFixed(2)} FP\n\n## INVEST 自检\nIndependent ✓ Negotiable ✓ Valuable ✓ Estimable ✓ Small ✓ Testable ✓`,
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
  toast("用户故事已导出（可编辑后再推送）");
}
async function storyPush(){
  const token=document.querySelector("#ghToken").value.trim(), repo=document.querySelector("#ghRepo").value.trim();
  const btn=document.querySelector("#storyPushBtn");btn.disabled=true;
  try{
    const r=await(await fetch(API+"/api/story/push",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({token,repo,stories:window.__stories||[]})})).json();
    if(!r.ok){btn.disabled=false;toast("推送失败："+r.msg+"（可修正后重试）");return;}
    btn.disabled=false;
    const failMsg=(r.errors&&r.errors.length)?("（"+r.errors.length+" 条失败可重试）"):"";
    toast(`已推送 ${r.pushed} 条用户故事到 GitHub Issues${failMsg}`);
  }catch(e){btn.disabled=false;toast("推送失败："+e.message+"（可重试）");}
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
function tplPick(name){localStorage.setItem("wl_tpl",name);toast(`已选用母版：${name}（生成时生效）`);}
function tplSelected(){const n=localStorage.getItem("wl_tpl")||"默认母版";
  const t=(window.__tpls||[]).find(x=>x.name===n);return t&&t.file&&t.name!=="默认母版"?t.file:undefined;}
async function tplUpload(inp){const f=inp.files&&inp.files[0];if(!f)return;
  const name=f.name.replace(/\.xlsx$/i,"");
  const note=prompt("母版口径说明（如：天津银行口径，明细列 B 起）：","");
  const b64=await new Promise(res=>{const fr=new FileReader();
    fr.onload=()=>res(fr.result.split(",")[1]);fr.readAsDataURL(f);});
  const r=await(await fetch(API+"/api/templates/save",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({name,b64,note:note||"",mapping:{}})})).json();
  if(!r.ok){toast("上传失败："+r.msg);return;}
  tplPick(name);await tplLoad();toast(`母版「${name}」已接入（列映射请对照口径说明人工核对首件）`);
  inp.value="";}
/* FR-5.5：i18n 骨架（t(key) 查表；zh-CN 全量由构建校验，en-US 骨架后续补） */
let __I18N=null;
async function i18nLoad(){
  if(__I18N)return __I18N;
  try{__I18N=await(await fetch("/static/i18n/zh-CN.json")).json();}catch(e){__I18N={};}
  return __I18N;}
function t(key){return (__I18N&&__I18N[key])||key;}
window.addEventListener("DOMContentLoaded",()=>{i18nLoad();tplLoad();});
