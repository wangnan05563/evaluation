/* ===== M7/FR-3.2、3.5：结果页信息架构（锚点+折叠+记忆）与可访问性辅助 ===== */
const FOLD_KEY = "wl_fold_v1";
function foldGet(){try{return JSON.parse(localStorage.getItem(FOLD_KEY)||"{}");}catch(e){return {};}}
function foldSet(o){try{localStorage.setItem(FOLD_KEY,JSON.stringify(o));}catch(e){}}
function foldApply(){  // 折叠状态记忆（默认展开，明细首次进入默认折叠以"首屏给结论"）
  const st = foldGet();
  [["detail","rGridSec"],["export","dlSec"]].forEach(([k,id])=>{
    const sec = document.getElementById(id), btn = document.getElementById("fold"+k[0].toUpperCase()+k.slice(1));
    if(!sec||!btn)return;
    const collapsed = st[k]===undefined ? (k==="detail") : !!st[k];   // 明细默认折叠
    sec.style.display = collapsed?"none":"";
    btn.setAttribute("aria-expanded", String(!collapsed));
  });
}
function foldToggle(k){
  const st = foldGet();
  const map = {detail:"rGridSec",export:"dlSec"};
  const sec = document.getElementById(map[k]);
  if(!sec)return;
  const collapsed = sec.style.display === "none";
  st[k] = !collapsed; foldSet(st); foldApply();
  if(!collapsed && window._charts && Object.keys(_charts).length) refreshCharts();
}
function rAnchor(id){  // 锚点跳转：国标造价页签外的分区先切回汇总页签
  if(id==="kpisSec"||id==="rGridSec"||id==="dlSec") gbTab("sum");
  const st = foldGet();
  if((id==="rGridSec"&&st.detail)||(id==="dlSec"&&st.export)){st[id==="rGridSec"?"detail":"export"]=false;foldSet(st);foldApply();}
  const el = document.getElementById(id);
  if(!el)return;
  window.__anchorLock = Date.now() + 1200;   // 平滑滚动期间锁定高亮，避免途经分区闪切
  el.scrollIntoView({behavior:"smooth",block:"start"});
  el.animate&&el.animate([{boxShadow:"0 0 0 2px var(--brand)"},{boxShadow:"0 0 0 0 transparent"}],{duration:900});
  document.querySelectorAll(".r-anchor").forEach(b=>b.setAttribute("aria-current", b.dataset.anchor===id?"true":"false"));
}
function rAnchorWatch(){  // 滚动高亮当前分区（节流 200ms）
  if(!("IntersectionObserver" in window))return;
  const ids = ["kpisSec","rGridSec","dlSec"];
  let last = 0;
  const io = new IntersectionObserver(entries=>{
    const now = Date.now(); if(now-last<200)return; 
last = now;
    if(window.__anchorLock && window.__anchorLock>Date.now())return;   // 锚点锁定期内不抢高亮
    entries.forEach(en=>{if(en.isIntersecting&&en.intersectionRatio>0.2){
      document.querySelectorAll(".r-anchor").forEach(b=>b.setAttribute("aria-current", b.dataset.anchor===en.target.id?"true":"false"));
    }});
  },{threshold:[0.2,0.6]});
  ids.forEach(id=>{const el=document.getElementById(id);if(el)io.observe(el);});
}
window.addEventListener("beforeprint",()=>{  // 打印/导出时全展开，保证报告完整（FR-3.2 + TH04）
  [["detail","rGridSec"],["export","dlSec"]].forEach(([k,id])=>{const s=document.getElementById(id);if(s)s.style.display="";});
});
window.addEventListener("afterprint",foldApply);
document.addEventListener("DOMContentLoaded",()=>{foldApply();rAnchorWatch();});

