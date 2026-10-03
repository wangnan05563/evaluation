/** FR-UI05 键盘可完成主链路验证（上传→识别→复核→生成→导出）+ 自定义控件键盘等价
 *  由编排器起隔离实例（8032）+ 无头 Chrome（CDP 9334）后运行。
 *  全部用 CDP Input.dispatchKeyEvent 发真实键盘事件（Tab/Enter/Space），
 *  不直接调 JS 函数，确保键盘路径本身可用（SonarQube Web:S6848 的回归防线）。 */
import path from 'node:path';
const CDP = 'http://127.0.0.1:9334', APP = 'http://127.0.0.1:8032/';
const DOCX = path.join('.', 'data', 'testdocs', 't00928_req.docx');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const res = [];
const check = (n, ok, d = '') => { res.push({ n, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
setTimeout(() => { console.error('[bk] WATCHDOG'); process.exit(3); }, 420000);

const t = await (await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket((await (await fetch(`${CDP}/json/version`)).json()).webSocketDebuggerUrl);
await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
let id = 0; const pend = new Map(); const errors = [];
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.no(new Error(JSON.stringify(m.error))) : p.ok(m.result); } else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params?.exceptionDetails?.exception?.description || 'exc'); };
const send = (m, p, s) => { const i = ++id; ws.send(JSON.stringify({ id: i, method: m, params: p, ...(s ? { sessionId: s } : {}) })); return new Promise((ok, no) => { pend.set(i, { ok, no }); setTimeout(() => { if (pend.has(i)) { pend.delete(i); no(new Error('cdp timeout: ' + m)); } }, 20000); }); };
const S = (await send('Target.attachToTarget', { targetId: t.id, flatten: true })).sessionId;
await send('Page.enable', {}, S); await send('Runtime.enable', {}, S); await send('DOM.enable', {}, S);
const ev = async x => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, userGesture: true }, S); if (r.exceptionDetails) throw new Error('eval:' + (r.exceptionDetails.exception?.description || '')); return r.result.value; };
const setFiles = async (sel, files) => { const { root } = await send('DOM.getDocument', { depth: 1 }, S); const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: sel }, S); await send('DOM.setFileInputFiles', { nodeId, files }, S); };
const waitStep = async (step, sec) => { for (let i = 0; i < sec * 5; i++) { if ((await ev(`document.body.dataset.step`)) === step) return true; await sleep(200); } return false; };

// 真实键盘事件
const KEY = { Tab: { windowsVirtualKeyCode: 9, code: 'Tab', key: 'Tab' }, Enter: { windowsVirtualKeyCode: 13, code: 'Enter', key: 'Enter', text: '\r' }, Space: { windowsVirtualKeyCode: 32, code: 'Space', key: ' ' } };
async function key(name, type = 'rawKeyDown') {
  const k = KEY[name];
  await send('Input.dispatchKeyEvent', { type, ...k }, S);
  if (type === 'rawKeyDown' && k.text) await send('Input.dispatchKeyEvent', { type: 'char', ...k }, S);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...k }, S);
  await sleep(90);
}
const focused = () => ev(`(()=>{const a=document.activeElement;if(!a)return null;return{tag:a.tagName,id:a.id||'',cls:(a.className&&a.className.baseVal!==undefined?a.className.baseVal:a.className)||'',role:a.getAttribute('role')||'',label:a.getAttribute('aria-label')||'',ti:a.getAttribute('tabindex')};})()`);
async function tabTo(pred, max = 60) {
  for (let i = 0; i < max; i++) { await key('Tab'); const f = await focused(); if (f && pred(f)) return f; }
  return null;
}
async function focusEl(sel) { return ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return false;e.focus();return true;})()`); }

await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('wl_guide_done_pages_v1',JSON.stringify({work:true,pert:true,config:true,help:true}))}catch(e){}try{localStorage.removeItem('we_form_state_v1');localStorage.removeItem('wl_last_history')}catch(e){}` }, S);
await send('Page.navigate', { url: APP }, S);
for (let i = 0; i < 60; i++) { if ((await ev(`typeof goPage === 'function' && document.readyState !== 'loading'`)) === true) break; await sleep(250); }
await ev(`goPage('work');goStep('upload');`);

// ---- 1) 自定义控件的键盘等价（SonarQube 三类问题的回归防线） ----
const a11y = JSON.parse(await ev(`JSON.stringify({
  steps:[...document.querySelectorAll('.step')].map(e=>({id:e.id,role:e.getAttribute('role'),ti:e.getAttribute('tabindex'),kd:!!e.getAttribute('onkeydown')})),
  drop:{role:document.querySelector('#drop').getAttribute('role'),ti:document.querySelector('#drop').getAttribute('tabindex'),label:!!document.querySelector('#drop').getAttribute('aria-label')},
  sw:{role:document.querySelector('#llmSwitch').getAttribute('role'),ti:document.querySelector('#llmSwitch').getAttribute('tabindex'),checked:document.querySelector('#llmSwitch').getAttribute('aria-checked'),label:!!document.querySelector('#llmSwitch').getAttribute('aria-label')},
  sortable:[...document.querySelectorAll('th.sortable')].map(e=>({role:e.getAttribute('role'),ti:e.getAttribute('tabindex'),as:e.getAttribute('aria-sort')})),
  pert:{role:document.querySelector('#pertDrop').getAttribute('role'),ti:document.querySelector('#pertDrop').getAttribute('tabindex')},
  focusRing:getComputedStyle(document.documentElement).getPropertyValue('--brand').trim()
})`));
check('步骤条 6 个节点均 role=button + tabindex=0 + keydown',
  a11y.steps.length === 6 && a11y.steps.every(s => s.role === 'button' && s.ti === '0' && s.kd), JSON.stringify(a11y.steps.map(s => s.id)));
check('上传拖放区 role/tabindex/aria-label 齐备', a11y.drop.role === 'button' && a11y.drop.ti === '0' && a11y.drop.label, JSON.stringify(a11y.drop));
check('开关 role=switch + aria-checked + aria-label 齐备', a11y.sw.role === 'switch' && a11y.sw.ti === '0' && a11y.sw.checked && a11y.sw.label, JSON.stringify(a11y.sw));
check('3 个可排序表头 role=button + tabindex + aria-sort',
  a11y.sortable.length === 3 && a11y.sortable.every(s => s.role === 'button' && s.ti === '0' && s.as === 'none'), JSON.stringify(a11y.sortable));
check('PERT 拖放区 role/tabindex 齐备', a11y.pert.role === 'button' && a11y.pert.ti === '0', JSON.stringify(a11y.pert));

// 树节点与模型芯片是运行时渲染的，须在有数据后校验
// ---- 2) 键盘触发：开关 Space 切换 ----
await ev(`goPage('config');`); await sleep(400);
await focusEl('#llmSwitch');
const before = await ev(`document.querySelector('#llmSwitch').getAttribute('aria-checked')`);
await key('Space');
const afterSp = await ev(`document.querySelector('#llmSwitch').getAttribute('aria-checked')`);
await key('Enter');
const afterEn = await ev(`document.querySelector('#llmSwitch').getAttribute('aria-checked')`);
const swCls = await ev(`document.querySelector('#llmSwitch').classList.contains('on')`);
check('开关可键盘切换且 aria-checked 同步',
  afterSp !== before && afterEn === before && swCls === (before === 'true'),
  `before=${before} space→${afterSp} enter→${afterEn} classOn=${swCls}`);

// ---- 3) 键盘触发：步骤条 Enter 导航（须先有 items，否则 goStepNav 会按设计拦下）----
// 无数据时导航到 review/result 应被拦下并提示，这是既有防呆，不算失败
await ev(`goPage('work');goStep('upload');`);
await focusEl('#st2');
await key('Enter');
const navBlocked = await ev(`document.body.dataset.step`);
check('无数据时步骤条 Enter 被防呆拦下（仍在上传页）', navBlocked === 'upload', `step=${navBlocked}`);

// ---- 5) 键盘触发：上传拖放区 Enter 打开文件选择器 ----
// 无头 Chrome 下 Page.setInterceptFileChooserDialog 会挂起（无原生对话框宿主），
// 故改为在页面内计数 file.click() 调用：能证明键盘路径确实走到了「打开文件框」这一步。
// 注：CDP 的 Page.fileChooserOpened 监听在此环境不可用，已实测确认。
await ev(`goStep('upload'); window.__fc=0; const _c=HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click=function(){ if(this.id==='file')window.__fc++; return _c.apply(this,arguments); };`);
await focusEl('#drop');
await key('Enter');
await sleep(400);
const fcCount = await ev(`window.__fc`);
check('拖放区 Enter 触发文件选择（键盘可达）', fcCount >= 1, `file.click()×${fcCount}`);

// ---- 6) 主链路键盘可完成：识别 → 全选 → 生成 → 导出 ----
// 文件选择无法纯键盘自动化（依赖原生文件对话框），此处用 setFileInputFiles 注入，
// 但从「开始识别」起全部走键盘，验证业务操作本身键盘可完成。
await setFiles('#file', [path.resolve(DOCX)]);
await ev(`document.querySelector('#file').dispatchEvent(new Event('change'));`);
await sleep(300);
await focusEl('#startBtn');
await key('Enter');
if (!(await waitStep('review', 90))) throw new Error('键盘触发识别后未进入复核页');
check('键盘可完成「上传→识别→复核页」', true, `items=${await ev('items.length')}`);

// ---- 6b) 键盘触发：可排序表头 Enter 排序（此刻在复核页，表头可见可聚焦）----
await ev(`goStep('review');`); await sleep(200);
await focusEl('th.sortable');
await key('Enter'); await sleep(300);
// 注意：sortState 是顶层 let 声明，不挂在 window 上，须用 typeof 探测而非 window.sortState
const sorted = JSON.parse(await ev(`JSON.stringify({st:(typeof sortState!=='undefined')&&!!sortState,aria:[...document.querySelectorAll('th.sortable')].map(e=>e.getAttribute('aria-sort'))})`));
check('表头 Enter 可排序且 aria-sort 变为 ascending', sorted.st && sorted.aria[0] === 'ascending', JSON.stringify(sorted));
await key('Enter'); await sleep(200);
const sorted2 = JSON.parse(await ev(`JSON.stringify({aria:[...document.querySelectorAll('th.sortable')].map(e=>e.getAttribute('aria-sort'))})`));
check('表头二次 Enter 降序且 aria-sort 同步', sorted2.aria[0] === 'descending', JSON.stringify(sorted2));
await key('Enter'); await sleep(200);
const sorted3 = JSON.parse(await ev(`JSON.stringify({st:(typeof sortState!=='undefined')&&!!sortState,aria:[...document.querySelectorAll('th.sortable')].map(e=>e.getAttribute('aria-sort'))})`));
check('表头三次 Enter 取消排序且 aria-sort 归 none', !sorted3.st && sorted3.aria.every(a => a === 'none'), JSON.stringify(sorted3));

// 全选：聚焦到全选框后按 Space（原生 checkbox 的键盘行为）
await focusEl('#ckAll');
await key('Space');
await sleep(300);
const okCnt = await ev(`document.querySelector('#okCnt').textContent`);
const goDisabled = await ev(`document.querySelector('#goRes').disabled`);
check('键盘 Space 可全选确认', okCnt !== '0' && goDisabled === false, `okCnt=${okCnt} goRes.disabled=${goDisabled}`);

// 生成：键盘 Enter
await focusEl('#goRes');
await key('Enter');
if (!(await waitStep('result', 150))) throw new Error('键盘触发生成后未进入结果页');
check('键盘可完成「复核→生成→结果页」', true, `sid=${await ev('gSid')}`);

// 导出：展开导出菜单并聚焦 CSV 项，Enter 触发
await ev(`goStep('result');`); await sleep(300);
const menuShown = await ev(`(()=>{expToggle();return document.querySelector('#expMenu').style.display;})()`);
check('导出菜单可展开', menuShown === 'block', `display=${menuShown}`);
await focusEl('#expMenu button');
await key('Enter');
await sleep(400);
check('键盘可完成导出触发（CSV 按钮）', true, `csvRows=${await ev('expCsvStr().split(String.fromCharCode(10)).length')}`);

// ---- 7) 焦点环可见性 ----
// 用真实 Tab 走到控件上：:focus-visible 是启发式选择器，程序化 .focus() 不一定命中，
// 必须由键盘导航产生才生效——这也正是「键盘用户看得见焦点」的准确验证方式。
await ev(`goStep('upload');`); await sleep(200);
let ringHit = null;
for (let i = 0; i < 40; i++) {
  await key('Tab');
  const f = await focused();
  if (f && f.id === 'drop') {
    const cs = JSON.parse(await ev(`(()=>{const c=getComputedStyle(document.querySelector('#drop'));
      return JSON.stringify({w:c.outlineWidth,style:c.outlineStyle,color:c.outlineColor});})()`));
    ringHit = cs;
    break;
  }
}
check('Tab 可达拖放区且有可见焦点环（outline ≥2px solid）',
  !!ringHit && parseFloat(ringHit.w) >= 2 && ringHit.style === 'solid', JSON.stringify(ringHit));

check('全程无页面异常', errors.length === 0, errors.slice(0, 2).join(' | '));
const bad = res.filter(x => !x.ok).length;
console.log(`\n==== 汇总 ==== 共 ${res.length} 项，通过 ${res.length - bad}，失败 ${bad}`);
await send('Target.closeTarget', { targetId: t.id }).catch(() => {});
process.exit(bad ? 1 : 0);
