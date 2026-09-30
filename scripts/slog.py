# -*- coding: utf-8 -*-
"""M8/FR-5.4：结构化日志（JSON 行，ts/level/module/event/duration_ms）。
print 保留（兼容既有日志 grep 与 M4 套件）。"""
import json
import os
import time


class Slog:
    def __init__(self, path):
        self.path = str(path)
        os.makedirs(os.path.dirname(self.path), exist_ok=True)

    def log(self, level, module, event, **kv):
        rec = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S"), "level": level,
               "module": module, "event": event}
        rec.update(kv)
        try:
            with open(self.path, "a", encoding="utf-8") as f:
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        except Exception:
            pass
        print(f"[{level}][{module}] {event} {kv if kv else ''}", flush=True)

    def info(self, module, event, **kv):
        self.log("info", module, event, **kv)

    def warn(self, module, event, **kv):
        self.log("warn", module, event, **kv)

    def error(self, module, event, **kv):
        self.log("error", module, event, **kv)

    def timer(self, module, event):
        """用法：with slog.timer('generate','run'): ... —— 记录耗时（duration_ms）。"""
        t0 = time.time()
        ctx = {"_t0": t0}

        class _T:
            def __enter__(self):
                return ctx
            def __exit__(self, et, ev, tb):
                self.log(("error" if et else "info"), module, event, duration_ms=int((time.time()-t0)*1000))
        return _T()
