/* ============================================================
 * guide.js —— 菜单向导引导系统（T00859，按本工具实际形态适配）
 *
 * 本工具为「无框架的单页原生 HTML/JS」应用（无 Vue/React，无路由），
 * 真实结构是 4 个页面（IFPUG估算/PERT估算/配置中心/帮助文档）+ 页内步骤条。
 * 因此引导系统的目标对象不是「多菜单路由」，而是这 4 个页面入口与 2 套步骤条。
 *
 * 设计取舍（适配不虚构）：
 *  - 引导数据按「菜单·页面」粒度组织，每页可配多个引导步骤；
 *  - 首访仅弹一次（localStorage 记已完成页），后续由常驻按钮唤起；
 *  - 弹窗为绝对定位浮层 + 高亮遮罩，不遮挡关键操作按钮，支持关闭；
 *  - 演示支持 手动步进（前进/后退）与 自动播放 双模式。
 * ============================================================ */
(function () {
  'use strict';

  // ---------- 引导配置数据（数据文件，可独立扩充） ----------
  // 字段：id、menuId(归属页面)、title、desc、target(高亮元素选择器，可空=无高亮)、order
  var GUIDE_STEPS = [
    // --- IFPUG 估算页：3 步流程演示 ---
    { id: 'work', menuId: 'work', title: '① 上传需求', order: 1,
      desc: '拖拽或点击选择需求说明书(.docx)，由本地引擎解析并生成 IFPUG 候选功能点。这是 IFPUG 估算的第一步。',
      target: '#mi-work' },
    { id: 'work-upload', menuId: 'work', title: '上传需求说明书', order: 2,
      desc: '在此区域上传需求文档。支持拖拽到虚线框，或点击弹出文件选择。',
      target: '#drop' },
    { id: 'work-review', menuId: 'work', title: '② 审核功能点', order: 3,
      desc: '识别结果进入第二步“审核功能点”，可勾选/调整每个功能点的类型与复用度，确认后进入估算。',
      target: '#st2' },
    { id: 'work-result', menuId: 'work', title: '③ 结果与下载', order: 4,
      desc: '第三步“结果与下载”汇总工作量与费用，可一键下载成品造价表（Excel）。',
      target: '#st3' },

    // --- PERT 估算页：3 步流程演示 ---
    { id: 'pert', menuId: 'pert', title: 'PERT 三点估算', order: 1,
      desc: 'PERT 估算按“需求输入 → 估算录入 → 结果生成”三步组织，每一步都有独立步骤栏。',
      target: '#mi-pert' },
    { id: 'pert-in', menuId: 'pert', title: 'PERT · 需求输入', order: 2,
      desc: '输入每个功能需求的三点值：乐观(O)、最可能(M)、悲观(P)，系统自动计算预期工期与方差。',
      target: '#pst1' },
    { id: 'pert-edit', menuId: 'pert', title: 'PERT · 估算录入', order: 3,
      desc: '在估算录入阶段维护项目阶段明细，可从历史项目载入继续编辑。',
      target: '#pst2' },
    { id: 'pert-gen', menuId: 'pert', title: 'PERT · 结果生成', order: 4,
      desc: '结果生成阶段输出各阶段预期工作量，并支持下载成品表。',
      target: '#pst3' },

    // --- 配置中心页 ---
    { id: 'config', menuId: 'config', title: '配置中心', order: 1,
      desc: '配置中心用于大模型识别增强设置：选择模型服务商、填入 API 地址/模型/密钥，并支持在线连接测试。',
      target: '#mi-config' },

    // --- 帮助文档页：功能总览引导（引导按钮仅在此页开启，T00909） ---
    { id: 'help', menuId: 'help', title: '① IFPUG 估算', order: 1,
      desc: '上传需求说明书 → 审核功能点 → 生成成品造价表，是本工具的主流程。',
      target: '#mi-work' },
    { id: 'help-pert', menuId: 'help', title: '② PERT 估算', order: 2,
      desc: '三点估算法：录入乐观/最可能/悲观值，自动计算预期工期与方差。',
      target: '#mi-pert' },
    { id: 'help-config', menuId: 'help', title: '③ 配置中心', order: 3,
      desc: '配置大模型识别增强（服务商/API 地址/密钥）与应用更新源，支持在线连接测试。',
      target: '#mi-config' },
    { id: 'help-doc', menuId: 'help', title: '④ 帮助文档', order: 4,
      desc: '查阅 IFPUG 评估方法论与计算算法说明，并可从这里重温各页操作引导。',
      target: '#mi-help' },
  ];

  var STORE_KEY = 'wl_guide_done_pages_v1';   // 首访已完成引导的页面集合
  var storageAvail = true;
  try { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); }
  catch (e) { storageAvail = false; }

  // ---------- 运行时状态 ----------
  var active = null;        // 当前演示状态 {menuId, idx, timer}
  var demoAuto = false;     // 是否自动播放
  var lastTarget = null;    // 上一次高亮元素（动画恢复用）

  // ---------- 内部工具 ----------
  function $(s) { return document.querySelector(s); }
  /* T01556（批次6）：引导文案 i18n。数据里的中文（title/desc/按钮）作为字典未就绪或缺键时的
     兜底原文；绘制期通过主包暴露的全局 tl(key, fallback) 现取当前语言译文（guide.* 键）。 */
  // 字典 key 字符集只允许小写字母/数字/下划线/点（i18n_check 拦截），而步骤 id 用连字符
  // （work-upload），故取名时统一转下划线：guide.work_upload.t
  function G(k, zh) { return (typeof window.tl === 'function') ? window.tl('guide.' + k.replace(/-/g, '_'), zh) : zh; }
  function add(node) { document.body.appendChild(node); }
  function stepList(menuId) {
    return GUIDE_STEPS.filter(function (s) { return s.menuId === menuId; })
                      .sort(function (a, b) { return a.order - b.order; });
  }
  function markDone(menuId) {
    if (!storageAvail) return;
    var s = {};
    try { s = JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch (e) { s = {}; }
    s[menuId] = true;
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  }
  function isDone(menuId) {
    if (!storageAvail) return false;
    try { return !!(JSON.parse(localStorage.getItem(STORE_KEY) || '{}')[menuId]); }
    catch (e) { return false; }
  }

  // ---------- 外层样式（一次性注入，避免改动现有 CSS） ----------
  function ensureCss() {
    if ($('#guide-css')) return;
    var st = document.createElement('style');
    st.id = 'guide-css';
    st.textContent =
      '.guide-mask{position:fixed;inset:0;z-index:3000;background:rgba(0,0,0,.35);' +
      '  box-shadow:0 0 0 9999px rgba(0,0,0,.35);transition:opacity .15s;}' +
      '.guide-glow{position:absolute;border-radius:10px;box-shadow:0 0 0 4px #2563EB,0 6px 24px rgba(0,0,0,.4);' +
      '  z-index:3001;transition:all .2s ease;background:rgba(37,99,235,.10);pointer-events:none;}' +
      '.guide-card{position:fixed;z-index:3002;max-width:340px;min-width:240px;background:#fff;color:#1e293b;' +
      '  border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.28);padding:16px 18px;font-size:13px;' +
      '  line-height:1.7;font-family:inherit;}' +
      '.guide-card h4{margin:0 0 6px;font-size:15px;color:#0f172a;}' +
      '.guide-card .g-desc{color:#475569;}' +
      '.guide-card .g-ctrls{margin-top:12px;display:flex;align-items:center;gap:8px;}' +
      '.guide-card .g-dots{flex:1;display:flex;gap:5px;align-items:center;}' +
      '.guide-card .g-dot{width:7px;height:7px;border-radius:50%;background:#cbd5e1;}' +
      '.guide-card .g-dot.on{background:#2563EB;}' +
      '.guide-card button{border:0;border-radius:8px;padding:6px 12px;font-size:12px;cursor:pointer;' +
      '  font-family:inherit;}' +
      '.g-btn-primary{background:#2563EB;color:#fff;}' +
      '.g-btn-ghost{background:transparent;color:#64748b;}' +
      '.g-btn-ghost:hover{background:#f1f5f9;}' +
      '.guide-fab{position:fixed;right:20px;bottom:20px;z-index:2999;width:46px;height:46px;border-radius:50%;' +
      '  background:#2563EB;color:#fff;border:0;cursor:pointer;display:flex;align-items:center;justify-content:center;' +
      '  box-shadow:0 8px 24px rgba(37,99,235,.4);transition:transform .15s;}' +
      '.guide-fab:hover{transform:scale(1.06);}' +
      '.guide-fab svg{width:22px;height:22px;pointer-events:none;}';
    add(st);
  }

  // 生成引导激活图标（复刻 lucide 风格，避免依赖运行时 lucide 未初始化）
  function helpIcon() {
    var svgns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(svgns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    var p1 = document.createElementNS(svgns, 'circle');
    p1.setAttribute('cx', '12'); p1.setAttribute('cy', '12'); p1.setAttribute('r', '10');
    var p2 = document.createElementNS(svgns, 'path');
    p2.setAttribute('d', 'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3');
    var p3 = document.createElementNS(svgns, 'line');
    p3.setAttribute('x1', '12'); p3.setAttribute('y1', '17'); p3.setAttribute('x2', '12.01'); p3.setAttribute('y2', '17');
    svg.appendChild(p1); svg.appendChild(p2); svg.appendChild(p3);
    return svg;
  }

  // ---------- 常驻帮助按钮（默认隐藏，仅在帮助文档页开启，T00909） ----------
  function ensureFab() {
    if ($('#guide-fab')) return;
    var btn = document.createElement('button');
    btn.id = 'guide-fab';
    btn.className = 'guide-fab';
    btn.title = G('fab.title', '操作引导');
    btn.setAttribute('aria-label', G('fab.title', '操作引导'));   // FR-3.5：仅图标按钮 aria 补全
    btn.appendChild(helpIcon());
    btn.addEventListener('click', function () {
      // 帮助页常驻入口：唤起功能总览引导（介绍 4 大菜单入口）
      start('help');
    });
    add(btn);
    updateFab();
  }

  // 引导按钮默认隐藏，仅帮助文档页显示——避免浮动按钮干扰主流程操作
  function updateFab() {
    var btn = $('#guide-fab');
    if (!btn) return;
    var page = document.body.dataset.page || 'work';
    btn.style.display = (page === 'help') ? 'flex' : 'none';
  }

  // 由 body.data-page 或 data-step 推断当前应引导的 menuId
  function menuOfPage(page) {
    var map = { work: 'work', pert: 'pert', config: 'config', help: 'help' };
    return map[page] || 'work';
  }

  // ---------- 高亮单个目标元素 ----------
  function glow(el, okIfMissing) {
    clearGlow();
    if (!el) { return; }
    var r = el.getBoundingClientRect();
    var m = document.createElement('div');
    m.className = 'guide-glow';
    m.style.left = (r.left - 6) + 'px';
    m.style.top = (r.top - 6) + 'px';
    m.style.width = (r.width + 12) + 'px';
    m.style.height = (r.height + 12) + 'px';
    add(m);
    // 目标元素可能被遮罩盖住，将其上浮到引导层之上保持可辨识（不改原布局）
    el.style.position = 'relative';
    el.style.zIndex = '3003';
    lastTarget = el;
  }
  function clearGlow() {
    var m = $('.guide-glow');
    if (m) m.remove();
    if (lastTarget) { lastTarget.style.zIndex = ''; lastTarget.style.position = ''; lastTarget = null; }
  }

  // 气泡卡片定位：优先跟随目标下方，溢出则侧挂
  function placeCard(card, el) {
    var cw = card.offsetWidth || 320, chh = card.offsetHeight || 140;
    var vw = window.innerWidth, vh = window.innerHeight;
    var left, top;
    if (el) {
      var r = el.getBoundingClientRect();
      left = Math.min(Math.max(r.left, 12), vw - cw - 12);
      top = r.bottom + 14;
      if (top + chh > vh) { top = Math.max(r.top - chh - 14, 12); }
    } else {
      left = (vw - cw) / 2; top = vh / 2 - chh / 2;
    }
    card.style.left = left + 'px';
    card.style.top = top + 'px';
  }

  // ---------- 主演示引擎 ----------
  var cardEl = null, maskEl = null;
  function makeUI() {
    cardEl = document.createElement('div');
    cardEl.className = 'guide-card';
    maskEl = document.createElement('div');
    maskEl.className = 'guide-mask';
    // 点遮罩空白处关闭（不阻塞关键按钮之外的操作，可关闭）
    maskEl.addEventListener('click', function () { stop(); });
    cardEl.addEventListener('click', function (e) { e.stopPropagation(); });
  }

  function render(menuId, idx) {
    if (!cardEl || !maskEl) return;
    var list = stepList(menuId);
    var s = list[idx];
    if (!s) return;
    cardEl.innerHTML =
      '<h4>' + G(s.id + '.t', s.title || '') + '</h4>' +
      '<div class="g-desc">' + G(s.id + '.d', s.desc || '') + '</div>' +
      '<div class="g-ctrls">' +
      '<div class="g-dots">' + list.map(function (_, i) {
        return '<span class="g-dot' + (i === idx ? ' on' : '') + '"></span>';
      }).join('') + '</div>' +
      '<button class="g-btn-ghost" data-act="auto">' + (demoAuto ? G('btn.pause', '暂停') : G('btn.auto', '自动播放')) + '</button>' +
      '<button class="g-btn-ghost" data-act="skip">' + G('btn.skip', '跳过') + '</button>' +
      '<button class="g-btn-ghost" data-act="prev">' + G('btn.back', '后退') + '</button>' +
      '<button class="g-btn-primary" data-act="next">' + (idx === list.length - 1 ? G('btn.done', '完成') : G('btn.next', '下一步')) + '</button>' +
      '</div>';
    // 无目标元素说明文档自身未提供该选择器：仅显示文字，不高亮（不虚构目标）
    var target = s.target ? $(s.target) : null;
    glow(target, true);
    placeCard(cardEl, target);
    cardEl.addEventListener('click', function (e) {
      var a = e.target && e.target.dataset ? e.target.dataset.act : '';
      if (!a) return;
      if (a === 'prev') { if (idx > 0) step(menuId, idx - 1); else autoTimer(0); }
      else if (a === 'next') { if (idx < list.length - 1) step(menuId, idx + 1); else { done(menuId); } }
      else if (a === 'skip') { stop(); }
      else if (a === 'auto') {
        demoAuto = !demoAuto;
        if (demoAuto) { render(menuId, idx); autoTimer(menuId); }
        else { autoTimer(0); }
      }
    });
  }

  // 自动播放：定时推进；到头自动结束并记 done
  function autoTimer(menuId) {
    if (!menuId) { if (active && active.timer) { clearTimeout(active.timer); active.timer = null; } return; }
    if (!demoAuto) return;
    if (active && active.timer) { clearTimeout(active.timer); }
    active.timer = setTimeout(function () {
      if (!demoAuto || !active) return;
      var list = stepList(menuId), idx = active.idx;
      if (idx < list.length - 1) { step(menuId, idx + 1); autoTimer(menuId); }
      else { done(menuId); }
    }, 2200);
  }

  function step(menuId, idx) {
    if (!active) active = { menuId: menuId, idx: idx };
    else { active.menuId = menuId; active.idx = idx; }
    render(menuId, idx);
  }

  function start(menuId) {
    ensureCss();
    if (!cardEl) makeUI();
    add(maskEl); add(cardEl);
    demoAuto = false;
    step(menuId, 0);
  }

  function done(menuId) {
    markDone(menuId);
    stop();
  }

  function stop() {
    if (active && active.timer) { clearTimeout(active.timer); }
    active = null; demoAuto = false;
    clearGlow();
    if (maskEl) maskEl.remove();
    if (cardEl) cardEl.remove();
  }

  // ---------- 首访触发：进入某页时若未引导过且未关闭过则唤起一次 ----------
  function guideMaybe(page) {
    var menuId = menuOfPage(page);
    if (isDone(menuId)) return;   // 该页已完成引导
    if (active) return;           // 已有引导在演示中，避免叠加
    // 延迟执行，等页面元素渲染完成（如 pertInit 异步填充）
    setTimeout(function () { start(menuId); }, 350);
  }

  // ---------- 对外包装：不侵入原有导航函数，仅在事后触发引导 ----------
  function hook() {
    // 保存原始函数（内联 onclick 调用的是 window 上的全局函数）
    var origGoPage = window.goPage, origGoStep = window.goStep, origPertStep = window.pertStep;
    window.goPage = function (p) {
      if (typeof origGoPage === 'function') origGoPage(p);
      updateFab();
      guideMaybe(p);
    };
    window.goStep = function (s) {
      if (typeof origGoStep === 'function') origGoStep(s);
      // 仅在 IFPUG 页唤起（避免每点一次步骤弹一次）
      if (!isDone('work') && !active && document.body.dataset.page === 'work') {
        guideMaybe('work');
      }
    };
    window.pertStep = function (s) {
      if (typeof origPertStep === 'function') origPertStep(s);
      if (!isDone('pert') && !active && document.body.dataset.page === 'pert') {
        guideMaybe('pert');
      }
    };

    // 首次进入：对默认页（work）做首访引导
    window.addEventListener('DOMContentLoaded', function () {
      ensureCss();
      ensureFab();
      setTimeout(function () { guideMaybe(document.body.dataset.page || 'work'); }, 400);
    });
  }

  // 从帮助页入口启动指定页引导：先切页，若该页引导未完成过则由 guideMaybe 自动唤起
  function startAndGo(menuId) {
    var page = menuOfPage(menuId);
    if ((document.body.dataset.page || 'work') !== page) {
      window.goPage(page);
      setTimeout(function () { if (!active) start(menuId); }, 500);
    } else {
      start(menuId);
    }
  }

  // 暴露测试钩子（单元测试/联调用）
  window.WLGuide = { start: start, stop: stop, step: step, isDone: isDone,
                     steps: GUIDE_STEPS, markDone: markDone, menuOfPage: menuOfPage,
                     startAndGo: startAndGo,
                     // T01556：语言切换时若引导正在演示，按新语言重绘当前卡片
                     refresh: function () { if (active) render(active.menuId, active.idx); } };

  hook();
})();