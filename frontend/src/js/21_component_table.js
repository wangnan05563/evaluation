/* ===== M9/FR-3.3（UI03）：复核表格组件化——虚拟滚动窗口助手（IFPUG 复核已接入，PERT 可复用） ===== */
const CT = { rowH: 44, over: 15, threshold: 120 };   // 行高估测 / 视口外余量 / 虚拟化阈值
let CT_SC = null, CT_VPH = 600;
function ctScrollParent(el) {
  if (CT_SC && CT_SC.contains(el)) return CT_SC;   // 缓存：滚动容器/视口高每帧不再强制布局
  let p = el && el.parentElement;
  while (p) { const cs = getComputedStyle(p); if (/(auto|scroll)/.test(cs.overflowY)) { CT_SC = p; CT_VPH = p.clientHeight; return p; } p = p.parentElement; }
  return null;
}
function ctWindow(total, scrollTop, viewportH) {
  const first = Math.max(0, Math.floor(scrollTop / CT.rowH) - CT.over);
  const count = Math.min(total - first, Math.ceil(viewportH / CT.rowH) + CT.over * 2);
  return { first, count };
}
/* 虚拟渲染：spacer 行补位 + 视口窗口行；rowHtmlFn(it, extra) 生成行 HTML（extra 含 cur/showb 状态）。
   无回归策略：仅在行数 > CT.threshold 时启用窗口路径，小列表保持全量渲染。 */
function ctRenderVirtual(tbody, arr, rowHtmlFn, cur, showbSet) {
  const sc = ctScrollParent(tbody);
  const vpH = sc ? (CT_VPH || sc.clientHeight) : 600;
  const st = sc ? sc.scrollTop : 0;
  let { first, count } = ctWindow(arr.length, st, vpH);
  if (cur != null) {                       // 键盘焦点行必须在窗口内
    const idx = arr.findIndex(x => x.seq === cur);
    if (idx >= 0) {
      if (idx < first) first = Math.max(0, idx - 5);
      else if (idx >= first + count) { first = Math.min(arr.length - 1, idx - count + 10); count = Math.min(arr.length - first, count); }
    }
  }
  const slice = arr.slice(first, first + count);
  const top = first, bot = arr.length - first - slice.length;
  tbody.innerHTML =
    `<tr class="vsp" style="height:${top * CT.rowH}px"><td colspan="9"></td></tr>` +
    slice.map(it => rowHtmlFn(it).replace('class="rowr', `class="rowr ${it.seq === cur ? "cur" : ""} ${showbSet && showbSet.has(it.seq) ? "showb" : ""}"`)).join("") +
    `<tr class="vsp" style="height:${bot * CT.rowH}px"><td colspan="9"></td></tr>`;
  return { first, count };
}
function ctBindScroll(tbody, onWin) {
  const sc = ctScrollParent(tbody);
  if (!sc || sc.dataset.ctBound) return;
  sc.dataset.ctBound = "1";
  let raf = 0;
  sc.addEventListener("scroll", () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; onWin(); }); }, { passive: true });
}
