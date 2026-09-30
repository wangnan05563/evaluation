/** W006 验证：四图渲染 + 导出管线（CSV/MD/PDF） */
import path from 'node:path';
import fs from 'node:fs';
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
const send = (m, p, s, tmo = 30000) => { const i = ++id; ws.send(JSON.stringify({ id: i, method: m, params: p, ...(s ? { sessionId: s } : {}) })); return new Promise((ok, no) => { pend.set(i, { ok, no }); setTimeout(() => { if (pend.has(i)) { pend.delete(i); no(new Error('cdp timeout: ' + m)); } }, tmo); }); };
const S = (await send('Target.attachToTarget', { targetId: t.id, flatten: true })).sessionId;
await send('Page.enable', {}, S); await send('Runtime.enable', {}, S); await send('DOM.enable', {}, S);
const ev = async x => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, userGesture: true }, S); if (r.exceptionDetails) throw new Error('eval:' + (r.exceptionDetails.exception?.description || '')); 
return r.result.value; };
const setFiles = async (sel, files) => { const { root } = await send('DOM.getDocument', { depth: 1 }, S); const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: sel }, S); await send('DOM.setFileInputFiles', { nodeId, files }, S); };
const waitStep = async (step, sec) => { for (let i = 0; i < sec * 5; i++) { if ((await ev(`document.body.dataset.step`)) === step) return true; 
await sleep(200); } return false; };

// echarts 静态资源可达性
const stat = await fetch(APP + '/static/echarts.min.js');
check('/static/echarts.min.js 可访问', stat.ok && +(stat.headers.get('content-length') || 0) > 500000, `status=${stat.status}`);

await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('wl_guide_done_pages_v1',JSON.stringify({work:true,pert:true,config:true,help:true}))}catch(e){}try{localStorage.removeItem('we_form_state_v1');localStorage.removeItem('wl_last_history')}catch(e){}` }, S);
await send('Page.navigate', { url: APP }, S); await sleep(2500);
await ev(`goPage('work'); goStep('upload');`);
await setFiles('#file', [path.resolve(DOCX)]);
await ev(`document.querySelector('#startBtn').click();`);
if (!(await waitStep('review', 60))) throw new Error('识别后未进入复核页');
await ev(`(()=>{const c=document.querySelector('#ckAll');c.checked=true;c.dispatchEvent(new Event('change'));})()`);
await sleep(300);
await ev(`document.querySelector('#goRes').click();`);
if (!(await waitStep('result', 120))) throw new Error('生成后未进入结果页');
check('生成完成并进入结果页', true);

// 图表渲染断言
const st = JSON.parse(await ev(`JSON.stringify({ech:typeof echarts!=="undefined",keys:Object.keys(_charts),canvas:document.querySelectorAll('#chartGrid canvas').length,items:items.length})`));
check('echarts 本地化已加载', st.ech, '');
check('四图实例就绪（_charts 4 键）', st.keys.length === 4, st.keys.join(','));
check('图表画布已渲染', st.canvas >= 4, `canvas=${st.canvas}`);

// 明细联动：改一条描述后重进结果页 → 图表实例重建
await ev(`goStep('review');items[0].desc+='（联动修订）';`);
await ev(`(()=>{const c=document.querySelector('#ckAll');c.checked=true;c.dispatchEvent(new Event('change'));})()`);
await sleep(300);
await ev(`document.querySelector('#goRes').click();`);
if (!(await waitStep('result', 120))) throw new Error('再次生成未进入结果页');
const st2 = JSON.parse(await ev(`JSON.stringify({keys:Object.keys(_charts),canvas:document.querySelectorAll('#chartGrid canvas').length})`));
check('明细变更后图表重建（dispose 生效）', st2.keys.length === 4 && st2.canvas >= 4, st2.keys.join(','));

// CSV 字符串：字段与行数
const csv = JSON.parse(await ev(`JSON.stringify({rows:expCsvStr().split(String.fromCharCode(10)).length,head:expCsvStr().slice(0,4),first:expCsvStr().includes(String.fromCharCode(34)+'1'+String.fromCharCode(34)+','+String.fromCharCode(34)),n:items.length})`));
check('CSV 含表头/全量行/引号数据行', csv.rows >= csv.n + 1 && csv.head === 'seq,' && csv.first, `rows=${csv.rows} items=${csv.n}`);

// MD 字符串：KPI + Top10
const md = JSON.parse(await ev(`JSON.stringify({title:expMdStr().split(String.fromCharCode(10))[0],hasKpi:/未调整功能点/.test(expMdStr()),hasTop:/Top10/.test(expMdStr())})`));
check('Markdown 摘要含 KPI 与 Top10', md.hasKpi && md.hasTop, md.title);

// 导出菜单交互
await ev(`expToggle()`);
await sleep(200);
const menuOn = await ev(`document.querySelector('#expMenu').style.display`);
check('导出菜单可开合', menuOn === 'block', '');

// 打印管线：printToPDF 渲染（@media print 生效）并落盘
const pdf = await send('Page.printToPDF', { printBackground: true, preferCSSPageSize: false }, S, 60000); // Chrome 153 打印渲染偏慢（T01366 实测 16~30s+），单独放宽
const buf = Buffer.from(pdf.data, 'base64');
fs.writeFileSync('logs/_w006_report.pdf', buf);
check('printToPDF 产出报告 PDF', buf.length > 20000, `${(buf.length / 1024).toFixed(0)} KB → logs/_w006_report.pdf`);
const pdfText = buf.toString('latin1');
check('PDF 含数据内容（非空白）', /未调整|工作量|US|FP/.test(pdfText), '');

// 截图留档
const shot = await send('Page.captureScreenshot', { format: 'png' }, S);
fs.writeFileSync('logs/_w006_charts.png', Buffer.from(shot.data, 'base64'));
check('全程无页面异常', errors.length === 0, errors.slice(0, 2).join(' | '));
const bad = res.filter(x => !x.ok).length;
console.log(`\n==== 汇总 ==== 共 ${res.length} 项，通过 ${res.length - bad}，失败 ${bad}`);
await send('Target.closeTarget', { targetId: t.id }).catch(() => {});
process.exit(bad ? 1 : 0);
