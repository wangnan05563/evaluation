/** FR-TH02 主题色/品牌色定制验证（预设 6 套 + 自定义 + 导出表头色联动 + 非法色值拒绝）
 *  由编排器起隔离实例（8032）+ 无头 Chrome（CDP 9334）后运行。
 *  数据经 /api/generate 真实落盘 xlsx，用 openpyxl 反查表头填充色，验证「导出表头色联动」。 */
import path from 'node:path';
import fs from 'node:fs';
const CDP = 'http://127.0.0.1:9334', APP = 'http://127.0.0.1:8032/';
const PY = process.env.PYTHON || 'python';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const res = [];
const check = (n, ok, d = '') => { res.push({ n, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
setTimeout(() => { console.error('[bk] WATCHDOG'); process.exit(3); }, 420000);
const post = async (p, body) => (await fetch(APP + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();

const PRESETS = ['#2563EB', '#0EA5E9', '#059669', '#D97706', '#DB2777', '#475569'];

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

// 初始态清理走页面内求值而非 init 脚本：init 脚本在每次导航都跑，会把待验证的持久化值一并清掉
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('wl_guide_done_pages_v1',JSON.stringify({work:true,pert:true,config:true,help:true}))}catch(e){}try{localStorage.removeItem('we_form_state_v1')}catch(e){}` }, S);
await send('Page.navigate', { url: APP }, S);
for (let i = 0; i < 60; i++) { if ((await ev(`typeof goPage === 'function' && document.readyState !== 'loading'`)) === true) break; await sleep(250); }
await ev(`localStorage.removeItem('wl_brand');`);

// ---- 1) 预设数量与结构 ----
const pre = JSON.parse(await ev(`JSON.stringify({n:BRAND_PRESETS.length,hexes:BRAND_PRESETS.map(p=>p[0]),names:BRAND_PRESETS.map(p=>p[1])})`));
check('预设主题色 5-6 套', pre.n >= 5 && pre.n <= 6, `${pre.n} 套：${pre.names.join('/')}`);
check('预设色值均为合法 #RRGGBB', pre.hexes.every(h => /^#[0-9a-fA-F]{6}$/.test(h)), pre.hexes.join(' '));

// ---- 2) 配置中心 UI 入口 ----
await ev(`goPage('config');`);
await sleep(600);
const ui = JSON.parse(await ev(`JSON.stringify({seg:!!document.querySelector('#themeSeg .tm'),swatches:document.querySelectorAll('#brandPresets button').length,custom:!!document.getElementById('brandCustom'),picker:!!document.getElementById('brandPick')})`));
check('配置中心有 6 个色板 + 自定义输入 + 取色器', ui.swatches === pre.n && ui.custom && ui.picker, JSON.stringify(ui));

// ---- 3) 逐个预设：点击即生效（CSS 变量 + 记忆） ----
const applied = [];
for (let i = 0; i < pre.n; i++) {
  await ev(`document.querySelectorAll('#brandPresets button')[${i}].click();`);
  await sleep(120);
  const st = JSON.parse(await ev(`JSON.stringify({brand:getComputedStyle(document.documentElement).getPropertyValue('--brand').trim(),ink:getComputedStyle(document.documentElement).getPropertyValue('--brand-ink').trim(),soft:getComputedStyle(document.documentElement).getPropertyValue('--brand-soft').trim(),saved:localStorage.getItem('wl_brand')})`));
  if (st.brand.toUpperCase() !== pre.hexes[i].toUpperCase() || (st.saved || '').toUpperCase() !== pre.hexes[i].toUpperCase()) {
    applied.push(`#${i + 1} ${pre.hexes[i]}→brand=${st.brand}/saved=${st.saved}`);
  }
  if (!/^#[0-9a-f]{6}$/i.test(st.ink) || !/^#[0-9a-f]{6}$/i.test(st.soft)) applied.push(`#${i + 1} 派生色非法 ink=${st.ink} soft=${st.soft}`);
}
check('6 套预设逐一点击均生效并记忆', applied.length === 0, applied.join(' | ') || pre.hexes.join(' '));

// ---- 4) 非法色值拒绝（前端不改色、不落盘） ----
const bad = ['#12345', 'red', 'rgb(1,2,3)', '#GGGGGG', '', '2563EB', '#2563EBFF'];
const badRes = [];
for (const v of bad) {
  await ev(`localStorage.setItem('wl_brand','#0EA5E9');applyBrand('#0EA5E9');`);
  const r = await ev(`JSON.stringify({ret:(()=>{try{return String(applyBrand(${JSON.stringify(v)}))}catch(e){return 'THROW:'+e.message}})(),brand:getComputedStyle(document.documentElement).getPropertyValue('--brand').trim(),saved:localStorage.getItem('wl_brand')})`);
  const j = JSON.parse(r);
  if (j.ret !== 'false' || j.brand.toUpperCase() !== '#0EA5E9') badRes.push(`${JSON.stringify(v)}→ret=${j.ret} brand=${j.brand}`);
}
check('非法色值一律拒绝且不改色', badRes.length === 0, badRes.join(' | ') || `已测 ${bad.length} 个非法输入`);

// 自定义合法值（非预设）应被接受
await ev(`localStorage.removeItem('wl_brand');`);
const custom = JSON.parse(await ev(`JSON.stringify({ret:String(applyBrand('#7C3AED')),brand:getComputedStyle(document.documentElement).getPropertyValue('--brand').trim()})`));
check('自定义合法色值可生效', custom.ret === 'true' && custom.brand.toUpperCase() === '#7C3AED', JSON.stringify(custom));

// ---- 5) 持久化：重载后仍为上次的自定义色 ----
await ev(`applyTheme.brand('#7C3AED');`);
await send('Page.navigate', { url: APP }, S);
for (let i = 0; i < 60; i++) { if ((await ev(`typeof goPage === 'function' && document.readyState !== 'loading'`)) === true) break; await sleep(250); }
const persisted = await ev(`getComputedStyle(document.documentElement).getPropertyValue('--brand').trim()`);
check('重载后主题色持久化', persisted.toUpperCase() === '#7C3AED', persisted);

// ---- 6) 导出表头色联动（真跑 /api/generate，用 openpyxl 反查填充色） ----
const docB64 = fs.readFileSync(path.join('.', 'data', 'testdocs', 't00928_req.docx')).toString('base64');
const rec = await post('/api/recognize', { name: 't00928_req.docx', b64: docB64, job: 'th02rec' });
if (!rec.ok) { console.error('识别失败: ' + JSON.stringify(rec).slice(0, 150)); process.exit(1); }
const items = rec.items.map(it => ({ ...it, cx: '中', ok: true }));

// 表头填充色探针：直接读生成响应里的 sid 对应文件（sid 即文件名，避免猜输出目录）。
// 注意两点：
//  1) _recolor_header 只作用于「规模估算」sheet（母版主表），不是 workbook 第一个 sheet
//     （第一个是「项目特征」），断言必须锁定该 sheet，否则会误读未着色的表。
//  2) 母版原始表头是 theme 型填充（fgColor.type=='theme'），重着色后才变成 rgb 型；
//     故两种都要采集，否则「未传 brand_color」时会误判成「没有表头填充」。
const probe = `import sys,json,os
from openpyxl import load_workbook
data_dir=sys.argv[1]; sid=sys.argv[2]
f=os.path.join(data_dir,"generated",sid)
wb=load_workbook(f)
ws=wb["规模估算"]
fills=[]
for row in ws.iter_rows(min_row=1,max_row=5):
    for c in row:
        if not c.fill or c.fill.patternType!="solid":
            continue
        fg=c.fill.fgColor
        t=getattr(fg,"type",None)
        if t=="rgb":
            rgb=getattr(fg,"rgb",None)
            if isinstance(rgb,str) and len(rgb)==8 and rgb.upper() not in ("FFFFFFFF","00000000"):
                fills.append(rgb.upper())
        else:
            fills.append("theme:%s" % getattr(fg,"theme",t))
print(json.dumps({"file":sid,"sheet":"规模估算","fills":fills},ensure_ascii=False))`;

async function headerFills(brandColor, tag) {
  const g = await post('/api/generate', {
    items: rec.items, method: '估算功能点', title: `TH02-${tag}`, job: `th02gen-${tag}`,
    hist_items: items, brand_color: brandColor,
  });
  if (!g.ok || !g.sid) return { err: JSON.stringify(g).slice(0, 150) };
  // 数据目录即隔离实例的 WE_DATA（编排器为每个套件新建），从 /api/diag 拿不到，故随环境变量传
  const dataDir = process.env.WE_DATA || '';
  if (!dataDir) return { err: 'WE_DATA 未传入，无法定位产物' };
  const { execFileSync } = await import('node:child_process');
  const r = execFileSync(PY, ['-c', probe, dataDir, g.sid], { encoding: 'utf8', env: process.env });
  return JSON.parse(r.trim().split('\n').pop());
}

const want = '#7C3AED';
const withBrand = await headerFills(want, 'brand');
const target = 'FF' + want.slice(1).toUpperCase();
check('带 brand_color 生成成功且表头被着色', !withBrand.err && (withBrand.fills || []).length > 0 && withBrand.fills.every(f => f === target),
  withBrand.err || `fills=${[...new Set(withBrand.fills)].join(',')}`);

const noBrand = await headerFills('', 'plain');
check('不传 brand_color 时表头保持母版默认（非主题色）', !noBrand.err && (noBrand.fills || []).length > 0 && !(noBrand.fills || []).includes(target),
  noBrand.err || `fills=${[...new Set(noBrand.fills)].slice(0, 3).join(',')}`);

// ---- 7) 后端非法色值拒绝（validators.check_generate 抛 VErr → 400，不得 500） ----
const gBad = await post('/api/generate', { items: rec.items, method: '估算功能点', title: 'TH02-bad', job: 'th02gen-bad', hist_items: items, brand_color: 'red; rm -rf /' });
check('后端拒绝非法色值（ok=false，不生成）', gBad.ok !== true && /RRGGBB/.test(gBad.msg || ''), `ok=${gBad.ok} msg=${(gBad.msg || '').slice(0, 60)}`);

check('全程无页面异常', errors.length === 0, errors.slice(0, 2).join(' | '));
const bad2 = res.filter(x => !x.ok).length;
console.log(`\n==== 汇总 ==== 共 ${res.length} 项，通过 ${res.length - bad2}，失败 ${bad2}`);
await send('Target.closeTarget', { targetId: t.id }).catch(() => {});
process.exit(bad2 ? 1 : 0);
