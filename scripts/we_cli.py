# -*- coding: utf-8 -*-
"""M9/FR-2.10（FE10）：命令行 / 无人值守模式。
用法：python scripts/we_cli.py --docx xx.docx --out out.xlsx [--method 估算功能点] [--fast pre|est]
退出码：0 成功；2 输入非法（含缺依赖）；3 生成失败。无 GUI 依赖。

FR-FE10 无人值守的关键是「退出码可信」：调度脚本靠退出码判断成败，
因此参数校验必须早于任何重量级初始化，且失败路径不得吐traceback。
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

EXIT_OK, EXIT_BAD_INPUT, EXIT_FAIL = 0, 2, 3

# stdin 只能读一次：validate 与执行阶段共用同一份缓存，避免二次读取拿到空串
_STDIN_CACHE = []


def _stdin_counts():
    """读 stdin 计数 JSON（仅一次）。无输入返回 None。

    不用 select 探测：Windows 上 select 只支持套接字，对管道直接抛
    OSError(WinError 10038)，旧实现把它吞掉当“无输入”，导致 --fast 在
    Windows 恒读到空 → UFP=0 却以退出码 0 报成功（假成功）。
    改为按isatty 区分：TTY 说明是交互式人工运行（不阻塞等输入）；
    非 TTY 说明是重定向/管道，此时读至 EOF 即可。
    """
    if _STDIN_CACHE:
        return _STDIN_CACHE[0]
    val = None
    try:
        if not sys.stdin.closed and not sys.stdin.isatty():
            raw = sys.stdin.read()
            if raw and raw.strip():
                val = raw.strip()
    except Exception:
        val = None
    _STDIN_CACHE.append(val)
    return val


def _bad(msg):
    print(f"[cli] 参数错误: {msg}", file=sys.stderr)
    return EXIT_BAD_INPUT


def validate(args):
    """纯参数校验：不 import 任何业务模块。返回错误信息（None = 合法）。

    放在 import server 之前是刻意的：server 导入链会连带 openpyxl/python-docx、
    datakeeper 备份与建表，既慢又会在缺依赖时抛栈 traceback（退出码 1），
    与「2 = 输入非法」的约定冲突。
    """
    if args.fast:
        # 快算：计数从 stdin 读；必须有内容，否则 UFP 恒为 0 却报成功（假成功）
        raw = _stdin_counts()
        if raw is None:
            return "--fast 模式需从 stdin 读入计数 JSON（如 '{\"ILF\":3}'）；无输入时无法估算"
        try:
            counts = json.loads(raw)
        except ValueError as e:
            return f"stdin 计数不是合法 JSON: {e}"
        if not isinstance(counts, dict):
            return "stdin 计数须为 JSON 对象（如 '{\"ILF\":3,\"EIF\":2}'）"
        return None
    if not args.docx:
        return "缺少 --docx（需求文档路径）"
    if not args.out:
        return "缺少 --out（输出 xlsx 路径）"
    if not os.path.isfile(args.docx):
        return f"文档不存在: {args.docx}"
    if not args.docx.lower().endswith(".docx"):
        return f"仅支持 .docx 需求文档: {args.docx}"
    outdir = os.path.dirname(os.path.abspath(args.out))
    if not os.path.isdir(outdir):
        return f"输出目录不存在: {outdir}"
    return None


def main():
    ap = argparse.ArgumentParser(description="工作量评估命令行模式（FR-2.10）")
    ap.add_argument("--docx", help="需求文档（.docx）；--fast 模式可省略")
    ap.add_argument("--out", help="输出成品表 xlsx 路径；--fast 模式可省略")
    ap.add_argument("--method", default="估算功能点", choices=["估算功能点", "预估功能点"])
    ap.add_argument("--fast", choices=["pre", "est"], default=None,
                    help="NESMA 快算模式（pre=预估法/est=估算法）；指定时跳过文档识别，计数从 stdin 读 JSON")
    args = ap.parse_args()

    err = validate(args)
    if err:
        return _bad(err)

    # 依赖缺失归为「输入非法」而非崩溃：无人值守调度只认 0/2/3 三档。
    # 快算分支刻意不 import server —— gb_engine 无第三方依赖，快算不该被
    # openpyxl/python-docx 拖累（仅需估算 UFP 时强依赖 xlsx 栈不合理）。
    if args.fast:
        try:
            import gb_engine as gb
        except ImportError as e:
            return _bad(f"缺少 Python 依赖（{e.name}）")
        try:
            counts = json.loads(_stdin_counts() or "{}")
            ufp = gb.nesma_ufp(counts, args.fast)
            cost = gb.gb_cost(ufp, 1.0, gb.CF["需求"], 1.0, 1.0, 6.96, 28000)
            print(json.dumps({"mode": "nesma_" + args.fast, "ufp": ufp,
                              "fee": cost["fee"]}, ensure_ascii=False))
            return EXIT_OK
        except Exception as e:
            print(f"[cli] 生成失败: {type(e).__name__}: {e}", file=sys.stderr)
            return EXIT_FAIL

    try:
        import server  # 初始化引擎/规则/费率（serve 在 __main__ 守卫内，不会启动 HTTP）
    except ImportError as e:
        return _bad(f"缺少 Python 依赖（{e.name}），请先 pip install python-docx openpyxl")

    try:
        items, _llm_meta = server.recognize_doc(args.docx)   # 返回 (items, llm_meta) 元组
        if not items:
            print("[cli] 未识别出功能点候选", file=sys.stderr)
            return EXIT_BAD_INPUT
        for it in items:                      # 无人值守：全确认
            it["ok"] = True
        server.g.run_from_json(items, args.out, method=args.method)
        print(f"[cli] 生成完成: {args.out}（{len(items)} 条功能点）")
        return EXIT_OK
    except Exception as e:
        print(f"[cli] 生成失败: {type(e).__name__}: {e}", file=sys.stderr)
        return EXIT_FAIL


if __name__ == "__main__":
    sys.exit(main())
