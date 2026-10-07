/** FR-5.5 界面多语言验证（字典路由 + data-i18n 机制 + 语言切换 + 降级）
 *  由编排器起隔离实例（8032）+ 无头 Chrome（CDP 9334）后运行。
 *  覆盖：/api/i18n 路由可用、lang 白名单收敛（防目录穿越反射）、字典 key 对齐、
 *  data-i18n 文本/属性双向替换、缺译文不抠空界面、切换语言即时生效并记忆、
 *  未标注文案保持中文（分批迁移的渐进式现状，不误报为缺陷）。 */
import path from 'node:path';
const CDP = 'http://127.0.0.1:9334', APP = 'http://127.0.0.1:8032/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const res = [];
const check = (n, ok, d = '') => { res.push({ n, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
setTimeout(() => { console.error('[bk] WATCHDOG'); process.exit(3); }, 420000);
const getJson = async p => (await fetch(APP.replace(/\/$/, '') + p)).json();

// ---- CDP ----
const t = await (await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket((await (await fetch(`${CDP}/json/version`)).json()).webSocketDebuggerUrl);
await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
let id = 0; const pend = new Map(); const errors = [];
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.no(new Error(JSON.stringify(m.error))) : p.ok(m.result); } else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params?.exceptionDetails?.exception?.description || 'exc'); };
const send = (m, p, s) => { const i = ++id; ws.send(JSON.stringify({ id: i, method: m, params: p, ...(s ? { sessionId: s } : {}) })); return new Promise((ok, no) => { pend.set(i, { ok, no }); setTimeout(() => { if (pend.has(i)) { pend.delete(i); no(new Error('cdp timeout: ' + m)); } }, 20000); }); };
const S = (await send('Target.attachToTarget', { targetId: t.id, flatten: true })).sessionId;
await send('Page.enable', {}, S); await send('Runtime.enable', {}, S);
const ev = async x => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, userGesture: true }, S); if (r.exceptionDetails) throw new Error('eval:' + (r.exceptionDetails.exception?.description || '')); return r.result.value; };
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('wl_guide_done_pages_v1',JSON.stringify({work:true,pert:true,config:true,help:true}))}catch(e){}` }, S);
await send('Page.navigate', { url: APP }, S);
for (let i = 0; i < 60; i++) { if ((await ev(`typeof applyI18n === 'function' && typeof t === 'function' && document.readyState !== 'loading'`)) === true) break; await sleep(250); }
await ev(`try{localStorage.removeItem('wl_lang')}catch(e){}`);

// ---- 1) /api/i18n 路由 ----
const zh = await getJson('/api/i18n?lang=zh-CN');
check('/api/i18n 返回 ok 且带字典', zh.ok === true && Object.keys(zh.strings || {}).length > 0, `lang=${zh.lang} keys=${Object.keys(zh.strings || {}).length}`);
const en = await getJson('/api/i18n?lang=en-US');
check('en-US 字典可取且与zh-CN key 数一致',
  en.ok === true && Object.keys(en.strings).length === Object.keys(zh.strings).length,
  `en=${Object.keys(en.strings).length} zh=${Object.keys(zh.strings).length}`);

// ---- 2) lang 白名单收敛（目录穿越不得反射进响应） ----
const evil = [];
for (const L of ['../../config', '../config', 'jp', '%2e%2e%2fconfig', 'zh-CN/../../config', '']) {
  const r = await getJson('/api/i18n?lang=' + encodeURIComponent(L));
  if (r.lang !== 'zh-CN') evil.push(`${L}→${r.lang}`);
}
check('非法/穿越 lang 一律收敛为默认（无反射、无穿越）', evil.length === 0, evil.join(' | ') || '已测 6 种非法输入');

// ---- 3) 字典 key 对齐（防漏译） ----
const mis = [];
for (const k of Object.keys(zh.strings)) {
  if (!Object.prototype.hasOwnProperty.call(en.strings, k)) mis.push(`en 缺 ${k}`);
  else if (!String(en.strings[k]).trim()) mis.push(`en 空译 ${k}`);
  if (!String(zh.strings[k]).trim()) mis.push(`zh 空值 ${k}`);
}
check('两字典 key 双向对齐且无空译文', mis.length === 0, mis.slice(0, 4).join(' | ') || `共 ${Object.keys(zh.strings).length} 键`);

// ---- 4) 运行时：t() 与字典加载 ----
const rt = JSON.parse(await ev(`JSON.stringify({lang:__I18N_LANG,n:Object.keys(__I18N||{}).length,tApp:t('app.title'),tMiss:t('__no_such_key__')})`));
check('页面运行时已加载字典', rt.n > 0 && rt.lang === 'zh-CN', `lang=${rt.lang} keys=${rt.n}`);
check('t() 命中返回译文', rt.tApp === '工作量评估助手', rt.tApp);
check('t() 未命中回退显示 key（不白屏）', rt.tMiss === '__no_such_key__', rt.tMiss);

// ---- 5) data-i18n 文本替换（默认中文） ----
const zhUI = JSON.parse(await ev(`JSON.stringify({
  h1:document.querySelector('.brand h1').textContent.trim(),
  nav:document.querySelector('#mi-work .lbl').textContent.trim(),
  navPert:document.querySelector('#mi-pert .lbl').textContent.trim(),
  st1:document.querySelector('#st1 span[data-i18n]').textContent.trim(),
  histBtn:document.querySelector('[data-i18n="work.history"]').textContent.trim(),
})`));
check('默认中文：标题/导航/步骤条/按钮均为中文原文',
  zhUI.h1 === '工作量评估助手' && zhUI.nav === 'IFPUG 估算' && zhUI.st1 === '上传需求' && zhUI.histBtn === '历史估算',
  JSON.stringify(zhUI));

// ---- 6) data-i18n 属性替换 ----
const attrs = JSON.parse(await ev(`JSON.stringify({
  stepTitle:document.querySelector('#st1').getAttribute('title'),
  ph:document.querySelector('#histQuery').getAttribute('placeholder'),
  clearTitle:document.querySelector('#hdifAll').getAttribute('title'),
})`));
check('data-i18n 同步替换 title/placeholder 属性',
  attrs.stepTitle === '返回上传需求' && attrs.ph === '按需求标题 / 文件名搜索…' && attrs.clearTitle === '清空选择',
  JSON.stringify(attrs));

// ---- 7) 切换到英文：文本 + 属性即时生效 ----
await ev(`setLang('en-US');`); await sleep(700);
const enUI = JSON.parse(await ev(`JSON.stringify({
  lang:__I18N_LANG, htmlLang:document.documentElement.lang,
  h1:document.querySelector('.brand h1').textContent.trim(),
  nav:document.querySelector('#mi-work .lbl').textContent.trim(),
  navConfig:document.querySelector('#mi-config .lbl').textContent.trim(),
  st1:document.querySelector('#st1 span[data-i18n]').textContent.trim(),
  st3:document.querySelector('#st3 span[data-i18n]').textContent.trim(),
  histTitle:document.querySelector('[data-i18n="history.title"]').textContent.trim(),
  stepTitle:document.querySelector('#st1').getAttribute('title'),
  ph:document.querySelector('#histQuery').getAttribute('placeholder'),
  th:document.querySelector('th[data-i18n]').textContent.trim(),
  saved:localStorage.getItem('wl_lang'),
})`));
check('切换 en-US 后界面文本即时变英文',
  enUI.h1 === 'Workload Estimator' && enUI.nav === 'IFPUG Estimate' && enUI.navConfig === 'Settings'
  && enUI.st1 === 'Upload' && enUI.st3 === 'Result' && enUI.histTitle === 'Estimate History',
  JSON.stringify({ h1: enUI.h1, nav: enUI.nav, st1: enUI.st1, hist: enUI.histTitle }));
check('切换后 title/placeholder/表头亦随之更新',
  enUI.stepTitle === 'Back to upload' && /^Search by/.test(enUI.ph) && enUI.th === 'Time',
  JSON.stringify({ t: enUI.stepTitle, ph: enUI.ph, th: enUI.th }));
check('语言选择已记忆 + html lang 属性同步',
  enUI.saved === 'en-US' && enUI.htmlLang === 'en-US', `saved=${enUI.saved} htmlLang=${enUI.htmlLang}`);

// ---- 8) 无残留中文（已标注区域） ----
// 排除语言选择器自身：按 i18n 惯例，各语言用自身文字标注（简体中文/English），
// 「简体中文」在英文界面下仍显示中文是正确的，不是漏译残留。
const residue = await ev(`(()=>{const bad=[];document.querySelectorAll('[data-i18n]').forEach(el=>{
  if(el.closest('#langSeg'))return;
  if(el.children.length===0&&/[一-龥]/.test(el.textContent)) bad.push(el.getAttribute('data-i18n'));});return JSON.stringify(bad)})()`);
check('英文态下已标注节点无中文残留（语言选择器除外）', residue === '[]', residue);
const langSel = await ev(`(()=>{const b=[...document.querySelectorAll('#langSeg .lm')];
  return JSON.stringify(b.map(x=>x.textContent.trim()))})()`);
check('语言选择器按 i18n 惯例用各语言自身文字标注', langSel === '["简体中文","English"]', langSel);

// ---- 9) 语言按钮选中态 ----
await ev(`goPage('config');`); await sleep(600);
const seg = JSON.parse(await ev(`(()=>{const b=[...document.querySelectorAll('#langSeg .lm')];
  return JSON.stringify({n:b.length,enOn:b[1].style.fontWeight==='700'||b[1].style.borderColor.includes('brand'),
    zhOn:b[0].style.fontWeight==='700'||b[0].style.borderColor.includes('brand')})})()`));
check('配置中心有语言切换按钮且选中态正确（en 高亮）', seg.n === 2 && seg.enOn === true && seg.zhOn === false, JSON.stringify(seg));
const cfgText = await ev(`document.querySelector('[data-i18n="appearance.lang"]').textContent.trim()`);
check('外观区新增语言项（英文态文案已生效）', cfgText === 'Language', cfgText);

// ---- 10) 刷新后语言保持 ----
await send('Page.navigate', { url: APP }, S);
for (let i = 0; i < 60; i++) { if ((await ev(`typeof applyI18n==='function'&&document.readyState!=='loading'`)) === true) break; await sleep(250); }
await sleep(600);
const persisted = JSON.parse(await ev(`JSON.stringify({lang:__I18N_LANG,h1:document.querySelector('.brand h1').textContent.trim()})`));
check('刷新后语言保持（记忆生效）', persisted.lang === 'en-US' && persisted.h1 === 'Workload Estimator', JSON.stringify(persisted));

// ---- 11) 缺译文时保留原中文（不抠空、不露内部 key）----
// 关键：key 是语义化英文标识（app.title），t() 回退值就是 key 本身。
// 故缺译文时若写入 key，用户会看到 "app.title" 这类内部标识 —— 实测加固后
// applyI18n 在缺译文时完全不动 DOM，保留服务端渲染的中文原文。
// 注意：下面表达式返回的是 JSON.stringify 的结果（字符串），需JSON.parse 才是数组。
const missingArr = JSON.parse(await ev(`(()=>{const d=document.createElement('div');
  d.innerHTML='<span data-i18n="__nope__">原始中文</span><span data-i18n="app.title">原始</span><input data-i18n-ph="__nope_ph__" placeholder="原中文占位">';
  document.body.appendChild(d);applyI18n(d);
  const out=[...d.querySelectorAll('span')].map(x=>x.textContent.trim());
  out.push(d.querySelector('input').getAttribute('placeholder'));
  d.remove();return JSON.stringify(out)})()`));
check('缺译文时保留原中文，不抠空也不露内部 key',
  missingArr[0] === '原始中文' && missingArr[1] === 'Workload Estimator' && missingArr[2] === '原中文占位',
  JSON.stringify(missingArr));

// ---- 12) 还原中文，避免影响后续套件 ----
await ev(`setLang('zh-CN');`); await sleep(500);
const back = await ev(`document.querySelector('.brand h1').textContent.trim()`);
check('可切回中文', back === '工作量评估助手', back);

// ---- 13) 复核表（批次2新增，最易踩DOM 摧毁与计数插值坑） ----
// 先造数据：空表下多数文案不渲染，无法验证
await ev(`(()=>{items=[
  {seq:1,system:'S1',m1:'M1',desc:'客户信息维护',count_item:'字段校验',type:'EI',reuse:'中',modify:'修改',cx:'中',ok:true,basis:'b1'},
  {seq:2,system:'S1',m1:'M1',desc:'订单查询',count_item:'查询界面',type:'EO',reuse:'高',modify:'新增',cx:'低',ok:false,basis:'b2'}
];syncSysFilter&&syncSysFilter();render();goStep('review');})()`);
await sleep(500);
const rvZh = JSON.parse(await ev(`JSON.stringify({
  cap:document.querySelector('.cap[data-i18n]').textContent.trim(),
  pendingPre:[...document.querySelectorAll('[data-i18n="review.side.pending_pre"]')].map(x=>x.textContent.trim())[0],
  pendingPost:[...document.querySelectorAll('[data-i18n="review.side.pending_post"]')].map(x=>x.textContent.trim())[0],
  listCnt:document.getElementById('listCnt').textContent.trim(),
  thDesc:document.querySelector('[data-i18n="review.th.desc"]').textContent.trim(),
  thDescTitle:document.querySelector('th[data-i18n="title=review.th.desc_title"]').getAttribute('title'),
  thCx:[...document.querySelectorAll('#v-review th[data-i18n]')].map(x=>x.textContent.trim()),
  paste:document.querySelector('[data-i18n="review.paste"]').textContent.trim(),
  go:[...document.querySelectorAll('[data-i18n="review.dock.go"]')].map(x=>x.textContent.trim())[0],
  hint:document.querySelector('[data-i18n="review.gen.hint"]')?document.querySelector('[data-i18n="review.gen.hint"]').textContent.trim():null,
})`));
check('复核表中文态：侧栏/计数/表头/按钮均为中文',
  rvZh.cap === '功能模块' && rvZh.listCnt === '2 条候选'
  && rvZh.thDesc === '功能项描述' && rvZh.paste === '粘贴导入' && rvZh.go === '确认无误 · 生成结果',
  JSON.stringify(rvZh));
// 关键：tf() 插值必须生效，且未留下 {n} 裸占位
check('计数文案经 tf() 插值（无 {n} 残留，且数字正确）',
  /^\d+ 条候选$/.test(rvZh.listCnt) && !rvZh.listCnt.includes('{'), rvZh.listCnt);
check('「待确认 N项」拆成 pre/post 后语序正确（数字在两段之间）',
  rvZh.pendingPre === '待确认' && rvZh.pendingPost === '项', JSON.stringify([rvZh.pendingPre, rvZh.pendingPost]));

// 切英文：验证同一批节点
await ev(`setLang('en-US');`); await sleep(600);
const rvEn = JSON.parse(await ev(`JSON.stringify({
  cap:document.querySelector('.cap[data-i18n]').textContent.trim(),
  pendingPre:[...document.querySelectorAll('[data-i18n="review.side.pending_pre"]')].map(x=>x.textContent.trim())[0],
  pendingPost:[...document.querySelectorAll('[data-i18n="review.side.pending_post"]')].map(x=>x.textContent.trim())[0],
  listCnt:document.getElementById('listCnt').textContent.trim(),
  thDesc:document.querySelector('[data-i18n="review.th.desc"]').textContent.trim(),
  thDescTitle:document.querySelector('th[data-i18n="title=review.th.desc_title"]').getAttribute('title'),
  thCx:[...document.querySelectorAll('#v-review th[data-i18n]')].map(x=>x.textContent.trim()),
  paste:document.querySelector('[data-i18n="review.paste"]').textContent.trim(),
  go:[...document.querySelectorAll('[data-i18n="review.dock.go"]')].map(x=>x.textContent.trim())[0],
  // 关键回归点：lucide 图标是否被 textContent 摧毁
  pasteIcon:!!document.querySelector('[data-i18n="review.paste"]').parentElement.querySelector('svg, i[data-lucide]'),
  goIcon:!!document.querySelector('[data-i18n="review.dock.go"]').parentElement.querySelector('svg, i[data-lucide]'),
  stepChildIntact:document.querySelector('#st1').children.length,
})`));
check('复核表英文态：侧栏/表头/按钮已切英文',
  rvEn.cap === 'Function Modules' && rvEn.thDesc === 'Description' && rvEn.paste === 'Paste import',
  JSON.stringify({cap:rvEn.cap, thDesc:rvEn.thDesc, paste:rvEn.paste}));
check('复核表计数英文态插值正确（n candidates）',
  /^\d+ candidates$/.test(rvEn.listCnt) && !rvEn.listCnt.includes('{'), rvEn.listCnt);
check('「待确认 N项」英文态语序正确（Pending N items）',
  rvEn.pendingPre === 'Pending' && rvEn.pendingPost === 'items', JSON.stringify([rvEn.pendingPre, rvEn.pendingPost]));
// 这条直接对应批次1 的textContent 摧毁 DOM 缺陷
check('切换语言后按钮图标未被摧毁（textContent 回归守卫）',
  rvEn.pasteIcon === true && rvEn.goIcon === true,
  JSON.stringify({paste:rvEn.pasteIcon, go:rvEn.goIcon}));
check('步骤条子结构完好（序号+文案未被 textContent 摧毁）',
  rvEn.stepChildIntact >= 2, `children=${rvEn.stepChildIntact}`);
check('表头 title 属性同步（按描述排序 → Sort by description）',
  rvEn.thDescTitle === 'Sort by description', rvEn.thDescTitle);
// 复核表全块无中文残留
const rvResidue = await ev(`(()=>{const bad=[];document.querySelectorAll('#v-review [data-i18n]').forEach(el=>{
  if(el.children.length===0&&/[一-龥]/.test(el.textContent)) bad.push(el.getAttribute('data-i18n'));});return JSON.stringify(bad)})()`);
check('复核表英文态无中文残留', rvResidue === '[]', rvResidue);
// 切回中文并复原数据
await ev(`setLang('zh-CN');items=[];render();`); await sleep(500);

// ---- 14) 结果页（批次2）----
await ev(`(()=>{gSummary={ufp:35,adjusted_fp:32,work:{low:10,mid:12,high:15},cost:{low:8,mid:9,high:11}};
  items=[{seq:1,system:'S1',m1:'M1',desc:'D1',count_item:'C1',type:'EI',reuse:'中',modify:'修改',cx:'中',ok:true,basis:''},
         {seq:2,system:'S2',m1:'M2',desc:'D2',count_item:'C2',type:'EO',reuse:'高',modify:'新增',cx:'低',ok:true,basis:''}];
  render();buildResult();goStep('result');})()`);
await sleep(600);
const rsZh = JSON.parse(await ev(`JSON.stringify({
  sum:[...document.querySelectorAll('[data-i18n="result.tab.sum"]')].map(x=>x.textContent.trim()),
  gb:document.querySelector('[data-i18n="result.tab.gb"]').textContent.trim(),
  kpiFp:document.querySelector('[data-i18n="result.kpi.fp"]').textContent.trim(),
  kpiCost:document.querySelector('[data-i18n="result.kpi.cost"]').textContent.trim(),
  kpiUnit:[...document.querySelectorAll('[data-i18n="result.kpi.cost_unit"]')].map(x=>x.textContent.trim())[0],
  low:[...document.querySelectorAll('[data-i18n="result.kpi.low"]')].map(x=>x.textContent.trim())[0],
  chart:[...document.querySelectorAll('[data-i18n^="result.chart."]')].map(x=>x.textContent.trim()),
  sys:document.querySelector('[data-i18n="result.sys.title"]').textContent.trim(),
  nav:document.querySelector('.r-tabs').getAttribute('aria-label'),
})`));
check('结果页中文态：Tab/KPI/图表标题均为中文',
  rsZh.sum[0] === '评估汇总' && rsZh.gb === '国标造价' && rsZh.kpiFp === '未调整功能点'
  && rsZh.kpiCost === '费用' && rsZh.sys === '分系统规模明细（US）' && rsZh.chart.length === 4,
  JSON.stringify({sum:rsZh.sum[0], kpi:rsZh.kpiFp, chart:rsZh.chart.length}));

await ev(`setLang('en-US');`); await sleep(700);
const rsEn = JSON.parse(await ev(`JSON.stringify({
  sum:[...document.querySelectorAll('[data-i18n="result.tab.sum"]')].map(x=>x.textContent.trim())[0],
  gb:document.querySelector('[data-i18n="result.tab.gb"]').textContent.trim(),
  kpiFp:document.querySelector('[data-i18n="result.kpi.fp"]').textContent.trim(),
  kpiWorkUnit:[...document.querySelectorAll('[data-i18n="result.kpi.work_unit"]')].map(x=>x.textContent.trim())[0],
  kpiLow:[...document.querySelectorAll('[data-i18n="result.kpi.low"]')].map(x=>x.textContent.trim())[0],
  kpiHigh:[...document.querySelectorAll('[data-i18n="result.kpi.high"]')].map(x=>x.textContent.trim())[0],
  chart:[...document.querySelectorAll('[data-i18n^="result.chart."]')].map(x=>x.textContent.trim()),
  sys:document.querySelector('[data-i18n="result.sys.title"]').textContent.trim(),
  check:document.querySelector('[data-i18n="result.check.title"]').textContent.trim(),
  nav:document.querySelector('.r-tabs').getAttribute('aria-label'),
  // KPI 数值须仍是数字（重渲染不能把数据清掉）
  fp:document.getElementById('rFp').textContent.trim(),
  cost:document.getElementById('rCost').textContent.trim(),
  // 图表卡片图标未被摧毁
  chartIcon:!!document.querySelector('[data-i18n="result.chart.type"]').parentElement.querySelector('svg, i[data-lucide]'),
})`));
check('结果页英文态：Tab/KPI/图表标题已切英文',
  rsEn.sum === 'Summary' && rsEn.gb === 'GB Cost' && rsEn.kpiFp === 'Unadjusted FP'
  && rsEn.sys === 'Size by System (US)' && rsEn.check === 'Validation Report',
  JSON.stringify({sum:rsEn.sum, kpi:rsEn.kpiFp, sys:rsEn.sys}));
check('结果页 KPI 区间标签与单位已切英文',
  rsEn.kpiLow === 'Low' && rsEn.kpiHigh === 'High' && /person-days/.test(rsEn.kpiWorkUnit),
  JSON.stringify({low:rsEn.kpiLow, unit:rsEn.kpiWorkUnit}));
check('结果页四张图表标题已切英文',
  rsEn.chart.length === 4 && rsEn.chart.every(c => /^[A-Za-z]/.test(c)), JSON.stringify(rsEn.chart));
check('结果页 aria-label 同步（Result page navigation）',
  rsEn.nav === 'Result page navigation', rsEn.nav);
// 切语言触发 render()/refreshCharts() 后，KPI 数值不能被清空
check('切换语言后 KPI 数值保持（重渲染未清空数据）',
  rsEn.fp === '35' && rsEn.cost === '9', `fp=${rsEn.fp} cost=${rsEn.cost}`);
check('结果页图表卡片图标未被摧毁', rsEn.chartIcon === true, `icon=${rsEn.chartIcon}`);
// 折叠按钮的 title 属性
const foldTitle = await ev(`document.querySelector('[data-i18n="title=result.fold.detail_title"]').getAttribute('title')`);
check('结果页折叠按钮 title 已切英文', foldTitle === 'Collapse/expand details', foldTitle);

const rsResidue = await ev(`(()=>{const bad=[];document.querySelectorAll('#v-result [data-i18n]').forEach(el=>{
  if(el.children.length===0&&/[一-龥]/.test(el.textContent)) bad.push(el.getAttribute('data-i18n'));});return JSON.stringify(bad)})()`);
check('结果页英文态无中文残留', rsResidue === '[]', rsResidue);

await ev(`setLang('zh-CN');items=[];goStep('upload');`); await sleep(400);

// ---- 15) PERT 页（批次2）----
await ev(`goPage('pert');`); await sleep(600);
const ptZh = JSON.parse(await ev(`JSON.stringify({
  title:document.querySelector('[data-i18n="pert.title"]').textContent.trim(),
  steps:[...document.querySelectorAll('[data-i18n^="pert.step."]')].map(x=>x.textContent.trim()),
  upload:document.querySelector('[data-i18n="pert.in.upload"]').textContent.trim(),
  dropHint:document.querySelector('[data-i18n="pert.in.drop_hint"]').textContent.trim(),
  curProject:document.querySelector('[data-i18n="pert.edit.cur_project"]').textContent.trim(),
  oPh:document.getElementById('pertO').getAttribute('placeholder'),
  mPh:document.getElementById('pertM').getAttribute('placeholder'),
  total:document.querySelector('[data-i18n="pert.gen.total_days"]').textContent.trim(),
  dropAria:document.getElementById('pertDrop').getAttribute('aria-label'),
})`));
check('PERT 页中文态：标题/步骤条/上传区/三值输入均为中文',
  ptZh.title === 'PERT 三点估算' && ptZh.steps.length === 3 && ptZh.upload === '上传需求说明书'
  && ptZh.oPh === '乐观' && ptZh.mPh === '最可能' && ptZh.total === '预期总人天',
  JSON.stringify({title:ptZh.title, steps:ptZh.steps, o:ptZh.oPh}));

await ev(`setLang('en-US');`); await sleep(700);
const ptEn = JSON.parse(await ev(`JSON.stringify({
  title:document.querySelector('[data-i18n="pert.title"]').textContent.trim(),
  formula:document.querySelector('[data-i18n="pert.title_formula"]').textContent.trim(),
  steps:[...document.querySelectorAll('[data-i18n^="pert.step."]')].map(x=>x.textContent.trim()),
  upload:document.querySelector('[data-i18n="pert.in.upload"]').textContent.trim(),
  dropHint:document.querySelector('[data-i18n="pert.in.drop_hint"]').textContent.trim(),
  curProject:document.querySelector('[data-i18n="pert.edit.cur_project"]').textContent.trim(),
  oPh:document.getElementById('pertO').getAttribute('placeholder'),
  mPh:document.getElementById('pertM').getAttribute('placeholder'),
  mTitle:document.getElementById('pertM').getAttribute('title'),
  total:document.querySelector('[data-i18n="pert.gen.total_days"]').textContent.trim(),
  ideal:document.querySelector('[data-i18n="pert.gen.ideal_month"]').textContent.trim(),
  actual:document.querySelector('[data-i18n="pert.gen.actual_month"]').textContent.trim(),
  dropAria:document.getElementById('pertDrop').getAttribute('aria-label'),
  textPh:(document.getElementById('pertTextArea').getAttribute('placeholder')||'').slice(0,30),
  // 步骤条与按钮图标未被摧毁
  stepIconIntact:document.querySelector('#pst1').children.length,
})`));
check('PERT 页英文态：标题/步骤条/三值输入已切英文',
  ptEn.title === 'PERT Three-Point Estimate' && ptEn.steps.length === 3
  && ptEn.upload === 'Upload Requirements' && ptEn.oPh === 'Optimistic' && ptEn.mPh === 'Most likely',
  JSON.stringify({title:ptEn.title, steps:ptEn.steps, o:ptEn.oPh}));
check('PERT 三值输入 title 属性已切英文',
  /Most likely value/.test(ptEn.mTitle || ''), ptEn.mTitle);
check('PERT 步骤3 的 KPI 标签已切英文',
  ptEn.total === 'Total expected person-days' && ptEn.ideal === 'Ideal person-months'
  && ptEn.actual === 'Adjusted person-months',
  JSON.stringify({total:ptEn.total, ideal:ptEn.ideal, actual:ptEn.actual}));
check('PERT 拖放区 aria-label 与粘贴框placeholder 已切英文',
  /Upload PERT requirements/.test(ptEn.dropAria || '') && /^Describe one or more/.test(ptEn.textPh),
  JSON.stringify({aria:(ptEn.dropAria||'').slice(0,28), ph:ptEn.textPh}));
check('PERT 步骤条子结构完好', ptEn.stepIconIntact >= 2, `children=${ptEn.stepIconIntact}`);
const ptResidue = await ev(`(()=>{const bad=[];document.querySelectorAll('#pg-pert [data-i18n]').forEach(el=>{
  if(el.children.length===0&&/[一-龥]/.test(el.textContent)) bad.push(el.getAttribute('data-i18n'));});return JSON.stringify(bad)})()`);
check('PERT 页英文态无中文残留', ptResidue === '[]', ptResidue);

await ev(`setLang('zh-CN');goPage('work');goStep('upload');`); await sleep(400);

// ---- 16) 配置中心（批次2）----
await ev(`goPage('config');`); await sleep(600);
const cfZh = JSON.parse(await ev(`JSON.stringify({
  cards:[...document.querySelectorAll('#pg-config [data-i18n^="config.card."]')].map(x=>x.textContent.trim()),
  enable:document.querySelector('[data-i18n="config.llm.enable"]').textContent.trim(),
  save:document.querySelector('[data-i18n="title=config.llm.save_title"]').getAttribute('title'),
  test:document.querySelector('[data-i18n="title=config.llm.test|aria-label=config.llm.test"]')?document.querySelector('[data-i18n="title=config.llm.test|aria-label=config.llm.test"]').getAttribute('title'):null,
  rulesTh:[...document.querySelectorAll('#pg-config th[data-i18n^="config.rules."]')].map(x=>x.textContent.trim()),
})`));
check('配置中心中文态：卡片标题与设置项均为中文',
  cfZh.cards.includes('大模型识别增强') && cfZh.enable === '启用大模型辅助识别'
  && cfZh.save === '保存配置' && cfZh.test === '连接测试',
  JSON.stringify({cards:cfZh.cards.length, enable:cfZh.enable, test:cfZh.test}));

await ev(`setLang('en-US');`); await sleep(700);
const cfEn = JSON.parse(await ev(`JSON.stringify({
  cards:[...document.querySelectorAll('#pg-config [data-i18n^="config.card."]')].map(x=>x.textContent.trim()),
  enable:document.querySelector('[data-i18n="config.llm.enable"]').textContent.trim(),
  save:document.querySelector('[data-i18n="title=config.llm.save_title"]').getAttribute('title'),
  test:document.querySelector('[data-i18n="title=config.llm.test|aria-label=config.llm.test"]')?document.querySelector('[data-i18n="title=config.llm.test|aria-label=config.llm.test"]').getAttribute('title'):null,
  switchAria:document.getElementById('llmSwitch').getAttribute('aria-label'),
  ctxPh:document.getElementById('ctxDir').getAttribute('placeholder'),
  modes:[...document.querySelectorAll('[data-i18n^="config.recalc."]')].map(x=>x.textContent.trim()),
  rulesTitle:document.querySelector('[data-i18n="config.rules.title"]').textContent.trim(),
  loading:[...document.querySelectorAll('[data-i18n="common.loading"]')].map(x=>x.textContent.trim()),
  // 开关与按钮图标未被摧毁
  llmIconIntact:document.querySelector('[data-i18n="config.llm.enable"]').parentElement.children.length,
})`));
check('配置中心英文态：卡片标题与设置项已切英文',
  cfEn.cards.includes('LLM-Assisted Recognition') && cfEn.enable === 'Enable LLM-assisted recognition'
  && cfEn.save === 'Save settings' && cfEn.test === 'Test connection',
  JSON.stringify({enable:cfEn.enable, save:cfEn.save, test:cfEn.test}));
check('配置中心开关 aria-label 与目录输入 placeholder 已切英文',
  /Enable LLM-assisted/.test(cfEn.switchAria || '') && /^e\.g\. D:/.test(cfEn.ctxPh || ''),
  JSON.stringify({aria:cfEn.switchAria, ph:cfEn.ctxPh}));
check('配置中心规则卡标题已切英文', cfEn.rulesTitle === 'Recognition Rules', cfEn.rulesTitle);
// 排除 #langSeg：语言选择器按 i18n 惯例用各语言自身文字标注（简体中文/English），
// 「简体中文」在英文界面下显示中文是正确的，不是漏译残留。
const cfResidue = await ev(`(()=>{const bad=[];
  document.querySelectorAll('#pg-config [data-i18n]').forEach(el=>{
    if(el.closest('#langSeg'))return;
    if(el.children.length===0&&/[一-龥]/.test(el.textContent)) bad.push(el.getAttribute('data-i18n'));});
  return JSON.stringify(bad)})()`);
check('配置中心英文态无中文残留（结构性节点）', cfResidue === '[]', cfResidue);

// ---- 17) 帮助页（批次2 结构性 + 批次3 方法论正文）----
await ev(`setLang('zh-CN');goPage('help');`); await sleep(700);
const hpZh = JSON.parse(await ev(`JSON.stringify({
  h3:[...document.querySelectorAll('#pg-help h3 [data-i18n^="help.h3."]')].map(x=>x.textContent.trim()),
  h4:[...document.querySelectorAll('#pg-help h4[data-i18n]')].map(x=>x.textContent.trim()).slice(0,4),
  kbdKey:document.querySelector('[data-i18n="help.kbd.key"]').textContent.trim(),
  verTitle:document.querySelector('[data-i18n="help.ver.title"]').textContent.trim(),
  // 批次3：正文段落（key 化后 zh 态应回填中文原文）
  bodyM3:document.querySelector('[data-i18n="help.body.m3"]').textContent.trim(),
  bodyA2f:document.querySelector('[data-i18n="help.body.a2f"]').textContent.trim(),
  zhTextNodes:JSON.stringify((()=>{const w=document.createTreeWalker(document.querySelector('#pg-help'),NodeFilter.SHOW_TEXT);const a=[];let n;while(n=w.nextNode())if(/[一-龥]/.test(n.nodeValue))a.push(n.nodeValue.trim().slice(0,12));return a})()),
})`));
check('帮助页中文态：章节标题/小节/快捷键表均为中文',
  hpZh.h3.length === 4 && hpZh.h4.length === 4 && hpZh.kbdKey === '按键' && hpZh.verTitle === '版本与更新',
  JSON.stringify({h3:hpZh.h3, kbd:hpZh.kbdKey}));
check('帮助页中文态：正文段落为中文原文（批次3 key 化后 zh 字典生效）',
  /三级复杂度计权/.test(hpZh.bodyM3) && /重用系数/.test(hpZh.bodyA2f) && hpZh.zhTextNodes.includes('操作引导'),
  JSON.stringify({m3:hpZh.bodyM3.slice(0, 20), a2f:hpZh.bodyA2f}));

await ev(`setLang('en-US');`); await sleep(700);
const hpEn = JSON.parse(await ev(`JSON.stringify({
  h3:[...document.querySelectorAll('#pg-help h3 [data-i18n^="help.h3."]')].map(x=>x.textContent.trim()),
  h4:[...document.querySelectorAll('#pg-help h4[data-i18n]')].map(x=>x.textContent.trim()).slice(0,4),
  kbdKey:document.querySelector('[data-i18n="help.kbd.key"]').textContent.trim(),
  kbdMove:document.querySelector('[data-i18n="help.kbd.move"]').textContent.trim(),
  verTitle:document.querySelector('[data-i18n="help.ver.title"]').textContent.trim(),
  checkTitle:document.querySelector('[data-i18n="title=help.ver.check_title"]')?document.querySelector('[data-i18n="title=help.ver.check_title"]').getAttribute('title'):null,
  guideTitle:document.querySelector('[data-i18n="title=help.guide.help"]')?document.querySelector('[data-i18n="title=help.guide.help"]').getAttribute('title'):null,
  // 徽标未被 textContent 摧毁（h3 内的 IFPUG/PERT 徽标 span）
  badgeIntact:[...document.querySelectorAll('#pg-help h3')].every(h=>h.children.length>=2),
  // 批次3：正文与公式段落英文断言
  bodyM3:document.querySelector('[data-i18n="help.body.m3"]').textContent.trim(),
  bodyA2f:document.querySelector('[data-i18n="help.body.a2f"]').textContent.trim(),
  bodyP4b:document.querySelector('[data-i18n="help.body.p4b"]').textContent.trim(),
  bodyP5:document.querySelector('[data-i18n="help.body.p5"]').textContent.trim(),
  guideBtn:document.querySelector('[data-i18n="help.guide.work.btn"]').textContent.trim(),
})`));
check('帮助页英文态：章节与快捷键表已切英文',
  hpEn.h3.length === 4 && hpEn.kbdKey === 'Key' && hpEn.verTitle === 'Version and Updates'
  && /Methodology/.test(hpEn.h3[0]) && /Algorithms/.test(hpEn.h3[1]),
  JSON.stringify({h3:hpEn.h3, kbd:hpEn.kbdKey, ver:hpEn.verTitle}));
check('帮助页小节标题已切英文', /^1\. /.test(hpEn.h4[0]) && /Basis/.test(hpEn.h4[0]), JSON.stringify(hpEn.h4));
check('帮助页按钮 title 已切英文（更新与引导）',
  /Check for updates/.test(hpEn.checkTitle || '') && /Feature overview/.test(hpEn.guideTitle || ''),
  JSON.stringify({chk:hpEn.checkTitle, guide:hpEn.guideTitle}));
check('帮助页 h3 徽标未被摧毁（h3 子结构完好）', hpEn.badgeIntact === true, `badges=${hpEn.badgeIntact}`);
check('帮助页英文态：正文段落/公式/引导按钮已切英文（批次3）',
  /complexity levels/.test(hpEn.bodyM3) && /US = UFP × Reuse Factor/.test(hpEn.bodyA2f)
  && /Ideal Person-Months/.test(hpEn.bodyP4b) && /row R8/.test(hpEn.bodyP5)
  && hpEn.guideBtn === 'IFPUG Walkthrough',
  JSON.stringify({m3:hpEn.bodyM3.slice(0, 30), a2f:hpEn.bodyA2f, p4b:hpEn.bodyP4b, btn:hpEn.guideBtn}));
// ---- 批次4a：更新区 JS 动态文案（T01548 验收：英文态点「检查更新」全流程无中文）----
await ev(`checkUpdate(true)`); await sleep(1200);
const verEn = JSON.parse(await ev(`JSON.stringify({
  state:document.querySelector('#verState').textContent.trim(),
  toast:document.querySelector('#toast').textContent.trim(),
})`));
check('更新区英文态：手动检查结果与 toast 均为英文（批次4a，无排除条款）',
  !/[一-龥]/.test(verEn.state) && !/[一-龥]/.test(verEn.toast) && verEn.state !== ''
  && /Check failed|Already up to date|New version/i.test(verEn.state),
  JSON.stringify(verEn));
// 「立即更新」入口：测试实例未配置更新源，doUpdate 走守卫分支，toast 须为英文
await ev(`doUpdate()`); await sleep(200);
const updEn = await ev(`document.querySelector('#toast').textContent.trim()`);
check('更新区英文态：点「立即更新」守卫提示为英文（批次4a 更新流程）',
  updEn !== '' && !/[一-龥]/.test(updEn), `toast=${updEn}`);
// 语言切换后按保存状态重绘：切回中文态，动态状态应同步为中文
await ev(`setLang('zh-CN')`); await sleep(700);
const verZh = await ev(`document.querySelector('#verState').textContent.trim()`);
check('更新区中文态：切换语言后动态状态随之重绘（verPaint 钩子生效）',
  verZh === '检测失败：未配置更新源' || /[一-龥]/.test(verZh), `state=${verZh}`);
await ev(`setLang('en-US')`); await sleep(700);
// 全页文本节点扫描（不只 [data-i18n] 节点）：英文态下帮助页任何中文都算漏译。
// 变量与符号（O/M/P、σ、UFP、FP）非中文不受影响；徽标 IFPUG/PERT 为拉丁字符。
// 批次4a（T01548）落地后已删除 #verState/#verNotes/#verProgWrap 排除条款——
// 更新区动态状态文案已全部 key 化，由 verPaint() 按当前语言重绘。
const hpResidue = await ev(`(()=>{const bad=[];
  const w=document.createTreeWalker(document.querySelector('#pg-help'),NodeFilter.SHOW_TEXT,
    {acceptNode(n){return /[一-龥]/.test(n.nodeValue)?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_SKIP;}});
  let n;while(n=w.nextNode()){const el=n.parentElement;
    bad.push(((el&&el.closest('[data-i18n]')?el.closest('[data-i18n]').getAttribute('data-i18n'):null)||('#'+(el?el.className||el.tagName:'root')))+':'+n.nodeValue.trim().slice(0,24));}
  return JSON.stringify(bad)})()`);
check('帮助页英文态全页扫描：正文与更新区动态文案均无中文残留（批次3+4a 验收）', hpResidue === '[]', hpResidue);

await ev(`setLang('zh-CN');goPage('work');goStep('upload');`); await sleep(400);

check('全程无页面异常', errors.length === 0, errors.slice(0, 2).join(' | '));
const failed = res.filter(r => !r.ok);
console.log(`\n==== 汇总 ==== 共 ${res.length} 项，通过 ${res.length - failed.length}，失败 ${failed.length}`);
process.exit(failed.length ? 1 : 0);
