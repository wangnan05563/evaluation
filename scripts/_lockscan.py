# -*- coding: utf-8 -*-
# 只读探测：用 CreateFileW 独占方式(share=0)打开目标文件，判断是否被进程占用。
# 不写入、不删除，纯检测。
import os
import ctypes
from ctypes import wintypes

CreateFileW = ctypes.windll.kernel32.CreateFileW
CloseHandle = ctypes.windll.kernel32.CloseHandle
CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                        wintypes.LPVOID, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
CreateFileW.restype = wintypes.HANDLE
INVALID_HANDLE_VALUE = wintypes.HANDLE(-1).value
GENERIC_READ = 0x80000000
FILE_SHARE_NONE = 0
OPEN_EXISTING = 3


def locked(path):
    h = CreateFileW(path, GENERIC_READ, FILE_SHARE_NONE, None, OPEN_EXISTING, 0x80, None)
    if h == INVALID_HANDLE_VALUE:
        return True, ctypes.GetLastError()
    CloseHandle(h)
    return False, 0


ROOT = r"D:\code\otherProjects\27_Evaluation\release"
targets = []
for rel in [
    r"exe\工作量评估工具.exe",
    r"workload-estimate.zip",
    r"installer\win-unpacked\resources\app.asar",
    r"installer\win-unpacked\resources\we-eval\工作量评估工具.exe",
    r"installer_20260916_013352\win-unpacked\resources\app.asar",
    r"installer_20260916_013352\WorkloadEstimate-0.1.0-setup.exe",
    r"win-unpacked\resources\app.asar",
]:
    p = os.path.join(ROOT, rel)
    if os.path.exists(p):
        lk, err = locked(p)
        print(("LOCKED " if lk else "FREE   ") + "err=%-5d " % err + rel)
    else:
        print("MISSING        " + rel)
