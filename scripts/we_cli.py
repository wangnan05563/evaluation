# -*- coding: utf-8 -*-
"""M9/FR-2.10（FE10）：命令行 / 无人值守模式。
用法：python scripts/we_cli.py --docx xx.docx --out out.xlsx [--method 估算功能点] [--fast pre|est]
退出码：0 成功；2 输入非法；3 生成失败。无 GUI 依赖。"""
import argparse
import base64
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def main():
    ap = argparse.ArgumentParser(description="工作量评估命令行模式（FR-2.10）")
    ap.add_argument("--docx", help="需求文档（.docx）；--fast 模式可省略")
    ap.add_argument("--out", help="输出成品表 xlsx 路径；--fast 模式可省略")
    ap.add_argument("--method", default="估算功能点", choices=["估算功能点", "预估功能点"])
    ap.add_argument("--fast", choices=["pre", "est"], default=None,
                    help="NESMA 快算模式（pre=预估法/est=估算法）；指定时跳过文档识别")
    args = ap.parse_args()

    import server  # 初始化引擎/规则/费率（serve 在 __main__ 守卫内，不会启动 HTTP）
    if not args.fast and (not args.out or not os.path.exists(args.docx)):
        print(f"[cli] 文档不存在: {args.docx}", file=sys.stderr)
        return 2
    try:
        if args.fast:
            # NESMA 快算口径：仅估算 UFP 并以预估区间输出（无明细母版）
            import gb_engine as gb
            counts = json.loads(_stdin_counts() or "{}")
            ufp = gb.nesma_ufp(counts, args.fast)
            cost = gb.gb_cost(ufp, 1.0, gb.CF["需求"], 1.0, 1.0, 6.96, 28000)
            print(json.dumps({"mode": "nesma_" + args.fast, "ufp": ufp,
                              "fee": cost["fee"]}, ensure_ascii=False))
            return 0
        items, _llm_meta = server.recognize_doc(args.docx)   # 返回 (items, llm_meta) 元组
        if not items:
            print("[cli] 未识别出功能点候选", file=sys.stderr)
            return 2
        for it in items:                      # 无人值守：全确认
            it["ok"] = True
        server.g.run_from_json(items, args.out, method=args.method)
        print(f"[cli] 生成完成: {args.out}（{len(items)} 条功能点）")
        return 0
    except Exception as e:
        print(f"[cli] 生成失败: {type(e).__name__}: {e}", file=sys.stderr)
        return 3


def _stdin_counts():
    try:
        import select
        if select.select([sys.stdin], [], [], 0.1)[0]:
            return sys.stdin.read()
    except Exception:
        pass
    return None


if __name__ == "__main__":
    sys.exit(main())
