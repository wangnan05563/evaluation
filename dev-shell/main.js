// 工作量评估工具 Electron 桌面壳（开发态 / 生产态共用）
// 结构与 BempDiff 桌面壳一致：
//   1) 自适应屏幕创建主窗口
//   2) 以 sidecar 方式静默启动 PyInstaller 后端 exe（windowsHide，无控制台窗口）
//      开发态无 exe 时回退 python scripts/server.py
//   3) 应用退出时统一回收子进程与端口
// 生产打包由 electron-builder 复用同一 main.js，区别仅在于资源根路径（resourcesPath）。

const { app, BrowserWindow, screen, shell, dialog } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const net = require('node:net')
const http = require('node:http')
const { spawn, spawnSync } = require('node:child_process')

// ---------- 配置 ----------
// 8020：otherProjects 全域端口普查后的专属端口（8000 与 MorningBrief/20_News 冲突，详见 README）
const PORT = 8020
const DEFAULT_W = 1280
const DEFAULT_H = 900
const MIN_W = 960
const MIN_H = 640
const APP_NAME = '工作量评估工具'

const ROOT = resolveRoot()
const LOGDIR = path.join(ROOT, 'logs')
const BACKEND_LOG = path.join(LOGDIR, 'backend.log')
const PRELOAD = path.join(__dirname, 'preload.js')
const ICON = path.join(__dirname, '..', 'assets', 'we_icon.ico')

let children = [] // sidecar 子进程，退出时回收
let backendPid = null

// ---------- 资源根路径 ----------
// 开发态：dev-shell -> 项目根（..）
// 生产态：electron-builder extraResources 落地在 process.resourcesPath 下
function resolveRoot() {
  const res = process.resourcesPath
  if (res && fs.existsSync(path.join(res, 'we-eval'))) return res
  return path.resolve(__dirname, '..')
}

function appendLog(file, ...args) {
  try {
    if (!fs.existsSync(LOGDIR)) fs.mkdirSync(LOGDIR, { recursive: true })
    fs.appendFileSync(file, args.join(' ') + '\n')
  } catch (_) {}
}

const SHELL_LOG = path.join(LOGDIR, 'shell.log')
const SHELL_LOG_MAX = 2 * 1024 * 1024
function rotateAppend(file, text) {
  try {
    if (!fs.existsSync(LOGDIR)) fs.mkdirSync(LOGDIR, { recursive: true })
    if (fs.existsSync(file)) {
      const st = fs.statSync(file)
      if (st.size > SHELL_LOG_MAX) {
        try { fs.renameSync(file, file + '.old') } catch (_) {}
      }
    }
    fs.appendFileSync(file, text)
  } catch (_) {}
}
process.on('uncaughtException', (e) => {
  rotateAppend(SHELL_LOG, `[uncaughtException] ${e && e.stack ? e.stack : String(e)}\n`)
})
process.on('unhandledRejection', (r) => {
  rotateAppend(SHELL_LOG, `[unhandledRejection] ${r && r.stack ? r.stack : String(r)}\n`)
})

function openLog(file) {
  try {
    if (!fs.existsSync(LOGDIR)) fs.mkdirSync(LOGDIR, { recursive: true })
    return fs.openSync(file, 'a')
  } catch (_) {
    return 'ignore'
  }
}

// ---------- 端口探测 ----------
function isPortOpen(port) {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1')
    let done = false
    const finish = (v) => { if (!done) { done = true; s.destroy(); resolve(v) } }
    s.setTimeout(800)
    s.on('connect', () => finish(true))
    s.on('timeout', () => finish(false))
    s.on('error', () => finish(false))
  })
}

async function waitPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await isPortOpen(port)) return true
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

function killPort(port) {
  try {
    spawnSync('powershell', ['-NoProfile', '-Command',
      `$p=${port};try{$id=(Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue|Select-Object -First 1).OwningProcess;if($id -ne $null){Stop-Process -Id $id -Force -ErrorAction SilentlyContinue;Write-Host ('[STOP] port '+$p+' PID='+$id)}}catch{}`],
      { stdio: 'ignore' })
  } catch (_) {}
}

// 强杀指定 PID 的整个进程树（Windows 下 detached 子进程 SIGTERM 无效，必须 taskkill /T）
function killTreePid(pid) {
  if (!pid) return
  try {
    spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore' })
  } catch (_) {}
}

// ---------- sidecar 定位 ----------
// 生产态：resources/we-eval/工作量评估工具.exe（electron-builder extraResources）
// 开发态：dist/exe/工作量评估工具.exe（PyInstaller 产物）；无 exe 回退 python scripts/server.py
function findSidecar() {
  const exeName = APP_NAME + '.exe'
  const candidates = [
    path.join(ROOT, 'we-eval', exeName),
    path.join(ROOT, 'dist', 'exe', exeName)
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) return { kind: 'exe', path: c }
  }
  const serverPy = path.join(ROOT, 'scripts', 'server.py')
  const pyCandidates = [
    process.env.WE_PYTHON,
    'python'
  ].filter(Boolean)
  for (const py of pyCandidates) {
    try {
      const r = spawnSync(py, ['--version'], { stdio: 'ignore' })
      if (r.status === 0) return { kind: 'python', cmd: py, script: serverPy }
    } catch (_) {}
  }
  return null
}

// ---------- sidecar 启动（静默、无控制台窗口） ----------
async function startBackend() {
  if (await isPortOpen(PORT)) {
    appendLog(BACKEND_LOG, '[sidecar] backend already listening on', PORT)
    return true
  }
  const sc = findSidecar()
  rotateAppend(SHELL_LOG, `[boot] ROOT=${ROOT} resourcesPath=${process.resourcesPath || ''} sidecar=${sc ? sc.kind + ':' + urlSafe(sc.path || sc.script) : 'NULL'}\n`)
  if (!sc) {
    rotateAppend(SHELL_LOG, '[boot] NO_SIDECAR: 后端 exe 缺失且无可用 python，主窗将无法加载\n')
    console.error('[WorkloadEval] No backend sidecar found. Run the build script first.')
    return false
  }
  // 数据目录由 server.py 决定：frozen 时落 %APPDATA%\WorkloadEval，卸载/重装不丢配置。
  // 禁止在此注入 WE_DATA 指向安装目录——NSIS 卸载会整目录删除，配置随包丢失（T00850）。
  // WE_APP_VERSION：后端 /api/app-info 与更新检测用（Electron 打包内 package.json 是权威版本源）
  const env = { ...process.env, WE_APP_VERSION: app.getVersion() }
  let child
  const out = openLog(BACKEND_LOG)
  if (sc.kind === 'exe') {
    // --no-open：禁止后端自动打开浏览器（窗口由壳承载）
    child = spawn(sc.path, ['--no-open'], {
      cwd: path.dirname(sc.path),
      windowsHide: true,
      detached: true,
      stdio: ['ignore', out, out],
      env
    })
  } else {
    // 开发态：--serve-frontend 让本服务提供前端；非 frozen 且未传 --open，不会开浏览器
    child = spawn(sc.cmd, [sc.script, '--serve-frontend'], {
      cwd: ROOT,
      windowsHide: true,
      detached: true,
      stdio: ['ignore', out, out],
      env
    })
  }
  children.push(child)
  backendPid = child.pid || null
  appendLog(BACKEND_LOG, '[sidecar] backend started PID', child.pid)
  const ready = await waitPort(PORT, 30000)
  if (!ready) appendLog(BACKEND_LOG, '[sidecar] WARN: 后端 30s 内未就绪，窗口可能暂时无法访问 API')
  return ready
}

function urlSafe(s) { return String(s).replace(/\\/g, '/') }

// T01835：关闭前运行任务检测——查询 sidecar /api/jobs/running，
// 有进行中的生成/补算、更新包下载或 AI 识别时弹确认框，防误关中断长任务。
function fetchRunningJobs(timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/api/jobs/running', timeout: timeoutMs }, (res) => {
      let d = ''
      res.on('data', (c) => { d += c })
      res.on('end', () => {
        try {
          const j = JSON.parse(d)
          resolve(Array.isArray(j.jobs) ? j.jobs : [])
        } catch (_) { resolve([]) }
      })
    })
    req.on('timeout', () => { req.destroy(); resolve([]) })
    req.on('error', () => resolve([]))   // 后端不可达时不阻塞关闭（宁可少拦截不可关不掉）
  })
}

// ---------- 窗口自适应 ----------
function computeSize() {
  const area = screen.getPrimaryDisplay().workAreaSize
  const w = Math.min(DEFAULT_W, Math.floor(area.width * 0.92))
  const h = Math.min(DEFAULT_H, Math.floor(area.height * 0.92))
  const cw = Math.max(MIN_W, w)
  const ch = Math.max(MIN_H, h)
  if (cw >= area.width || ch >= area.height) return { maximize: true }
  return { maximize: false, width: cw, height: ch }
}

function createWindow(url) {
  const size = computeSize()
  const win = new BrowserWindow({
    width: size.maximize ? MIN_W : size.width,
    height: size.maximize ? MIN_H : size.height,
    minWidth: MIN_W,
    minHeight: MIN_H,
    icon: fs.existsSync(ICON) ? ICON : undefined,
    title: APP_NAME,
    show: false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.loadURL(url)

  // T01835：close 事件拦截（区别于 window-all-closed）。后端不可达/查询失败一律放行，
  // 保证「关不掉」永远不会发生；确认框列出任务名与进度，提供「取消关闭 / 强制关闭」。
  win.on('close', async (e) => {
    if (win.__forceClose || win.__closeChecking) return
    win.__closeChecking = true
    let jobs = []
    try { jobs = await fetchRunningJobs() } finally { win.__closeChecking = false }
    if (!jobs.length) return
    e.preventDefault()
    const names = jobs.map((j) => `· ${j.name}${typeof j.pct === 'number' ? `（${j.pct}%）` : ''}`).join('\n')
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      title: '有正在进行的任务',
      message: '以下任务仍在进行中，现在关闭将中断它们：',
      detail: names,
      buttons: ['取消关闭', '强制关闭'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    })
    if (response === 1) {
      win.__forceClose = true
      win.close()
    }
  })

  win.once('ready-to-show', () => {
    if (!size.maximize) win.center()
    win.show()
  })

  win.webContents.on('did-fail-load', () => {
    win.show()
  })

  // 开发便利：F12 打开 DevTools
  win.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12') {
      if (win.webContents.isDevToolsOpened()) win.webContents.closeDevTools()
      else win.webContents.openDevTools()
      event.preventDefault()
    }
  })

  // 外部链接走系统默认浏览器，不在壳内打开
  win.webContents.setWindowOpenHandler(({ url: u }) => {
    require('electron').shell.openExternal(u)
    return { action: 'deny' }
  })

  return win
}

// ---------- 进程回收 ----------
function stopSidecar() {
  killTreePid(backendPid)
  backendPid = null
  for (const c of children) {
    try { c.kill('SIGTERM') } catch (_) {}
  }
  children = []
  killPort(PORT)
}

// ---------- Shell 集成：单实例锁 ----------
let mainWindow = null

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const w = BrowserWindow.getAllWindows()[0]
    if (w) { if (w.isMinimized()) w.restore(); w.focus() }
  })

  app.on('before-quit', stopSidecar)
  app.on('will-quit', stopSidecar)

  app.whenReady().then(async () => {
    let initialUrl = process.env.WE_DEV_URL
    if (!initialUrl) {
      killPort(PORT)
      await startBackend()
      initialUrl = `http://127.0.0.1:${PORT}/`
    }
    mainWindow = createWindow(initialUrl)
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(initialUrl)
    })
  })
}

app.on('window-all-closed', () => {
  app.quit()
})
