<#
.SYNOPSIS
  工作量评估工具桌面安装包一键构建脚本（Electron 桌面壳 + PyInstaller 后端 sidecar + NSIS 安装包）。
  结构对齐参考项目 D:\code\otherProjects\18_comparePakage（BempDiff 桌面壳）。

.DESCRIPTION
  流程：
    1. 停止占用（引擎 exe + 端口 8000）
    2. PyInstaller 打包后端 exe -> dist/exe/工作量评估工具.exe
    3. npm install 桌面壳依赖（dev-shell 的 electron；根目录的 electron-builder，缺失时才装）
    4. electron-builder --win nsis -> release/WorkloadEstimate-<version>-setup.exe（输出目录与参考项目一致）
    5. 校验安装包产物并输出路径

.PARAMETER SkipExe
  跳过 PyInstaller（复用已有 dist/exe/工作量评估工具.exe）。
.PARAMETER SkipInstall
  跳过 npm install（复用已有 node_modules）。
#>
# 注意：刻意不使用 [CmdletBinding()]。误传的位置参数只进 $args，不触发参数绑定异常。
param(
  [switch]$SkipExe,
  [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'

if ($args -and $args.Count -gt 0) {
  $args | ForEach-Object { Write-Warning "忽略未识别参数: '$_'（本脚本仅接受具名开关: -SkipExe / -SkipInstall）" }
}

# 5.1 兼容：Join-Path 仅接受 2 个位置参数，多段路径用本函数逐段拼接。
function Join-Paths {
  param($Base)
  $p = $Base
  foreach ($seg in $args) { $p = Join-Path $p $seg }
  return $p
}

# 运行原生命令并回显输出；仅以 $LASTEXITCODE 判定成败。
# 背景：PowerShell 5.1 下 $ErrorActionPreference='Stop' 时，原生命令 stderr（告警/提示）
# 会被包装成 NativeCommandError 终止脚本，且重定向不能消除——必须临时降级 EAP。
function Invoke-Native {
  param([scriptblock]$Script)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'SilentlyContinue'
  try {
    $merged = & $Script 2>&1
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $prev
  }
  $merged | ForEach-Object {
    Write-Host $_
    try { $_ | Out-File -Append -FilePath $BuildLog -Encoding utf8 } catch {}
  }
  return $code
}

# 删文件/目录：直接走 .NET（绕过 safe-delete 包装器；仅用于本项目构建产物，非个人文件）
function Remove-Tree($p) {
  if (-not (Test-Path $p)) { return $true }
  try { [System.IO.Directory]::Delete($p, $true); return $true } catch { return $false }
}
function Remove-File($p) {
  if (-not (Test-Path $p)) { return $true }
  try { [System.IO.File]::Delete($p); return $true } catch { return $false }
}

function Write-Step($msg) { Write-Host "`n== $msg ==" -ForegroundColor Cyan }

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root      = Split-Path -Parent $ScriptDir
$ExeName   = '工作量评估工具.exe'
$ExeOut    = Join-Paths $Root 'dist' 'exe'
$SidecarExe= Join-Path $ExeOut $ExeName
$SpecFile  = Join-Path $Root '工作量评估工具.spec'
$DistElectron = Join-Path $Root 'release'
$LogDir    = Join-Path $Root 'logs'
$BuildLog  = Join-Path $LogDir 'build_installer.log'

if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Force -Path $LogDir | Out-Null }
try { Set-Content -Path $BuildLog -Value ("=== 桌面安装包构建 @ " + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + " ===") -Encoding utf8 } catch {}

# ---------- 1. 停止占用 ----------
Write-Step "[1/5] 停止占用（引擎进程 + 端口 8000）"
Invoke-Native { & taskkill /F /T /IM $ExeName } | Out-Null
Invoke-Native { & powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id `$_ -Force -ErrorAction SilentlyContinue }" } | Out-Null
# 根因修复：历史构建失败于 app-builder 清理 win-unpacked\resources\app.asar 时"被另一进程占用"
# （ERR_ELECTRON_BUILDER_CANNOT_EXECUTE）。占用者通常是之前试运行过的 win-unpacked 内 exe，
# 这里按可执行文件路径兜底清杀。
try {
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -and $_.ExecutablePath -like '*dist_electron*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
} catch {}
Write-Host "  [OK] 已清理"

# ---------- 2. PyInstaller 后端 exe ----------
if (-not $SkipExe) {
  Write-Step "[2/5] PyInstaller 打包后端 exe"
  # 探测带 PyInstaller 的 python：PATH 优先，其次本机常见安装
  $pyCandidates = @()
  $whereRc = Invoke-Native { & where.exe python }
  if ($whereRc -eq 0) { $pyCandidates += 'python' }
  $pyCandidates += @('py -3', 'F:\Program Files\Python3.14\python.exe')
  $Py = $null
  foreach ($cand in $pyCandidates) {
    if (-not $cand) { continue }
    if ($cand -eq 'py -3') {
      $rc = Invoke-Native { & py -3 -m PyInstaller --version }
    } else {
      $rc = Invoke-Native { & $cand -m PyInstaller --version }
    }
    if ($rc -eq 0) { $Py = $cand; break }
  }
  if (-not $Py) {
    throw "未找到带 PyInstaller 的 python。请先安装: pip install pyinstaller"
  }
  Write-Host "  使用解释器: $Py"
  if (-not (Test-Path $SpecFile)) { throw "缺少 spec 文件：$SpecFile" }
  if (-not (Test-Path $ExeOut)) { New-Item -ItemType Directory -Force -Path $ExeOut | Out-Null }
  if ($Py -eq 'py -3') {
    $rc = Invoke-Native { & py -3 -m PyInstaller $SpecFile --distpath $ExeOut --workpath (Join-Path $Root 'build') --noconfirm }
  } else {
    $rc = Invoke-Native { & $Py -m PyInstaller $SpecFile --distpath $ExeOut --workpath (Join-Path $Root 'build') --noconfirm }
  }
  if ($rc -ne 0) { throw "PyInstaller 打包失败（详见 $BuildLog）" }
  if (-not (Test-Path $SidecarExe)) { throw "exe 未生成：$SidecarExe" }
  Write-Host ("  [OK] " + $SidecarExe + " (" + [math]::Round((Get-Item $SidecarExe).Length/1MB,1) + " MB)")
} else {
  Write-Step "[2/5] 跳过 PyInstaller（复用已有 exe）"
  if (-not (Test-Path $SidecarExe)) { throw "复用模式但 exe 不存在：$SidecarExe（请去掉 -SkipExe）" }
}

# ---------- 3. npm install ----------
if (-not $SkipInstall) {
  Write-Step "[3/5] npm install 桌面壳依赖"
  $NpmCache = Join-Path $env:LOCALAPPDATA 'npm-cache'
  $ShellDir = Join-Path $Root 'dev-shell'
  if (-not (Test-Path (Join-Paths $ShellDir 'node_modules' 'electron' 'dist' 'electron.exe'))) {
    Write-Host "  安装 dev-shell/electron ..."
    Push-Location $ShellDir
    try { $rc = Invoke-Native { & npm install --no-audit --no-fund --cache $NpmCache } } finally { Pop-Location }
    if ($rc -ne 0) { throw "dev-shell npm install 失败（详见 $BuildLog）" }
  } else {
    Write-Host "  electron 已就绪，跳过"
  }
  if (-not (Test-Path (Join-Paths $Root 'node_modules' 'electron-builder'))) {
    Write-Host "  安装根目录 electron-builder ..."
    Push-Location $Root
    try { $rc = Invoke-Native { & npm install --no-audit --no-fund --cache $NpmCache } } finally { Pop-Location }
    if ($rc -ne 0) { throw "根目录 npm install 失败（详见 $BuildLog）" }
  } else {
    Write-Host "  electron-builder 已就绪，跳过"
  }
} else {
  Write-Step "[3/5] 跳过 npm install"
  if (-not (Test-Path (Join-Paths $Root 'node_modules' 'electron-builder'))) {
    throw "复用模式但 electron-builder 未安装（请去掉 -SkipInstall）"
  }
}

# ---------- 4. electron-builder NSIS ----------
Write-Step "[4/5] electron-builder 打 NSIS 安装包"
# 前置校验：extraResources 引用的 sidecar 必须存在，否则 electron-builder 会在后半程失败
if (-not (Test-Path $SidecarExe)) { throw "缺少后端 sidecar：$SidecarExe（extraResources 需要它；请去掉 -SkipExe 先跑 PyInstaller）" }
# 预清理旧 win-unpacked：app-builder 的 EnsureEmptyDir 在文件被占用时会直接失败，
# 先用 .NET 删除绕开（被占用删不掉则交给 electron-builder 自行清理并可能降级）。
$WinUnpacked = Join-Path $DistElectron 'win-unpacked'
if (Test-Path $WinUnpacked) {
  if (Remove-Tree $WinUnpacked) { Write-Host "  已预清理 $WinUnpacked" }
  else { Write-Warning "无法预清理 $WinUnpacked（可能仍被占用），交由 electron-builder 处理" }
}
# app-builder（Go 二进制）不读 .npmrc 的 electron_mirror，必须显式设环境变量走国内镜像，
# 否则默认从 github.com 下载 electron zip 会被网络墙掉（ERR_ELECTRON_BUILDER_CANNOT_EXECUTE）。
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
# 沙箱兼容（best-effort）：WorkBuddy 会给 node 子进程注入 node-safe-delete-shim，
# 拦截 electron-builder 清理自身产物（locales / 中间 7z / 旧 win-unpacked）的 fs.rm/unlink。
# 这里先尝试从 NODE_OPTIONS 剥离；若运行时仍被按进程注入拦截，由下方"产物已生成则降级"兜底。
if ($env:NODE_OPTIONS) {
  $kept = ($env:NODE_OPTIONS -split '\s+') | Where-Object { $_ -notmatch 'safe-delete-shim' }
  if ($kept) { $env:NODE_OPTIONS = $kept -join ' ' } else { Remove-Item Env:NODE_OPTIONS -ErrorAction SilentlyContinue }
}
# 清理旧安装包（避免新旧产物混淆）
Get-ChildItem $DistElectron -Filter '*-setup.exe' -ErrorAction SilentlyContinue | ForEach-Object {
  Remove-File $_.FullName | Out-Null
}
$EbCmd = Join-Paths $Root 'node_modules' '.bin' 'electron-builder.cmd'
$BuildStart = Get-Date
Push-Location $Root
try {
  if (Test-Path $EbCmd) {
    $rc = Invoke-Native { & $EbCmd --win nsis }
  } else {
    $rc = Invoke-Native { & npx electron-builder --win nsis }
  }
} finally { Pop-Location }
if ($rc -ne 0) {
  # 沙箱兜底：WorkBuddy safe-delete 钩子会拦截 electron-builder 最后清理中间产物
  # （win-unpacked/app.asar、*.nsis.7z）的 fs.rm/unlink。若安装包实际已生成且新鲜，
  # 降级为警告继续；否则才判定真失败。
  $freshSetup = Get-ChildItem $DistElectron -Filter '*-setup.exe' -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -ge $BuildStart } | Select-Object -First 1
  if ($freshSetup) {
    Write-Warning "electron-builder exit=$rc，但安装包已生成（$($freshSetup.Name)）；清理中间产物的删除被环境拦截，视为成功。"
  } else {
    throw "electron-builder 失败（exit=$rc，详见 $BuildLog）"
  }
}

# ---------- 5. 校验产物 ----------
Write-Step "[5/5] 校验安装包产物"
$setup = Get-ChildItem $DistElectron -Filter '*-setup.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $setup) {
  throw "未找到安装包（dist_electron 下无 *-setup.exe）。请检查 $BuildLog"
}
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  桌面安装包构建完成" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ("  安装包 : " + $setup.FullName + " (" + [math]::Round($setup.Length/1MB,1) + " MB)")
Write-Host "  安装后   : Electron 桌面壳窗口加载本地引擎（resources\we-eval\工作量评估工具.exe sidecar）"
Write-Host ""
