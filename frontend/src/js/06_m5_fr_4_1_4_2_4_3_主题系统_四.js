/* ===== M5/FR-4.1、4.2、4.3：主题系统（四态开关 + 主色定制） ===== */
/* T01556（批次6）：预置色名加第三元 i18n key（brandPaint 绘制期取 t(key)，
   字典未就绪时回退第二元中文，启动引导序列会二次 brandPaint 刷新） */
const BRAND_PRESETS=[["#2563EB","品牌蓝","theme.brand.blue"],["#0EA5E9","青碧","theme.brand.cyan"],["#059669","翠绿","theme.brand.green"],["#D97706","琥珀","theme.brand.amber"],["#DB2777","玫红","theme.brand.pink"],["#475569","石墨","theme.brand.slate"]];
function hexHSL(hex){const n=Number.parseInt(hex.slice(1),16),r=(n>>16&255)/255,g=(n>>8&255)/255,b=(n&255)/255;
  const mx=Math.max(r,g,b),mn=Math.min(r,g,b);let h=0,s=0,l=(mx+mn)/2;
  if(mx!==mn){const d=mx-mn;s=l>.5?d/(2-mx-mn):d/(mx+mn);
    h=mx===r?(g-b)/d+(g<b?6:0):mx===g?(b-r)/d+2:(r-g)/d+4;h*=60;}
  return [h,s*100,l*100];}
function hslHex(h,s,l){s/=100;l/=100;const k=n=>(n+h/30)%12,a=s*Math.min(l,1-l);
  const f=n=>l-a*Math.max(-1,Math.min(k(n)-3,Math.min(9-k(n),1)));
  const to=x=>Math.round(255*x).toString(16).padStart(2,'0');
  return '#'+to(f(0))+to(f(8))+to(f(4));}
function applyBrand(hex){  // FR-4.2：主色定制（ink/soft 由 HSL 派生），一处生效
  if(!/^#[0-9a-fA-F]{6}$/.test(hex)){toast(t("theme.brand_bad_color"));return false;}
  const [h,s,l]=hexHSL(hex);
  const rs=document.documentElement.style;
  rs.setProperty('--brand',hex);
  rs.setProperty('--brand-ink',hslHex(h,s,Math.max(20,l-14)));
  rs.setProperty('--brand-soft',hslHex(h,Math.min(100,s),l>=50?l+38:l+14));
  return true;}
function applyTheme(){  // FR-4.1/4.3：四态开关 + 跟随系统
  const mode=localStorage.getItem('wl_theme_mode')||'light';
  const dark=matchMedia('(prefers-color-scheme: dark)');
  const eff=mode==='system'?(dark.matches?'dark':'light'):mode;
  if(eff==='dark'||eff==='contrast')document.documentElement.dataset.theme=eff;
  else delete document.documentElement.dataset.theme;
  localStorage.setItem('wl_theme_eff',eff);
  if(window._charts&&Object.keys(_charts).length)refreshCharts();   // 图表随主题重建配色
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{   // FR-4.3 实时响应
  if((localStorage.getItem('wl_theme_mode')||'light')==='system')applyTheme();});
applyTheme();
applyTheme.brand=function(hex){if(applyBrand(hex)){localStorage.setItem('wl_brand',hex);refreshCharts&&window._charts&&Object.keys(_charts).length&&refreshCharts();}};
(function(){const b=localStorage.getItem('wl_brand');if(b)applyBrand(b);})();

