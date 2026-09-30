/* ============================================================
 * iconbtn.js —— T00911 全局按钮无文字化 + 悬停倾斜提示 + 点击遮罩
 *
 * 约束：不修改任何按钮的 onclick 与数据流，仅在视觉/反馈层增强；
 *      运行时处理（不改 HTML 结构），动态生成的按钮经事件委托覆盖。
 *
 * 状态流转：Idle → Hover(tip卡片+3D倾斜) → Click(半透明遮罩+加载动画)
 *          → Loading(hold) → Idle(遮罩淡出)
 * ============================================================ */
(function () {
  'use strict';

  // ---------- 动效参数配置表（T00911 规范值） ----------
  var CFG = {
    tiltMax: 10,        // 倾斜幅度（deg），规范区间 ±8~12
    tiltDur: 0.2,       // 复位过渡时长（s），ease-out
    tipDelay: 120,      // 提示卡片出现延迟（ms），防掠过闪烁
    tipAnim: 0.15,      // 提示卡片进出场时长（s）
    maskHold: 900,      // 点击遮罩保持时长（ms），代表操作运行中
    maskFade: 300,      // 遮罩淡出时长（ms）
    zTip: 4500          // 提示卡片层级（高于引导层 3000 系）
  };

  // 目标按钮：操作类按钮统一处理；左侧导航菜单 .m-item 有自有 tip 设计，不纳入
  var SEL = 'button.btn, button.cta, button.toggle';

  // ---------- 内部状态 ----------
  var tipEl = null;
  var tipTimer = null;
  var hoverBtn = null;       // 当前悬停按钮（倾斜/tip 生命周期锚点）
  var rafPending = false;
  var lastX = 0, lastY = 0;

  // ---------- 工具 ----------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- 样式注入（一次性，避免改动现有 CSS 块） ----------
  function ensureCss() {
    if (document.getElementById('ib-css')) return;
    var st = document.createElement('style');
    st.id = 'ib-css';
    st.textContent =
      '.ib-ico{position:relative}' +  /* 容纳点击遮罩层 */
      '.btn.ib-ico{padding:11px 13px}' +   /* 去文字后水平内距收敛，保持原高度 */
      '.cta.ib-ico{padding:13px 10px}' +
      '.toggle.ib-ico{padding:4px 7px}' +
      '.ib-mask{position:absolute;inset:0;border-radius:inherit;background:rgba(15,23,42,.22);' +
      '  display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:5;' +
      '  opacity:1;transition:opacity ' + CFG.maskFade + 'ms ease-out}' +
      '.ib-mask.off{opacity:0}' +
      '.ib-spin{width:13px;height:13px;border-radius:50%;flex:none;' +
      '  border:2px solid rgba(147,197,253,.4);border-top-color:#93C5FD;' +
      '  animation:ib-rot .7s linear infinite}' +
      '@keyframes ib-rot{to{transform:rotate(360deg)}}' +
      '.ib-tip{position:fixed;z-index:' + CFG.zTip + ';max-width:260px;background:#0F172A;color:#fff;' +
      '  border-radius:8px;padding:8px 12px;font-family:inherit;line-height:1.6;pointer-events:none;' +
      '  box-shadow:0 8px 24px rgba(15,23,42,.35);opacity:0;transform:translateY(4px);' +
      '  transition:opacity ' + CFG.tipAnim + 's ease-out,transform ' + CFG.tipAnim + 's ease-out}' +
      '.ib-tip.on{opacity:1;transform:translateY(0)}' +
      '.ib-tip b{display:block;font-size:12.5px}' +
      '.ib-tip span{display:block;color:#94A3B8;font-size:11.5px;margin-top:2px}';
    document.body.appendChild(st);
  }

  // ---------- 无文字化：文本节点移入 dataset，图标保留 ----------
  function stripText(btn) {
    if (btn.dataset.ibDone) return;
    btn.dataset.ibDone = '1';
    prep(btn);

    var name = '';
    for (var i = btn.childNodes.length - 1; i >= 0; i--) {
      var n = btn.childNodes[i];
      if (n.nodeType === 3 && n.textContent.trim()) {
        name = n.textContent.trim();
        btn.removeChild(n);
      }
    }
    // 无语义图标的按钮不去文字（避免纯空白按钮），仅享受 tip/倾斜/遮罩增强
    var hasIcon = btn.querySelector('svg, i, img');
    if (!name || !hasIcon) return;

    btn.dataset.ibName = name;
    btn.classList.add('ib-ico');
    // 无障碍：读屏器朗读原按钮文字（约束：保留键盘导航与 ARIA）
    btn.setAttribute('aria-label', name);
  }

  // title → dataset（惰性执行，覆盖动态生成的表格按钮），并移除原生 title 防双 tooltip
  function prep(btn) {
    if (!btn.dataset.ibDesc && btn.title) {
      btn.dataset.ibDesc = btn.title;
      btn.removeAttribute('title');
    }
  }

  // ---------- 悬停提示卡片（单例，内容=按钮名称+功能描述） ----------
  function ensureTip() {
    if (tipEl) return;
    tipEl = document.createElement('div');
    tipEl.className = 'ib-tip';
    document.body.appendChild(tipEl);
  }

  function showTip(btn) {
    var name = btn.dataset.ibName || '';
    var desc = btn.dataset.ibDesc || '';
    if (!name && !desc) return;
    ensureTip();
    tipEl.innerHTML = (name ? '<b>' + esc(name) + '</b>' : '') +
                      (desc && desc !== name ? '<span>' + esc(desc) + '</span>' : '');
    tipEl.style.visibility = 'hidden';
    tipEl.classList.add('on');

    var r = btn.getBoundingClientRect();
    var tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
    var left = Math.min(Math.max(r.left + r.width / 2 - tw / 2, 8), window.innerWidth - tw - 8);
    var top = r.bottom + 10;
    if (top + th > window.innerHeight - 8) top = Math.max(r.top - th - 10, 8);
    tipEl.style.left = left + 'px';
    tipEl.style.top = top + 'px';
    tipEl.style.visibility = '';
  }

  function hideTip() {
    if (tipTimer) { clearTimeout(tipTimer); tipTimer = null; }
    if (tipEl) tipEl.classList.remove('on');
  }

  // ---------- 3D 倾斜（跟随鼠标，rAF 节流，仅 transform 合成层） ----------
  function applyTilt() {
    rafPending = false;
    if (!hoverBtn || hoverBtn.disabled) return;
    var r = hoverBtn.getBoundingClientRect();
    var px = (lastX - r.left) / r.width - 0.5;   // -0.5 ~ 0.5
    var py = (lastY - r.top) / r.height - 0.5;
    var ry = px * 2 * CFG.tiltMax;
    var rx = -py * 2 * CFG.tiltMax;
    hoverBtn.style.transform = 'perspective(400px) rotateX(' + rx.toFixed(1) + 'deg) rotateY(' + ry.toFixed(1) + 'deg)';
  }

  function onMove(e) {
    if (!hoverBtn) return;
    lastX = e.clientX; lastY = e.clientY;
    if (!rafPending) { rafPending = true; requestAnimationFrame(applyTilt); }
  }

  // ---------- 悬停进出（mouseover 委托，子元素移动去重） ----------
  function enterBtn(btn, e) {
    lastX = e.clientX; lastY = e.clientY;
    if (!btn.disabled) {
      btn.style.transition = 'none';   // 跟随鼠标实时倾斜，不做过渡
      applyTilt();
    }
    tipTimer = setTimeout(function () { showTip(btn); }, CFG.tipDelay);
  }

  function leaveBtn(btn) {
    hideTip();
    if (btn) {
      // 复位：加 ease-out 过渡回到平面
      btn.style.transition = 'transform ' + CFG.tiltDur + 's ease-out';
      btn.style.transform = '';
    }
  }

  document.addEventListener('mouseover', function (e) {
    var btn = e.target.closest ? e.target.closest(SEL) : null;
    if (btn === hoverBtn) return;
    if (hoverBtn) leaveBtn(hoverBtn);
    hoverBtn = btn;
    if (btn) { prep(btn); enterBtn(btn, e); }
  });
  document.addEventListener('mousemove', onMove, { passive: true });

  // ---------- 点击遮罩（捕获阶段委托：不改原 onclick，先叠遮罩再放行事件） ----------
  document.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest(SEL) : null;
    if (!btn || btn.disabled) return;
    if (btn.querySelector('.ib-mask')) return;
    btn.classList.add('ib-ico');
    var m = document.createElement('span');
    m.className = 'ib-mask';
    m.appendChild(Object.assign(document.createElement('i'), { className: 'ib-spin' }));
    btn.appendChild(m);
    setTimeout(function () {
      m.classList.add('off');
      setTimeout(function () { m.remove(); }, CFG.maskFade);
    }, CFG.maskHold);
  }, true);

  // ---------- 初始化 ----------
  function init() {
    ensureCss();
    document.querySelectorAll(SEL).forEach(stripText);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // 暴露配置与状态查询（联调/测试钩子）
  window.WLIconBtn = { config: CFG, init: init, stripText: stripText };
})();
