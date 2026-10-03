/* ===== FR-UI04（上传与步骤动效） + FR-UI07（空态与错误插画） =====
 *
 * 背景（T01503 核实）：拖拽高亮、prefers-reduced-motion、步骤淡入初始提交即有，
 * 真正缺的是「等待态可视」（骨架屏）与「空/错态插画」。本模块补这两块。
 *
 * 设计约束：
 * 1) 骨架屏与插画一律走 CSS 变量取色，天然适配亮/暗/高对比三态，不硬编码颜色；
 * 2) 动画全部声明在 @media (prefers-reduced-motion: no-preference) 内，
 *    用户开启「减少动态效果」时零动画（降级为静态占位，不是白屏）；
 * 3) 插画为纯装饰，aria-hidden 且不抢读屏顺序，语义由标题/描述文本承担。
 */

/* ---------- FR-UI04：骨架屏 ---------- */
/* 列宽比例按各表真实列数给定，避免加载完成时表格列宽跳动（CLS） */
const SKEL_ROWS = {
  6: [22, 34, 16, 10, 10, 8],       // 历史表：时间/标题/规模/工作量/费用/操作
  8: [20, 30, 12, 12, 10, 10, 14, 10], // 规则表
};
function skeletonTable(span, rows){
  const n = rows || 4, widths = SKEL_ROWS[span] || [];
  let out = "";
  for (let r = 0; r < n; r++){
    out += "<tr class='skel-row'>";
    for (let c = 0; c < span; c++){
      // 末列固定留操作位宽度，列宽稳定；每格错开动画延迟形成「流光」而非整体闪烁
      const w = widths[c] || Math.round(100 / span);
      const d = ((r * span + c) % 6) * 90;
      out += `<td><span class="skel-bar" style="width:${w}%;animation-delay:${d}ms"></span></td>`;
    }
    out += "</tr>";
  }
  return out;
}
/** 供异步列表调用：进入骨架 → 回调填充 → 失败走 errorBox */
function withSkeleton(tbodySel, span, loader){
  const el = $(tbodySel);
  if (!el) return Promise.resolve();
  el.innerHTML = skeletonTable(span);
  return Promise.resolve()
    .then(loader)
    .catch(e => { el.innerHTML = `<tr><td colspan="${span}">${errorBox(e.message, tbodySel)}</td></tr>`; throw e; });
}

/* ---------- FR-UI07：统一插画 ---------- */
/* 线性插画风格：同一 viewBox / 同一 stroke 逻辑，视觉重量一致。
   用 currentColor + 令牌变量，随主题切换，无需为每套主题各画一版。 */
const ILLUS = {
  /* 空数据：收纳盒 + 上浮卡片，表达「还没东西进来」而非「出错」 */
  empty: `<svg viewBox="0 0 120 88" fill="none" aria-hidden="true">
    <rect x="14" y="30" width="92" height="46" rx="8" fill="var(--surface-2)" stroke="var(--line)" stroke-width="2"/>
    <path d="M14 42h92" stroke="var(--line)" stroke-width="2"/>
    <rect x="30" y="12" width="60" height="26" rx="6" fill="var(--card)" stroke="var(--line-ctrl)" stroke-width="2"/>
    <path d="M40 25h40" stroke="var(--muted)" stroke-width="2.5" stroke-linecap="round" opacity=".55"/>
    <path d="M46 62h28" stroke="var(--brand)" stroke-width="2.5" stroke-linecap="round"/>
  </svg>`,
  /* 搜索无果：放大镜掠过列表，表达「换个条件再试」，引导而非报错 */
  search: `<svg viewBox="0 0 120 88" fill="none" aria-hidden="true">
    <rect x="16" y="16" width="66" height="56" rx="7" fill="var(--surface-2)" stroke="var(--line)" stroke-width="2"/>
    <path d="M28 32h34M28 44h42M28 56h24" stroke="var(--muted)" stroke-width="2.5" stroke-linecap="round" opacity=".5"/>
    <circle cx="80" cy="50" r="17" fill="var(--card)" stroke="var(--brand)" stroke-width="2.5"/>
    <path d="M92 63l12 12" stroke="var(--brand)" stroke-width="3" stroke-linecap="round"/>
    <path d="M74 50h12M80 44v12" stroke="var(--brand)" stroke-width="2.5" stroke-linecap="round" opacity=".7"/>
  </svg>`,
  /* 错误：断开的圆 + 感叹号，用 danger 语义色，区别于空态的中性色 */
  error: `<svg viewBox="0 0 120 88" fill="none" aria-hidden="true">
    <circle cx="60" cy="44" r="28" fill="var(--danger-soft)" stroke="var(--danger)" stroke-width="2.5"/>
    <path d="M60 30v18" stroke="var(--danger)" stroke-width="3.5" stroke-linecap="round"/>
    <circle cx="60" cy="56" r="2.4" fill="var(--danger)"/>
    <path d="M28 70l-6 8M92 70l6 8" stroke="var(--danger)" stroke-width="2.5" stroke-linecap="round" opacity=".45"/>
  </svg>`,
  /* 上传：托盘 + 上升箭头，与 drop 区交互呼应 */
  upload: `<svg viewBox="0 0 120 88" fill="none" aria-hidden="true">
    <path d="M22 62v10a6 6 0 006 6h64a6 6 0 006-6V62" stroke="var(--drop-line)" stroke-width="2.5" stroke-linecap="round"/>
    <rect x="38" y="34" width="44" height="32" rx="6" fill="var(--brand-soft)" stroke="var(--brand)" stroke-width="2"/>
    <path d="M60 54V22M60 22l-9 9M60 22l9 9" stroke="var(--brand)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
};
/* 插画语义 → 具体图形的映射，供 emptyState 复用 */
const ILLUS_KIND = { "inbox": "empty", "inbox-open": "empty", "search-x": "search", "alert-triangle": "error", "file-up": "upload" };

/** 统一空态：插画 + 标题 + 描述 + 可选一键动作（FR-UX06 已有的文案骨架保留，此处补插画与语义容器） */
function emptyState(icon, title, desc, actionHtml){
  const art = ILLUS[ILLUS_KIND[icon] || "empty"] || ILLUS.empty;
  return `<div class="empty-state" role="status">
    <div class="empty-art" aria-hidden="true">${art}</div>
    <div class="empty-t">${title}</div>
    <div class="empty-d">${desc}</div>
    ${actionHtml ? `<div class="empty-a">${actionHtml}</div>` : ""}
  </div>`;
}

/** 统一错误态：danger 插画 + 原因 + 重试/诊断（保留原 errorBox 语义，补插画与 role=alert） */
function errorBox(msg, retryFn){
  return `<div class="empty-state" role="alert">
    <div class="empty-art" aria-hidden="true">${ILLUS.error}</div>
    <div class="empty-t">操作失败</div>
    <div class="empty-d">${histEsc(msg)}</div>
    <div class="empty-a">
      <button class="btn btn-ghost" onclick="${retryFn}">重试</button>
      <a href="#" onclick="goPage('help');return false" class="empty-link">查看诊断指引</a>
    </div>
  </div>`;
}

/* ---------- 拖拽高亮增强（FR-UI04）：dragenter/leave 计数，防子元素抖动导致高亮闪烁 ---------- */
function bindDropZone(el, onFile){
  if (!el) return;
  let depth = 0;
  const has = on => el.classList.toggle("drag", on);
  el.addEventListener("dragenter", e => { e.preventDefault(); depth++; has(true); });
  el.addEventListener("dragover", e => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; });
  el.addEventListener("dragleave", e => { e.preventDefault(); if (--depth <= 0) { depth = 0; has(false); } });
  el.addEventListener("drop", e => {
    e.preventDefault(); depth = 0; has(false);
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f && onFile) onFile(f);
  });
}
