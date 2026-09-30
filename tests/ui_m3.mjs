/** W011 联调：驳回流全链路（UI 沉淀→规则生效）+ 配置中心规则页编辑 + Excel 语义粘贴 */
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
const send = (m, p, s) => { const i = ++id; ws.send(JSON.stringify({ id: i, method: m, params: p, ...(s ? { sessionId: s } : {}) })); return new Promise((ok, no) => { pend.set(i, { ok, no }); setTimeout(() => { if (pend.has(i)) { pend.delete(i); no(new Error('cdp timeout: ' + m)); } }, 15000); }); };
const S = (await send('Target.attachToTarget', { targetId: t.id, flatten: true })).sessionId;
await send('Page.enable', {}, S); await send('Runtime.enable', {}, S); await send('DOM.enable', {}, S);
const ev = async x => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, userGesture: true }, S); if (r.exceptionDetails) throw new Error('eval:' + (r.exceptionDetails.exception?.description || '')); 
return r.result.value; };
const setFiles = async (sel, files) => { const { root } = await send('DOM.getDocument', { depth: 1 }, S); const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: sel }, S); await send('DOM.setFileInputFiles', { nodeId, files }, S); };
const waitStep = async (step, sec) => { for (let i = 0; i < sec * 5; i++) { if ((await ev(`document.body.dataset.step`)) === step) return true; 
await sleep(200); } return false; };
const TAB = String.fromCodePoint(9);

await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('wl_guide_done_pages_v1',JSON.stringify({work:true,pert:true,config:true,help:true}))}catch(e){}try{localStorage.removeItem('we_form_state_v1');localStorage.removeItem('wl_last_history')}catch(e){}` }, S);
await send('Page.navigate', { url: APP }, S); await sleep(2500);
await ev(`goPage('work'); goStep('upload');`);
await setFiles('#file', [path.resolve(DOCX)]);
await ev(`document.querySelector('#startBtn').click();`);
if (!(await waitStep('review', 60))) throw new Error('识别后未进入复核页');
const n0 = await ev(`items.length`);

// 驳回流全链路（UI）：改类型偏离 → 沉淀（prompt 打桩）→ 规则保存 → 再识别生效
const it0 = JSON.parse(await ev(`JSON.stringify({seq:items[0].seq,type:items[0].type,desc:items[0].desc.slice(0,8)})`));
const toType = it0.type === 'EI' ? 'EO' : 'EI';
await ev(`items[0]._ai={type:items[0].type,reuse:items[0].reuse,modify:items[0].modify};`);
await ev(`(()=>{const tr=document.querySelector('#tbody tr[data-seq="'+items[0].seq+'"]');const s=tr.querySelector('[data-k=type]');s.value='${toType}';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
const rej = JSON.parse(await ev(`JSON.stringify({q:rejQueue.length})`));
check('行内驳回进入队列', rej.q >= 1, `queue=${rej.q}`);
await ev(`window.prompt=()=>'${it0.desc}'`);   // 打桩：沉淀弹层关键词=首条描述前 8 字
await ev(`settleRules()`);
let rules1 = null;
for (let i = 0; i < 15; i++) {   // 等待沉淀保存完成（避免与后续 rulesSave 并发互踩）
  await sleep(300);
  rules1 = await (await fetch(APP + '/api/rules')).json();
  if ((rules1.rules || []).some(r => r.source === 'feedback')) break;
}
if (!rules1) rules1 = await (await fetch(APP + '/api/rules')).json();
const fbRule = (rules1.rules || []).find(r => r.source === 'feedback');
check('UI 沉淀生成 feedback 规则', rules1.ok && !!fbRule, fbRule ? `${fbRule.id} pat=${JSON.stringify(fbRule.patterns)}` : '无');
check('沉淀规则类型与驳回一致', fbRule && fbRule.type === toType, fbRule ? fbRule.type : '-');

// 再识别：驳回的关键词按新规则判定
await ev(`goStep('upload')`);
await setFiles('#file', [path.resolve(DOCX)]);
await ev(`document.querySelector('#startBtn').click();`);
if (!(await waitStep('review', 60))) throw new Error('再识别未进入复核页');
const hit = JSON.parse(await ev(`JSON.stringify({found:items.some(x=>x.type==='${toType}'&&x.desc.slice(0,8)==='${it0.desc}'),meta:items.length})`));
check('再识别后驳回样本类型按沉淀规则判定', hit.found, `type=${toType}`);

// 配置中心规则页：加载/编辑/保存
await ev(`goPage('config')`);
await sleep(500);
const cfg = JSON.parse(await ev(`JSON.stringify({rows:document.querySelectorAll('#rulesRows tr').length,meta:document.querySelector('#rulesMeta').textContent})`));
check('配置中心规则页加载', cfg.rows >= 6, `rows=${cfg.rows} ${cfg.meta}`);
await ev(`(()=>{const tr=[...document.querySelectorAll('#rulesRows tr')].find(t=>t.querySelector('[data-rk=id]').value==='R-EQ');tr.querySelector('[data-rk=priority]').value='85';})()`);
await ev(`window.__saveLog=[];const _f=window.fetch;window.fetch=function(){const p=arguments[0];return _f.apply(this,arguments).then(resp=>{if(String(p).includes('/api/rules/save')){const c=resp.clone();c.json().then(j=>window.__saveLog.push({status:resp.status,body:j})).catch(()=>{});}return resp;});};`);
await ev(`rulesSave()`);
await sleep(600);
const saveLog = await ev(`JSON.stringify(window.__saveLog||[])`);
console.log('[saveLog]', saveLog.slice(0, 200));
const rules2 = await (await fetch(APP + '/api/rules')).json();
const rEQ = (rules2.rules || []).find(r => r.id === 'R-EQ');
check('配置中心修改优先级保存生效', rEQ && rEQ.priority === 85, `priority=${rEQ?.priority}`);

// Excel 语义粘贴：TSV（Excel 复制格式）
await ev(`goPage('work'); goStep('review')`);
await ev(`document.querySelector('#pasteText').value=['新系统B,模块Y,支持名单筛选导出,名单筛选,EI,中,新增','新系统B,模块Y,名单结果统计报表,统计报表,EO,低,新增'].join(String.fromCharCode(10));pasteParse();`);
await ev(`pasteApply();`);
const pasted = JSON.parse(await ev(`JSON.stringify(items.slice(-2).map(x=>({sys:x.system,t:x.type})))`));
check('粘贴导入 2 行（联调环境）', pasted.length === 2 && pasted.every(x => x.sys === '新系统B'), JSON.stringify(pasted));
check('全程无页面异常', errors.length === 0, errors.slice(0, 2).join(' | '));
const bad = res.filter(x => !x.ok).length;
console.log(`\n==== 汇总 ==== 共 ${res.length} 项，通过 ${res.length - bad}，失败 ${bad}`);
await send('Target.closeTarget', { targetId: t.id }).catch(() => {});
process.exit(bad ? 1 : 0);
