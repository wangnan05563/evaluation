# -*- coding: utf-8 -*-
"""S10 · 命令行/无人值守模式单测（FR-FE10：退出码语义 + stdin 计数 + NESMA 口径）。

FR-FE10 的验收要点是「退出码语义明确」，调度脚本据此判成败，因此本套件
以子进程实测退出码为主，不做进程内函数断言。退出码 0=全过。

覆盖的回归点（T01503 实测发现）：
1. 参数校验必须早于重量级初始化 —— 缺依赖环境也须干净返回 2，不吐 traceback；
2. Windows 上 select() 对管道抛 OSError，--fast 曾恒读空并「假成功」返回 ufp=0；
3. --fast 无 stdin / 坏 JSON / 非对象 → 2（输入非法），不得计入生成失败；
4. NESMA 预估法 ILF=35/EIF=15、估算法 ILF=7/EIF=5/EI=4/EO=5/EQ=4。
"""
import json
import os
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLI = os.path.join(ROOT, 'scripts', 'we_cli.py')
DOCX = os.path.join(ROOT, 'data', 'testdocs', 't00928_req.docx')
fails = []


def check(name, ok, detail=''):
    print(f"  {'PASS' if ok else 'FAIL'}  {name} {detail}")
    if not ok:
        fails.append(name)


def run(args, stdin=None):
    """跑一次 CLI，返回 (退出码, 输出)。"""
    p = subprocess.run([sys.executable, '-u', CLI] + args,
                       input=stdin, capture_output=True, text=True,
                       encoding='utf-8', errors='replace', timeout=180, cwd=ROOT)
    return p.returncode, (p.stdout or '') + (p.stderr or '')


# 1) 非法输入一律 2，且不得抛 traceback（无人值守最忌噪声掩盖真因）
for name, args in [
        ('缺 --docx', ['--out', 'x.xlsx']),
        ('缺 --out', ['--docx', DOCX]),
        ('文档不存在', ['--docx', os.path.join(ROOT, 'nope.docx'), '--out', 'x.xlsx']),
        ('非 .docx', ['--docx', os.path.join(ROOT, 'README.md'), '--out', 'x.xlsx']),
        ('输出目录不存在', ['--docx', DOCX, '--out', os.path.join(ROOT, 'no_such_dir', 'x.xlsx')]),
        ('--fast 无 stdin', ['--fast', 'pre']),
]:
    code, out = run(args, stdin='')
    check(f'{name} → 2', code == 2, f'(实际 {code})')
    check(f'{name} 无 traceback', 'Traceback' not in out)

# 2) --fast stdin 校验：坏 JSON / 非对象 → 2
for name, payload in [('坏 JSON', 'not-json'), ('JSON 数组', '[1,2]')]:
    code, out = run(['--fast', 'pre'], stdin=payload)
    check(f'--fast {name} → 2', code == 2, f'(实际 {code})')

# 3) --fast 正常路径：管道与文件重定向均须读到计数（Windows 曾恒读空）
for name, payload, mode, exp_ufp in [
        ('估算法', '{"ILF":3,"EIF":2,"EI":4,"EO":3,"EQ":2}', 'est', 3 * 7 + 2 * 5 + 4 * 4 + 3 * 5 + 2 * 4),
        ('预估法', '{"ILF":3,"EIF":2}', 'pre', 3 * 35 + 2 * 15),
]:
    code, out = run(['--fast', mode], stdin=payload)
    ok = code == 0
    check(f'--fast {name} → 0', ok, f'(实际 {code})')
    if ok:
        try:
            got = json.loads(out.strip().splitlines()[-1])
            check(f'--fast {name} UFP 口径', got.get('ufp') == exp_ufp,
                  f'(期望 {exp_ufp} 实际 {got.get("ufp")})')
        except Exception as e:
            check(f'--fast {name} 输出可解析', False, str(e))

# 3b) --fast 不得依赖 xlsx 栈：gb_engine 无第三方依赖，快算应在缺 openpyxl 的
#     解释器上照样成功（T01503 实测：曾因统一 import server 而被拖成退出码 2）。
#     用 -S 隔离 site-packages 模拟「无第三方依赖」环境，不改动用户环境。
_pure = subprocess.run([sys.executable, '-S', '-c',
                        'import sys;sys.path.insert(0,"scripts");import gb_engine;print("ok")'],
                       capture_output=True, text=True, cwd=ROOT)
if _pure.returncode == 0:
    p = subprocess.run([sys.executable, '-S', CLI, '--fast', 'pre'],
                       input='{"ILF":3,"EIF":2}', capture_output=True, text=True,
                       encoding='utf-8', errors='replace', timeout=120, cwd=ROOT)
    check('--fast 无第三方依赖环境 → 0', p.returncode == 0, f'(实际 {p.returncode}) {p.stderr.strip()[-120:]}')
else:
    print("  SKIP  --fast 无依赖环境（当前解释器 -S 仍可见 site-packages）")

# 4) 端到端：真实 docx → 成品 xlsx（仅在夹具存在时跑）
if os.path.isfile(DOCX):
    outdir = tempfile.mkdtemp(prefix='we_cli_')
    out_xlsx = os.path.join(outdir, 'e2e.xlsx')
    code, out = run(['--docx', DOCX, '--out', out_xlsx])
    check('端到端生成 → 0', code == 0, f'(实际 {code}) {out.strip()[-200:] if code else ""}')
    check('成品 xlsx 落盘', os.path.isfile(out_xlsx) and os.path.getsize(out_xlsx) > 0)
else:
    print(f"  SKIP  端到端（夹具缺失: {DOCX}）")

print(f"==== S10 汇总 ==== 失败 {len(fails)}")
sys.exit(1 if fails else 0)
