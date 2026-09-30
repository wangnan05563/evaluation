import openpyxl
p = r"C:\Users\hspcadmin\Desktop\工作量评估\阜新银行-票据系统优化-工作量评估V2.0.xlsx"
wb = openpyxl.load_workbook(p, data_only=False)
ws = wb["项目工作量估算表"]
print("=== merged ranges (row-wise) ===")
for mc in sorted(ws.merged_cells.ranges, key=lambda r:(r.min_row,r.min_col)):
    print(f"  {mc}: min_row={mc.min_row} col={mc.min_col} → value={ws.cell(mc.min_row,mc.min_col).value!r}")
print("\n=== 行数 ===")
print("max_row", ws.max_row, "max_col", ws.max_column)
print("\n=== H列公式 (row 8,13,31,32,35,36) ===")
for r in [8,13,31,32,35,36,40]:
    print(f"  H{r}={ws.cell(r,8).value!r}")
print("\n=== I列公式 ===")
for r in [6,8,31,32,33,34,35,40]:
    print(f"  I{r}={ws.cell(r,9).value!r}")
print("\n=== E/F/G 样例(开发明细) ===")
for r in range(8,12):
    print(f"  R{r}: B={ws.cell(r,2).value!r} C={ws.cell(r,3).value!r} D={ws.cell(r,4).value!r} E={ws.cell(r,5).value} F={ws.cell(r,6).value} G={ws.cell(r,7).value}")