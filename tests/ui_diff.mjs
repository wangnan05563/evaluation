/** FR-FE05 版本 diff 对比 UI 验证（勾选两版 → 三色高亮 + ΔUS + 导出串）
 *  由编排器起隔离实例（端口 8032）+ 无头 Chrome（CDP 9334）后运行；自身不认业务夹具，
 *  数据来自 /api/generate 两次（v2 改复杂度/删一条/加一条），再走真实 UI 勾选渲染路径。 */
const CDP = 'http://127.0.0.1:9334', APP = 'http://127.0.0.1:8032/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const res = [];
const check = (n, ok, d = '') => { res.push({ n, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
setTimeout(() => { console.error('[bk] WATCHDOG'); process.exit(3); }, 420000);

const post = async (p, body) => (await fetch(APP + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();

// ---- 造数据：识别一次，生成两版（v2 = 改 1 条 cx、删末条、加 1 条新系统功能点） ----
const docB64 = (await import('node:fs')).readFileSync('data/testdocs/t00928_req.docx').toString('base64');
const rec = await post('/api/recognize', { name: 't00928_req.docx', b64: docB64, job: 'fdiffrec' });
if (!rec.ok) { console.error('识别失败: ' + JSON.stringify(rec).slice(0, 200)); process.exit(1); }
const h1 = rec.items.map(it => ({ ...it, cx: '中', ok: true }));
const g1 = await post('/api/generate', { items: rec.items, method: '估算功能点', title: 'FR-FE05 Diff 验证', job: 'fdiffg1', hist_items: h1 });
if (!g1.ok || !g1.history_id) { console.error('生成 v1 失败: ' + JSON.stringify(g1).slice(0, 200)); process.exit(1); }
const h2 = h1.slice(1).map(x => ({ ...x }));
// changed：同一条同时改 cx（仅影响前端口径）与 reuse（影响后端口径）→ 覆盖多字段变更与 ΔUS
h2[0].cx = '低';
h2[0].reuse = '高';
h2.push({ ...h1[0], desc: 'DIFF新增功能点', system: 'DIFF新增系统' });
const grp = (await (await fetch(`${APP}/api/history/${g1.history_id}/group`)).json()).versions[0].version_group;
const g2 = await post('/api/generate', { items: rec.items, method: '估算功能点', title: 'FR-FE05 Diff 验证', job: 'fdiffg2', hist_items: h2, reopen_group: grp });
if (!g2.ok || !g2.history_id) { console.error('生成 v2 失败: ' + JSON.stringify(g2).slice(0, 200)); process.exit(1); }
// 第三条记录（独立版本组，仅用于验证「勾第 3 个时只保留最近两个」的上限交互）
const g3 = await post('/api/generate', { items: rec.items, method: '估算功能点', title: 'FR-FE05 上限验证', job: 'fdiffg3', hist_items: h1 });
if (!g3.ok || !g3.history_id) { console.error('生成第三版失败: ' + JSON.stringify(g3).slice(0, 200)); process.exit(1); }

// ---- CDP ----
const t = await (await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket((await (await fetch(`${CDP}/json/version`)).json()).webSocketDebuggerUrl);
await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
let id = 0; const pend = new Map(); const errors = [];
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.no(new Error(JSON.stringify(m.error))) : p.ok(m.result); } else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params?.exceptionDetails?.exception?.description || 'exc'); };
const send = (m, p, s) => { const i = ++id; ws.send(JSON.stringify({ id: i, method: m, params: p, ...(s ? { sessionId: s } : {}) })); return new Promise((ok, no) => { pend.set(i, { ok, no }); setTimeout(() => { if (pend.has(i)) { pend.delete(i); no(new Error('cdp timeout: ' + m)); } }, 20000); }); };
const S = (await send('Target.attachToTarget', { targetId: t.id, flatten: true })).sessionId;
await send('Page.enable', {}, S); await send('Runtime.enable', {}, S); await send('DOM.enable', {}, S);
const ev = async x => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, userGesture: true }, S); if (r.exceptionDetails) throw new Error('eval:' + (r.exceptionDetails.exception?.description || '')); return r.result.value; };

await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('wl_guide_done_pages_v1',JSON.stringify({work:true,pert:true,config:true,help:true}))}catch(e){}try{localStorage.removeItem('we_form_state_v1');localStorage.removeItem('wl_last_history')}catch(e){}` }, S);
await send('Page.navigate', { url: APP }, S);
for (let i = 0; i < 60; i++) { if ((await ev(`typeof goPage === 'function' && document.readyState !== 'loading'`)) === true) break; await sleep(250); }
await ev(`goPage('work'); histOpen();`);
for (let i = 0; i < 40; i++) { if (await ev(`!!document.querySelector('#histRows .hdif')`)) break; await sleep(200); }

// ---- 历史列表：勾选列 + v2 版本号 ----
const list = JSON.parse(await ev(`JSON.stringify({rows:document.querySelectorAll('#histRows tr[data-hid]').length,cks:document.querySelectorAll('#histRows .hdif').length,all:!!document.querySelector('#hdifAll'),btn:(document.querySelector('#hdifBtn')||{}).disabled})`));
check('历史列表每行带对比勾选框', list.rows >= 2 && list.cks === list.rows, `rows=${list.rows} cks=${list.cks}`);
check('表头有全选框 + 对比按钮初始禁用', list.all === true && list.btn === true, JSON.stringify(list));

// 只勾 1 条 → 按钮仍禁用
await ev(`document.querySelectorAll('#histRows .hdif')[0].click();`);
const one = await ev(`JSON.stringify({sel:diffSel.length,btn:document.querySelector('#hdifBtn').disabled,txt:document.querySelector('#hdifBtn').textContent})`);
check('仅选 1 个时按钮保持禁用', JSON.parse(one).sel === 1 && JSON.parse(one).btn === true, one);

// 勾第 2 条（v1）→ 按钮解禁
await ev(`document.querySelectorAll('#histRows .hdif')[1].click();`);
const two = JSON.parse(await ev(`JSON.stringify({sel:diffSel.length,btn:document.querySelector('#hdifBtn').disabled,txt:document.querySelector('#hdifBtn').textContent})`));
check('选满 2 个后按钮解禁', two.sel === 2 && two.btn === false && /2\/2/.test(two.txt), `txt=${two.txt.trim()}`);

// 勾第 3 条 → 仅保留最近两个（前面的自动取消）
await ev(`document.querySelectorAll('#histRows .hdif')[2].click();`);
const three = JSON.parse(await ev(`JSON.stringify({sel:diffSel.length,first:diffSel[0],second:diffSel[1],last:(document.querySelectorAll('#histRows tr[data-hid]')[2]||{}).dataset?document.querySelectorAll('#histRows tr[data-hid]')[2].dataset.hid:''})`));
check('超过 2 个只保留最近两个', three.sel === 2 && three.second === three.last, JSON.stringify(three));

// 全选框 → 清空
await ev(`document.querySelector('#hdifAll').click();`);
const cleared = JSON.parse(await ev(`JSON.stringify({sel:diffSel.length,btn:document.querySelector('#hdifBtn').disabled,checked:[...document.querySelectorAll('#histRows .hdif')].filter(c=>c.checked).length})`));
check('全选框可一键清空选择', cleared.sel === 0 && cleared.btn === true && cleared.checked === 0, JSON.stringify(cleared));

// 按 id 指定 a=v1（基准）、b=v2（对比），验证渲染与列表顺序解耦
await ev(`histDiffAll(true);
  diffSel=['${g1.history_id}','${g2.history_id}'];
  document.querySelector('#histRows tr[data-hid="${g1.history_id}"] .hdif').checked=true;
  document.querySelector('#histRows tr[data-hid="${g2.history_id}"] .hdif').checked=true;`);
await ev(`histDiff();`);
for (let i = 0; i < 40; i++) { if (await ev(`!!document.querySelector('#histDiff table')`)) break; await sleep(200); }

// ---- 渲染结果 ----
const d = JSON.parse(await ev(`JSON.stringify({ok:lastDiff&&lastDiff.ok,sum:lastDiff&&lastDiff.summary,disp:document.querySelector('#histDiff').style.display,add:document.querySelectorAll('#histDiff .b-add').length,del:document.querySelectorAll('#histDiff .b-del').length,chg:document.querySelectorAll('#histDiff .b-chg').length,rows:document.querySelectorAll('#histDiff tbody tr').length,sumTxt:(document.querySelector('#histDiff .diff-sum')||{}).textContent||'',dus:(document.querySelector('#histDiff .diff-sum')||{}).textContent?.match(/ΔUS [+-]?[\\d.]+/)||['']})`));
check('diff 面板显示且数据正确', d.ok === true && d.disp === 'block' && JSON.stringify(d.sum) === JSON.stringify({ added: 1, removed: 1, changed: 1 }), JSON.stringify(d.sum));
check('三色徽标齐全（新增/删除/变更）', d.add >= 2 && d.del >= 2 && d.chg >= 2, `add=${d.add} del=${d.del} chg=${d.chg}`);
// ΔUS 取后端 summary.us_total（engine 口径：US 只由 type/reuse/modify 决定，cx 不参与），
// 故此处改 reuse 才会产生差额；cx 变更只体现在字段级高亮。
const delta = parseFloat(String(d.dus[0]).replace('ΔUS ', ''));
check('ΔUS 非零且方向正确（reuse 中→高 → US 下降）', /ΔUS/.test(d.dus[0]) && delta < 0, `ΔUS=${d.dus[0]}`);

// 变更行高亮 old→new（一条里 cx 与 reuse 两个字段都应出现）
const chg2 = JSON.parse(await ev(`JSON.stringify({old:[...document.querySelectorAll('#histDiff .d-changed .old')].map(e=>e.textContent),neu:[...document.querySelectorAll('#histDiff .d-changed .new')].map(e=>e.textContent),txt:(document.querySelector('#histDiff .d-changed')||{}).textContent||''})`));
check('变更行含 cx 中→低 且 old/new 高亮', chg2.old.includes('中') && chg2.neu.includes('低')
  && /复杂度/.test(chg2.txt) && /重用度/.test(chg2.txt), `${chg2.old.join('/')}→${chg2.neu.join('/')}`);

// ---- 导出三格式 ----
const exp = JSON.parse(await ev(`(()=>{window.__dl=null;const _o=window._dl;window._dl=(n,c,m)=>{window.__dl={n,c,m};};
  histDiffExp('csv');const csv=window.__dl;window.__dl=null;histDiffExp('json');const js=window.__dl;window.__dl=null;histDiffExp('md');const md=window.__dl;window._dl=_o;
  return JSON.stringify({csv:csv&&{n:csv.n,m:csv.m,head:csv.c.slice(0,40),bom:csv.c.charCodeAt(0)===0xFEFF,lines:csv.c.split(String.fromCharCode(10)).length,hasKinds:/新增/.test(csv.c)&&/删除/.test(csv.c)&&/变更/.test(csv.c)},
    js:js&&{n:js.n,ok:JSON.parse(js.c).ok,sum:JSON.parse(js.c).summary},md:md&&{n:md.n,secs:/## 新增/.test(md.c)&&/## 删除/.test(md.c)&&/## 变更/.test(md.c),dus:/US/.test(md.c)}});})()`));
check('CSV 导出（含 BOM/表头/三类型）', exp.csv && exp.csv.bom && exp.csv.head.replace(/^﻿/, '').startsWith('类型,功能点,系统') && exp.csv.hasKinds && exp.csv.lines >= 4, JSON.stringify(exp.csv));
check('JSON 导出（结构完整）', exp.js && exp.js.ok === true && exp.js.sum.changed === 1, JSON.stringify(exp.js));
check('Markdown 导出（三段小节）', exp.md && exp.md.secs && exp.md.dus, JSON.stringify(exp.md));

// ---- 同版本自比：无差异提示（先清空面板，避免读到上一轮渲染结果） ----
await ev(`document.getElementById('histDiff').style.display='none'; document.getElementById('histDiff').innerHTML='';`);
await ev(`diffSel=['${g1.history_id}','${g1.history_id}'];histDiff();`);
for (let i = 0; i < 30; i++) { if (await ev(`!!document.querySelector('#histDiff table')`)) break; await sleep(200); }
const same = await ev(`(document.querySelector('#histDiff tbody')||{}).textContent||''`);
check('同版本对比提示无差异', /完全一致/.test(same), same.slice(0, 40));

// ---- 缺参保护：只选 1 个不发起请求 ----
await ev(`histDiffAll(true); document.querySelectorAll('#histRows .hdif')[0].click(); window.__fetchLog=[]; const _f=window.fetch; window.fetch=function(u){window.__fetchLog.push(String(u));return _f.apply(this,arguments);};`);
await ev(`histDiff();`);
const guarded = JSON.parse(await ev(`JSON.stringify({log:window.__fetchLog.filter(x=>x.includes('/api/history/diff')),sel:diffSel.length})`));
check('未选满 2 个时不请求后端', guarded.sel === 1 && guarded.log.length === 0, JSON.stringify(guarded));

check('全程无页面异常', errors.length === 0, errors.slice(0, 2).join(' | '));
const bad = res.filter(x => !x.ok).length;
console.log(`\n==== 汇总 ==== 共 ${res.length} 项，通过 ${res.length - bad}，失败 ${bad}`);
await send('Target.closeTarget', { targetId: t.id }).catch(() => {});
process.exit(bad ? 1 : 0);
