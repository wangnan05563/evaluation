# -*- coding: utf-8 -*-
"""读取成品母版中的公式，为模板生成器提供保真依据。"""
import openpyxl

TPL = r"C:\Users\hspcadmin\Desktop\工作量评估\副本造价评估-天津银行_票据新增五篇大文章标识功能项目（软件开发功能点评估）_KX_20251027_V1.0.xlsx"

wb = openpyxl.load_workbook(TPL, data_only=False)
for sh in ["项目特征", "规模估算", "费用估算"]:
    ws = wb[sh]
    print(f"===== {sh} ({ws.dimensions}) =====")
    for row in ws.iter_rows():
        for c in row:
            v = c.value
            if isinstance(v, str) and v.startswith("="):
                print(f"{c.coordinate}\t{v}")
    print()