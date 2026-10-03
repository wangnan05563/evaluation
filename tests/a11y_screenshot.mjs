/** FR-UI05 视觉留档：三主题各截一张图，供人工复核对比度调整后的观感是否可接受。 */
import fs from 'node:fs';
const CDP = 'http://127.0.0.1:9351', APP = 'http://127.0.0.1:8091/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const t = await (await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket((await (await fetch(`${CDP}/json/version`)).json()).webSocketDebuggerUrl);
await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.no(new Error(JSON.stringify(m.error))) : p.ok(m.result); } };
const send = (m, p, s) => { const i = ++id; ws.send(JSON.stringify({ id: i, method: m, params: p, ...(s ? { sessionId: s } : {}) })); return new Promise((ok, no) => { pend.set(i, { ok, no }); setTimeout(() => { if (pend.has(i)) { pend.delete(i); no(new Error('cdp timeout: ' + m)); } }, 30000); }); };
const S = (await send('Target.attachToTarget', { targetId: t.id, flatten: true })).sessionId;
await send('Page.enable', {}, S); await send('Runtime.enable', {}, S);
const ev = async x => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, userGesture: true }, S); if (r.exceptionDetails) throw new Error('eval:' + (r.exceptionDetails.exception?.description || '')); return r.result.value; };
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1600, deviceScaleFactor: 1, mobile: false }, S);
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('wl_guide_done_pages_v1',JSON.stringify({work:true,pert:true,config:true,help:true}))}catch(e){}try{localStorage.removeItem('we_form_state_v1');localStorage.removeItem('wl_last_history')}catch(e){}` }, S);
await send('Page.navigate', { url: APP }, S);
for (let i = 0; i < 60; i++) { if ((await ev(`typeof goPage === 'function' && document.readyState !== 'loading'`)) === true) break; await sleep(250); }
// 造点数据让列表/图表有内容，便于观察徽标与正文对比
await ev(`goPage('work');goStep('upload');`);
await ev(`(()=>{
  const sys=['网银系统','信贷系统','报表平台'];
  items=[];
  let s=1;
  for(const sy of sys){
    const rows=[['用户登录与鉴权','登录','ILF','低'],['账户余额查询','余额查询','EI','中'],['交易流水明细','流水明细','ILF','高'],
      ['对账文件下载','对账下载','EO','中'],['权限角色配置','角色配置','ILF','低']];
    for(const [desc,ci,tp,cx] of rows){
      items.push({seq:s++,system:sy,desc,count_item:ci,type:tp,cx,reuse:'中',modify:'新增',ok:true});
    }
  }
  render();return items.length;
})()`);
await sleep(500);
for (const theme of ['light', 'dark', 'contrast']) {
  await ev(`setThemeMode('${theme}');goStep('review');`);
  await sleep(600);
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, S);
  fs.writeFileSync(`logs/_a11y_theme_${theme}.png`, Buffer.from(shot.data, 'base64'));
  console.log(`saved logs/_a11y_theme_${theme}.png`);
}
await send('Target.closeTarget', { targetId: t.id }).catch(() => {});
process.exit(0);
