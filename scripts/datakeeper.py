# -*- coding: utf-8 -*-
"""M8/FR-5.6：数据备份（启动自动备份保留 N 份）+ schema 版本迁移框架 + 全量导出/导入。"""
import json
import os
import shutil
import time
import zipfile

SCHEMA_VER = 1            # 数据结构版本号（首版；后续迁移在此登记）
KEEP_BACKUPS = 7          # FR-5.6：备份保留 N 份

# 迁移登记表：{from_ver: 升级函数(data_dir)->None}，逐级幂等执行
MIGRATIONS = {}


def _migrate(data_dir):
    ver_path = os.path.join(data_dir, "schema_ver")
    cur = 1
    if os.path.exists(ver_path):
        try:
            cur = int(open(ver_path, encoding="utf-8").read().strip() or 1)
        except Exception:
            cur = 1
    applied = []
    while cur in MIGRATIONS:
        fn = MIGRATIONS[cur]
        try:
            fn(data_dir)
            applied.append(cur)
        except Exception:
            break                                   # 迁移失败不阻塞启动
        cur += 1
    if applied:
        try:
            with open(ver_path, "w", encoding="utf-8") as f:
                f.write(str(cur))
        except Exception:
            pass
    elif not os.path.exists(ver_path):
        try:
            with open(ver_path, "w", encoding="utf-8") as f:
                f.write(str(SCHEMA_VER))
        except Exception:
            pass
    return cur, applied


def backup_on_start(data_dir, keep=KEEP_BACKUPS):
    """FR-5.6：启动时备份 pert.db + 三个 json 到 backups/<ts>/，保留最近 keep 份。"""
    files = [n for n in ("pert.db", "estimation.db", "recognition_rules.json",
                         "rates_versions.json") if os.path.exists(os.path.join(data_dir, n))]
    if not files:
        return None
    ts = time.strftime("%Y%m%d-%H%M%S")
    dst = os.path.join(data_dir, "backups", ts)
    os.makedirs(dst, exist_ok=True)
    for n in files:
        try:
            shutil.copy2(os.path.join(data_dir, n), os.path.join(dst, n))
        except Exception:
            pass
    root = os.path.join(data_dir, "backups")
    olds = sorted(d for d in os.listdir(root) if os.path.isdir(os.path.join(root, d)))
    for d in olds[:-keep]:
        try:
            shutil.rmtree(os.path.join(root, d))
        except Exception:
            pass
    return dst


def export_zip(data_dir, out_path):
    """FR-5.6：导出全部数据（pert.db + json + schema_ver），不含 uploads/generated。"""
    names = [n for n in ("pert.db", "estimation.db", "recognition_rules.json",
                         "rates_versions.json", "schema_ver")
             if os.path.exists(os.path.join(data_dir, n))]
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as z:
        for n in names:
            z.write(os.path.join(data_dir, n), n)
    return names


def import_zip(zip_path, data_dir):
    """FR-5.6：导入全部数据。校验 schema_ver 不高于当前（防降级/损坏）；导入前先自动备份一份。"""
    bad = zipfile.BadZipFile
    try:
        with zipfile.ZipFile(zip_path) as z:
            names = z.namelist()
            if "pert.db" not in names:
                raise VImportErr("缺少 pert.db，不是有效的数据包")
            if "schema_ver" in names:
                try:
                    pkg_ver = int(z.read("schema_ver").decode().strip() or 1)
                except Exception:
                    pkg_ver = 1
                if pkg_ver > SCHEMA_VER:
                    raise VImportErr(f"数据包 schema 版本 {pkg_ver} 高于当前 {SCHEMA_VER}，请先升级应用")
            backup_on_start(data_dir, keep=3)      # 导入前自动留档
            for n in ("pert.db", "recognition_rules.json", "rates_versions.json", "schema_ver"):
                if n in names:
                    z.extract(n, data_dir)
            return names
    except bad:
        raise VImportErr("不是有效的 zip 数据包")
    except VImportErr:
        raise
    except Exception as e:
        raise VImportErr(f"导入失败：{e}")


class VImportErr(Exception):
    pass
