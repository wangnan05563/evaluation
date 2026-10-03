/**
 * T00927 UI 实测（CDP 直连无头 Chrome，隔离实例 8032）
 * 覆盖：进度条真实推进、按钮灰显、完成后跳转、失败兜底恢复
 * 运行：node logs/_t00927_ui_test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const CDP = 'http://127.0.0.1:9334';
const APP = 'http://127.0.0.1:8032/';
// T00931 之后默认走「异步补算公式缓存」，单次生成仅 ~1s，300ms 轮询自然只能看到 1~2 段；
// 故传 sync 参数（服务端 WE_RECALC_MODE=sync）时按原标准断言「≥4 段真实阶段」，
// 默认（async）只断言进度条可见且阶段数 ≥1 —— 阶段文案的真实性由 sync 那一轮保证。
const MODE = process.argv[2] || 'async';
const MIN_STAGES = MODE === 'sync' ? 4 : 1;
const DOCX = path.join('.', 'data', 'testdocs', 't00928_req.docx');   // 稳定夹具（temp 目录会被清理）
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (n, ok, d = '') => { results.push({ n, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };

const t = await (await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket((await (await fetch(`${CDP}/json/version`)).json()).webSocketDebuggerUrl);
await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
let id = 0; const pend = new Map(); const errors = [];
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.no(new Error(JSON.stringify(m.error))) : p.ok(m.result); }
  else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params?.exceptionDetails?.exception?.description || 'exception');
  else if (m.method === 'Runtime.consoleAPICalled') { const txt=(m.params.args||[]).map(a=>a.value??a.description??'').join(' '); if(txt.startsWith('[bk]')) console.log('[pg]', txt.slice(0,60)); }
};
const send = (method, params, sid) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params, ...(sid ? { sessionId: sid } : {}) })); return new Promise((ok, no) => { pend.set(i, { ok, no }); setTimeout(() => { if (pend.has(i)) { pend.delete(i); no(new Error('cdp timeout: ' + method)); } }, 15000); }); };
const S = (await send('Target.attachToTarget', { targetId: t.id, flatten: true })).sessionId;
await send('Page.enable', {}, S); await send('Runtime.enable', {}, S); await send('DOM.enable', {}, S); await send('Network.enable', {}, S);
const ev = async x => { console.error('[ev]', String(x).slice(0,50).replaceAll('\n',' ')); const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, userGesture: true }, S); if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || '')); 
return r.result.value; };
const shot = async n => { const r = await send('Page.captureScreenshot', { format: 'png' }, S); fs.writeFileSync(path.join('logs', n), Buffer.from(r.data, 'base64')); };
const setFiles = async (sel, files) => { const { root } = await send('DOM.getDocument', { depth: 1 }, S); const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: sel }, S); await send('DOM.setFileInputFiles', { nodeId, files }, S); };
const waitFor = async (fn, timeout = 60000, label = '') => { const t0 = Date.now(); while (Date.now() - t0 < timeout) { if (await fn()) return true; 
await sleep(150); } console.log('  !! timeout ' + label); return false; };

// 关闭首访引导遮罩（避免遮挡截图/交互取景）
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('wl_guide_done_pages_v1',JSON.stringify({work:true,pert:true,config:true,help:true}))}catch(e){}` }, S);
await send('Page.navigate', { url: APP }, S);
// T01481：等页面就绪（取代固定 2.5s，避免环境抖动误报为功能失败）
for (let i = 0; i < 60; i++) {
  if ((await ev(`typeof goPage === 'function' && document.readyState !== 'loading'`)) === true) break;
  await sleep(250);
}

// ---------- 准备：真实路径走到「审核功能点」并全选 ----------
await ev(`goPage('work'); goStep('upload');`);
await setFiles('#file', [DOCX]);
await sleep(600);
check('S0 上传后「上传文档开始识别」可用', (await ev(`document.querySelector('#startBtn').disabled`)) === false);
await ev(`document.querySelector('#startBtn').click();`);
const okReview = await waitFor(async () => (await ev(`document.body.dataset.step`)) === 'review', 40000, '识别完成');
check('S0 进入「审核功能点」页', okReview, 'waitFor 轮询确认');
await ev(`(()=>{const c=document.querySelector('#ckAll');c.checked=true;c.dispatchEvent(new Event('change'));})()`);
await sleep(400);
const n = await ev(`document.querySelectorAll('#tbody tr').length`);
check('S0 全部功能点已确认，按钮可点', (await ev(`document.querySelector('#goRes').disabled`)) === false, `功能点 ${n} 条`);
check('S1 点击前进度条隐藏', (await ev(`!document.querySelector('#genProg').classList.contains('on')`)) === true);

// ---------- S2 点击生成：进度条推进 + 按钮灰显 ----------
const t0 = Date.now();
await ev(`document.querySelector('#goRes').click();`);
await sleep(450);
const st1 = JSON.parse(await ev(`(()=>{const b=document.querySelector('#goRes'),p=document.querySelector('#genProg'),cs=getComputedStyle(b);
  return JSON.stringify({disabled:b.disabled,progOn:p.classList.contains('on'),opacity:cs.opacity,cursor:cs.cursor,
    boxOn:p.getBoundingClientRect().height>0,txt:document.querySelector('#genProgTxt').textContent,pct:document.querySelector('#genProgPct').textContent});})()`));
check('S2 按钮已灰显（disabled）', st1.disabled === true);
check('S2 灰显有明确视觉提示（opacity<1 且 not-allowed）', Number.parseFloat(st1.opacity) < 0.9 && st1.cursor === 'not-allowed', `opacity=${st1.opacity} cursor=${st1.cursor}`);
const stepAtSample = await ev(`document.body.dataset.step`);
check('S2 进度条已显示且占位（或生成已完成收起）', (st1.progOn === true && st1.boxOn === true) || stepAtSample === 'result', `${st1.pct} step=${stepAtSample}`);
await shot('_t00927_s2_progress.png');

const seq = [];
let jumped = false;
const deadline = Date.now() + 90000;
while (Date.now() < deadline) {
  const s = JSON.parse(await ev(`JSON.stringify({step:document.body.dataset.step,pct:document.querySelector('#genProgPct').textContent,txt:document.querySelector('#genProgTxt').textContent,on:document.querySelector('#genProg').classList.contains('on')})`));
  if (s.step === 'result') { jumped = true; break; }
  if (!seq.length || seq.at(-1).pct !== s.pct) seq.push({ pct: s.pct, txt: s.txt });
  await sleep(150);
}
const cost = ((Date.now() - t0) / 1000).toFixed(1);
console.log('  进度序列:', seq.map(x => `${x.pct}(${x.txt})`).join(' → '));
check(`S3 进度条经历 ≥${MIN_STAGES} 个阶段（mode=${MODE}）`, seq.length >= MIN_STAGES, `${seq.length} 段 / 用时 ${cost}s`);
check('S3 阶段文案来自后台真实步骤（非占位）', MODE !== 'sync' || seq.some(x => /Excel|成品表|明细/.test(x.txt)), seq.map(x => x.txt).join('|').slice(0, 120));
check('S3 进度完成后自动跳转「结果与下载」', jumped === true);
await sleep(700);
const st3 = JSON.parse(await ev(`JSON.stringify({step:document.body.dataset.step,on:document.querySelector('#genProg').classList.contains('on'),btnDisabled:document.querySelector('#goRes').disabled,dl:document.querySelector('#dlName').textContent})`));
check('S3 跳转后进度条收起、按钮恢复可用', st3.on === false && st3.btnDisabled === false, `dlName=${st3.dl} step=${st3.step}`);
await shot('_t00927_s3_result.png');

// ---------- S4 失败兜底：阻断 /api/generate ----------
await ev(`goPage('work'); goStep('review');`);
await sleep(400);
await send('Network.setBlockedURLs', { urls: ['*/api/generate'] }, S);
await ev(`document.querySelector('#goRes').click();`);
await sleep(1200);
const st4 = JSON.parse(await ev(`(()=>{const p=document.querySelector('#genProg');
  return JSON.stringify({err:p.classList.contains('err'),on:p.classList.contains('on'),txt:document.querySelector('#genProgTxt').textContent,toast:document.querySelector('#toast').textContent,btnDisabled:document.querySelector('#goRes').disabled});})()`));
check('S4 失败时进度条转红并给出错误文案', st4.err === true && /失败/.test(st4.txt), `bar="${st4.txt}" toast="${st4.toast}"`);
check('S4 失败时按钮恢复可点击', st4.btnDisabled === false);
await sleep(3000);
check('S4 失败提示随后自动收起', (await ev(`!document.querySelector('#genProg').classList.contains('on')`)) === true);
await send('Network.setBlockedURLs', { urls: [] }, S);

// ---------- S5 超时兜底：请求被挂住不返回 → 到点中止并恢复按钮 ----------
await ev(`goPage('work'); goStep('review');`);
await ev(`window.WL_GEN_TIMEOUT_MS=1500;`);
await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/generate' }] }, S);
await sleep(400);
await ev(`document.querySelector('#goRes').click();`);
const okTimeout = await waitFor(async () => (await ev(`document.querySelector('#genProg').classList.contains('err')`)) === true, 10000, '超时兜底');
const st5 = JSON.parse(await ev(`JSON.stringify({txt:document.querySelector('#genProgTxt').textContent,toast:document.querySelector('#toast').textContent,btnDisabled:document.querySelector('#goRes').disabled})`));
check('S5 超过阈值后中止等待并给出超时文案', okTimeout && /超时/.test(st5.txt) && /超时/.test(st5.toast), `bar="${st5.txt}"`);
check('S5 超时后按钮恢复可点击', st5.btnDisabled === false);
await send('Fetch.disable', {}, S);
await ev(`window.WL_GEN_TIMEOUT_MS=0;`);

check('全程无页面异常', errors.length === 0, errors.slice(0, 2).join(' | '));
console.log('\n==== 汇总 ====');
const bad = results.filter(r => !r.ok);
console.log(`共 ${results.length} 项，通过 ${results.length - bad.length}，失败 ${bad.length}`);
bad.forEach(b => console.log('  FAIL: ' + b.n));
await send('Target.closeTarget', { targetId: t.id }).catch(() => {});
process.exit(bad.length ? 1 : 0);
