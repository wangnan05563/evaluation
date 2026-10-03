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

check('全程无页面异常', errors.length === 0, errors.slice(0, 2).join(' | '));
const failed = res.filter(r => !r.ok);
console.log(`\n==== 汇总 ==== 共 ${res.length} 项，通过 ${res.length - failed.length}，失败 ${failed.length}`);
process.exit(failed.length ? 1 : 0);
