# -*- coding: utf-8 -*-
"""T00630：构建前生成唯一 patch 版本号写回根 package.json。
patch 号格式：YYYYMMDD-NNN（8 位日期 + 当日内递增序号，跨天重置为 001）。
版本形如 0.1.20260916-001；序号存储于 version 自身（同日期再次构建自动 +1）。
被 构建打包.bat 在打包前调用；也可手动执行。"""
import datetime
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PKG = os.path.join(ROOT, "package.json")


def bump():
    today = datetime.date.today().strftime("%Y%m%d")
    with open(PKG, encoding="utf-8") as f:
        pkg = json.load(f)
    ver = pkg.get("version", "0.1.0")
    m = re.match(r"^(\d+)\.(\d+)\.", ver)
    major, minor = (m.group(1), m.group(2)) if m else ("0", "1")
    seq = 1
    m2 = re.match(rf"^{major}\.{minor}\.{today}-(\d+)$", ver)
    if m2:                                   # 同一天再次构建：序号递增
        seq = int(m2.group(1)) + 1
    new = f"{major}.{minor}.{today}-{seq:03d}"
    pkg["version"] = new
    with open(PKG, "w", encoding="utf-8") as f:
        json.dump(pkg, f, indent=2, ensure_ascii=False)
        f.write("\n")
    # electron-builder 的 version/artifactName 取自 app 目录（dev-shell）的 package.json，需同步双写
    app_pkg_path = os.path.join(ROOT, "dev-shell", "package.json")
    with open(app_pkg_path, encoding="utf-8") as f:
        app_pkg = json.load(f)
    app_pkg["version"] = new
    with open(app_pkg_path, "w", encoding="utf-8") as f:
        json.dump(app_pkg, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"[version] {ver} -> {new}")
    return new


if __name__ == "__main__":
    bump()
    sys.exit(0)
