# -*- coding: utf-8 -*-
# 定位占用指定文件/目录的进程（只读，不修改任何东西）。
# 用法: python scripts\_rm_locks.py <路径> [<路径> ...]
#   - 传目录则递归收集其下文件（上限 5000），分块交给 Restart Manager 查询
# 注意：RmProcessInfo 里 FILETIME 必须按 8 字节对齐（这里用 c_uint64 承载），
# 否则结构比真实定义小 4 字节，RmGetList 写越界会直接段错误。
import os
import sys
import ctypes
from ctypes import byref, POINTER, c_uint32, c_wchar, c_int32, c_uint64, Structure, create_unicode_buffer

rm = ctypes.windll.rstrtmgr
ERROR_MORE_DATA = 234
MAX_FILES = 5000
CHUNK = 50


class FILETIME(Structure):
    _fields_ = [("ft", c_uint64)]


class RmProcessInfo(Structure):
    _fields_ = [
        ("dwProcessId", c_uint32),
        ("ProcessStartTime", FILETIME),
        ("strAppName", c_wchar * 256),
        ("strServiceShortName", c_wchar * 64),
        ("ApplicationType", c_uint32),
        ("AppStatus", c_uint32),
        ("TSSessionId", c_uint32),
        ("bRestartable", c_int32),
    ]


rm.RmStartSession.argtypes = [POINTER(c_uint32), c_uint32, ctypes.c_wchar_p]
rm.RmStartSession.restype = c_uint32
rm.RmRegisterResources.argtypes = [c_uint32, c_uint32, POINTER(ctypes.c_wchar_p),
                                   c_uint32, ctypes.c_void_p, c_uint32, POINTER(ctypes.c_wchar_p)]
rm.RmRegisterResources.restype = c_uint32
rm.RmGetList.argtypes = [c_uint32, POINTER(c_uint32), POINTER(c_uint32),
                         POINTER(RmProcessInfo), POINTER(c_uint32)]
rm.RmGetList.restype = c_uint32
rm.RmEndSession.argtypes = [c_uint32]
rm.RmEndSession.restype = c_uint32


def query(paths):
    """返回 {pid: appName}"""
    sess = c_uint32(0)
    key = create_unicode_buffer("{2C6D5A31-9E4B-4F7A-8B21-7A0C5E1D9F43}")
    if rm.RmStartSession(byref(sess), 0, key) != 0:
        return {}
    arr = (ctypes.c_wchar_p * len(paths))(*paths)
    if rm.RmRegisterResources(sess, len(paths), arr, 0, None, 0, None) != 0:
        rm.RmEndSession(sess)
        return {}
    needed = c_uint32(0)
    rc = rm.RmGetList(sess, byref(needed), byref(c_uint32(0)), None, byref(c_uint32(0)))
    found = {}
    if rc in (0, ERROR_MORE_DATA):
        n = max(needed.value, 1)
        buf = (RmProcessInfo * n)()
        cnt = c_uint32(n)
        reasons = c_uint32(0)
        if rm.RmGetList(sess, byref(needed), byref(cnt), buf, byref(reasons)) == 0:
            for i in range(cnt.value):
                p = buf[i]
                found[p.dwProcessId] = p.strAppName or "(unknown)"
    rm.RmEndSession(sess)
    return found


def collect(target):
    files = []
    if os.path.isfile(target):
        files.append(target)
    elif os.path.isdir(target):
        for root, _, names in os.walk(target):
            for nm in names:
                files.append(os.path.join(root, nm))
                if len(files) >= MAX_FILES:
                    return files
    return files


def is_locked(path):
    """独占方式尝试打开；返回 True 表示被占用"""
    create_file_w = ctypes.windll.kernel32.CreateFileW
    create_file_w.argtypes = [ctypes.c_wchar_p, ctypes.c_uint32, ctypes.c_uint32,
                              ctypes.c_void_p, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p]
    CreateFileW.restype = ctypes.c_void_p
    h = create_file_w(path, 0x80000000, 0, None, 3, 0x80, None)
    if not h or h == ctypes.c_void_p(-1).value:
        return True
    ctypes.windll.kernel32.CloseHandle(ctypes.c_void_p(h))
    return False


def main(argv):
    if len(argv) < 2:
        print("用法: python _rm_locks.py <文件或目录> [...]")
        return 1
    files = []
    for a in argv[1:]:
        files.extend(collect(a))
    if not files:
        print("没有可检测的文件:", argv[1:])
        return 0
    print("检测文件数:", len(files))
    locked = [p for p in files if is_locked(p)]
    if not locked:
        print("全部文件均可删除（无占用）")
        return 0
    print("无法删除的文件 %d 个:" % len(locked))
    for p in locked[:50]:
        print("  " + p)
    if len(locked) > 50:
        print("  ... 其余 %d 个省略" % (len(locked) - 50))
    agg = {}
    for i in range(0, len(locked), CHUNK):
        agg.update(query(locked[i:i + CHUNK]))
    if not agg:
        print("未能定位占用进程（多为内核态/杀软句柄）")
        return 0
    print("占用进程:")
    for pid, name in sorted(agg.items()):
        print("  PID=%-8d %s" % (pid, name))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
