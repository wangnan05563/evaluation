#!/usr/bin/env node
/** M4/FR-5.2 编排器：npm test 一条命令跑核心链路自动化测试。
 *  用法：npm test [-- --only=S1,S3] [-- --with-flaky]
 *  套件：S1/S2 单测(python) · S3 API 冒烟(隔离实例) · S4/S5/S7/S8 UI 冒烟(CDP+无头 Chrome) · S6 flaky(默认 skip)。 */
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PY = process.env.PYTHON || 'python';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const API_PORT = 8032, CDP_PORT = 9334;
const API = `http://127.0.0.1:${API_PORT}`;
const CDP = `http://127.0.0.1:${CDP_PORT}`;
const args = process.argv.slice(2);
const only = (args.find(a => a.startsWith('--only=')) || '').split('=')[1];
const withFlaky = args.includes('--with-flaky');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'we_test_'));
const results = [];
const log = (...a) => console.log(...a);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const portFree = port => new Promise(res => {
  const s = net.createServer();
  s.once('error', () => res(false));
  s.once('listening', () => s.close(() => res(true)));
  s.listen(port, '127.0.0.1');
});
const killTree = pid => { try { spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* noop */ } };

function startServer(dataDir, port = API_PORT) {
  const p = spawn(PY, ['-u', 'scripts/server.py', String(port), '--serve-frontend'],
    { cwd: ROOT, env: { ...process.env, WE_DATA: dataDir }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.resume(); p.stderr.resume();
  return p;
}
async function waitHealth(timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { const r = await fetch(`${API}/health`); if (r.ok) return true; } catch { /* 未就绪 */ }
    await sleep(500);
  }
  return false;
}
async function startChrome(dataDir) {
  const p = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${dataDir}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', 'about:blank'],
    { stdio: 'ignore' });
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    try { const r = await fetch(`${CDP}/json/version`); if (r.ok) return p; } catch { /* 未就绪 */ }
    await sleep(400);
  }
  throw new Error('Chrome CDP 未就绪');
}
function runSuite(cmd, cargs, env, timeoutMs = 300000) {
  return new Promise(res => {
    const p = spawn(cmd, cargs, { cwd: ROOT, env: { ...process.env, ...env } });
    let tail = '';
    const grab = d => { tail += d.toString(); if (tail.length > 8000) tail = tail.slice(-8000); };
    p.stdout.on('data', d => { process.stdout.write(d); grab(d); });
    p.stderr.on('data', d => { process.stderr.write(d); grab(d); });
    const killer = setTimeout(() => { try { killTree(p.pid); } catch { /* noop */ } }, timeoutMs);
    p.on('exit', code => { clearTimeout(killer); res({ code, tail }); });
  });
}

const suites = [
  { id: 'S1', title: '识别规则表驱动单测（对拍/回退/坏正则）', kind: 'py', script: 'tests/unit_rules.py' },
  { id: 'S2', title: '引擎口径单测', kind: 'py', script: 'tests/unit_engine.py' },
  { id: 'S3', title: 'API 冒烟（隔离实例全链路）', kind: 'api', script: 'tests/api_smoke.py' },
  { id: 'S4', title: 'UI 冒烟（四图+导出管线）', kind: 'ui', script: 'tests/ui_smoke.mjs' },
  { id: 'S5', title: 'UI M3（表格增强+规则沉淀）', kind: 'ui', script: 'tests/ui_m3.mjs' },
  { id: 'S6', title: 'UI 进度/失败/超时（flaky，T01079）', kind: 'ui', script: 'tests/ui_progress.mjs', flaky: true },
  { id: 'S7', title: 'UI 版本 diff 对比（FR-FE05）', kind: 'ui', script: 'tests/ui_diff.mjs' },
  { id: 'S8', title: 'UI 主题色定制（FR-TH02）', kind: 'ui', script: 'tests/ui_theme.mjs', env: { PYTHON: PY } },
];

let server = null, chrome = null;
async function cleanup() {
  if (server) { killTree(server.pid); server = null; }
  if (chrome) { killTree(chrome.pid); chrome = null; }
  // 端口回收确认：占用的 python/chrome 子树已随 killTree 终止
  process.exitCode = results.some(r => !r.ok) ? 1 : 0;
}

process.on('exit', () => { if (server) killTree(server.pid); 
if (chrome) killTree(chrome.pid); });
['SIGINT', 'SIGTERM'].forEach(sig => process.on(sig, async () => { await cleanup(); process.exit(130); }));

// 主体改用顶层 await（S7785：不再用 async IIFE）
{
  log(`# 核心链路自动化测试（M4/FR-5.2） ${new Date().toLocaleString('zh-CN')}`);
  log(`# 夹具: ${ROOT}/data/testdocs · 临时数据: ${TMP} · flaky: ${withFlaky ? '开启' : '跳过'}\n`);
  for (const port of [API_PORT, CDP_PORT]) {
    if (!(await portFree(port))) { log(`端口 ${port} 被占用，请先释放（避免双监听）`); process.exit(2); }
  }
  const list = suites.filter(s => (!only || only.split(',').includes(s.id)) && (withFlaky || !s.flaky));
  for (const s of list) {
    log(`\n== ${s.id} ${s.title} ==`);
    let code = 1;
    try {
      if (s.kind === 'py') {
        ({ code } = await runSuite(PY, [s.script], {}));
      } else if (s.kind === 'api') {
        const dataDir = path.join(TMP, s.id.toLowerCase(), 'data');
        fs.mkdirSync(dataDir, { recursive: true });
        server = startServer(dataDir);
        if (!(await waitHealth())) throw new Error('API 实例未就绪');
        ({ code } = await runSuite(PY, [s.script, String(API_PORT)], {}));
        killTree(server.pid); server = null;
        await sleep(800);
      } else if (s.kind === 'ui') {
        if (!chrome) chrome = await startChrome(path.join(TMP, 'chrome'));
        const dataDir = path.join(TMP, s.id.toLowerCase(), 'data');
        fs.mkdirSync(dataDir, { recursive: true });
        server = startServer(dataDir);
        if (!(await waitHealth())) throw new Error('API 实例未就绪');
        ({ code } = await runSuite(process.execPath, [s.script], { WE_DATA: dataDir, ...(s.env || {}) }));
        killTree(server.pid); server = null;
        await sleep(800);
      }
    } catch (e) {
      log(`  FAIL  套件异常: ${e.message}`);
      code = 1;
    } finally {
      if (server) { killTree(server.pid); server = null; }
    }
    const ok = code === 0;
    results.push({ id: s.id, title: s.title, ok, skipped: false });
    log(`== ${s.id} ${ok ? '全绿' : '失败'} ==\n`);
  }
  for (const s of suites.filter(x => x.flaky && !withFlaky)) {
    results.push({ id: s.id, title: s.title, ok: true, skipped: true });
    log(`== ${s.id} SKIP（flaky，--with-flaky 开启）==`);
  }
  await cleanup();

  const rep = ['# 核心链路自动化测试报告', `${new Date().toLocaleString('zh-CN')}`, '',
    '| 套件 | 说明 | 结果 |', '|---|---|---|',
    ...results.map(r => `| ${r.id} | ${r.title} | ${r.skipped ? 'SKIP' : r.ok ? 'PASS' : '**FAIL**'} | |`), ''];
  const repPath = path.join(ROOT, 'logs', `test_report_${Date.now()}.md`);
  fs.writeFileSync(repPath, rep.join('\n'));
  log(`\n==== 汇总 ==== 通过 ${results.filter(r => r.ok && !r.skipped).length}/${results.filter(r => !r.skipped).length}` +
    `（skip ${results.filter(r => r.skipped).length}）报告: ${path.relative(ROOT, repPath)}`);
}
