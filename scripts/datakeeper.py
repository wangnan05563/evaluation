# -*- coding: utf-8 -*-
"""M8/FR-5.6：数据备份（启动自动备份保留 N 份）+ schema 版本迁移框架 + 全量导出/导入。"""
import json
import os
import shutil
import sqlite3
import time
import zipfile

SCHEMA_VER = 2            # 数据结构版本号（首版；后续迁移在此登记）
KEEP_BACKUPS = 7          # FR-5.6：备份保留 N 份

# T01501（python:S1192）：备份/导出/导入三处反复出现的数据文件名，提取为常量。
# 原为 4 个字面量在 3 个函数里重复内联，改名/增删须同步 4 处，易漏。
F_PERT_DB = "pert.db"                        # PERT 三点估算库
F_ESTIMATION_DB = "estimation.db"            # M1 估算历史库
F_RECOGNITION_RULES = "recognition_rules.json"   # 识别规则表
F_RATES_VERSIONS = "rates_versions.json"     # 费率版本表
F_SCHEMA_VER = "schema_ver"                  # schema 版本标记文件
# 参与备份的数据文件（不含 schema_ver：它随迁移写入，单独处理）
DATA_FILES = (F_PERT_DB, F_ESTIMATION_DB, F_RECOGNITION_RULES, F_RATES_VERSIONS)
# 参与导出的数据文件 = 备份集 + schema_ver
EXPORT_FILES = DATA_FILES + (F_SCHEMA_VER,)

# 迁移登记表：{from_ver: 升级函数(data_dir)->None}，逐级幂等执行
def _m_pert_gen_naming(data_dir):
    """v1→v2（T01573）：pert.db projects 增加 doc_name / gen_count。
    成品表命名需记住需求导入的文档基名并按项目自增版本（V1、V2…）。
    幂等：先查 PRAGMA table_info，缺列才 ALTER；老库无 pert.db 时跳过。"""
    db = os.path.join(data_dir, F_PERT_DB)
    if not os.path.exists(db):
        return
    con = sqlite3.connect(db, timeout=15)
    try:
        cols = {r[1] for r in con.execute("PRAGMA table_info(projects)")}
        if "doc_name" not in cols:
            con.execute("ALTER TABLE projects ADD COLUMN doc_name TEXT DEFAULT ''")
        if "gen_count" not in cols:
            con.execute("ALTER TABLE projects ADD COLUMN gen_count INTEGER DEFAULT 0")
        con.commit()
    finally:
        con.close()


MIGRATIONS = {1: _m_pert_gen_naming}


def _migrate(data_dir):
    ver_path = os.path.join(data_dir, F_SCHEMA_VER)
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
    files = [n for n in DATA_FILES if os.path.exists(os.path.join(data_dir, n))]
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
    names = [n for n in EXPORT_FILES if os.path.exists(os.path.join(data_dir, n))]
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
            if F_PERT_DB not in names:
                raise VImportErr(f"缺少 {F_PERT_DB}，不是有效的数据包")
            if F_SCHEMA_VER in names:
                try:
                    pkg_ver = int(z.read(F_SCHEMA_VER).decode().strip() or 1)
                except Exception:
                    pkg_ver = 1
                if pkg_ver > SCHEMA_VER:
                    raise VImportErr(f"数据包 schema 版本 {pkg_ver} 高于当前 {SCHEMA_VER}，请先升级应用")
            backup_on_start(data_dir, keep=3)      # 导入前自动留档
            for n in (F_PERT_DB, F_RECOGNITION_RULES, F_RATES_VERSIONS, F_SCHEMA_VER):
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
