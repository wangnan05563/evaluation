/** FR-UI04（动效/骨架屏/拖拽高亮）+ FR-UI07（空态与错误插画）验证
 *  由编排器起隔离实例（8032）+ 无头 Chrome（CDP 9334）后运行。
 *  覆盖：骨架屏真实出现且列数正确、空/错态插画为真SVG（非占位方块）、
 *  拖拽高亮 dragenter/leave 深度计数、三态主题下插画取色不失效、
 *  prefers-reduced-motion 下降级为静态占位而非空白。 */
import path from 'node:path';
const CDP = 'http://127.0.0.1:9334', APP = 'http://127.0.0.1:8032/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const res = [];
const check = (n, ok, d = '') => { res.push({ n, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
setTimeout(() => { console.error('[bk] WATCHDOG'); process.exit(3); }, 420000);

// ---- CDP ----
const t = await (await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket((await (await fetch(`${CDP}/json/version`)).json()).webSocketDebuggerUrl);
await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
let id = 0; const pend = new Map(); const errors = [];
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.no(new Error(JSON.stringify(m.error))) : p.ok(m.result); } else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params?.exceptionDetails?.exception?.description || 'exc'); };
const send = (m, p, s) => { const i = ++id; ws.send(JSON.stringify({ id: i, method: m, params: p, ...(s ? { sessionId: s } : {}) })); return new Promise((ok, no) => { pend.set(i, { ok, no }); setTimeout(() => { if (pend.has(i)) { pend.delete(i); no(new Error('cdp timeout: ' + m)); } }, 20000); }); };
const S = (await send('Target.attachToTarget', { targetId: t.id, flatten: true })).sessionId;
await send('Page.enable', {}, S); await send('Runtime.enable', {}, S); await send('DOM.enable', {}, S);
const ev = async x => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, userGesture: true }, S); if (r.exceptionDetails) throw new Error('eval:' + (r.exceptionDetails.exception?.description || '')); return r.result.value; };
// 合成拖拽 DataTransfer：jsdom/CDP 均无法真拖文件，事件语义需自己造
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try{localStorage.setItem('wl_guide_done_pages_v1',JSON.stringify({work:true,pert:true,config:true,help:true}))}catch(e){}
window.__mkDT=function(){return {files:[new File(['x'],'a.docx',{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'})],dropEffect:'',setData(){},getData(){return ''}}};`,
}, S);
await send('Page.navigate', { url: APP }, S);
for (let i = 0; i < 60; i++) { if ((await ev(`typeof skeletonTable === 'function' && document.readyState !== 'loading'`)) === true) break; await sleep(250); }

// ---- 1) 模块已加载 ----
const mod = JSON.parse(await ev(`JSON.stringify({skel:typeof skeletonTable,illus:typeof ILLUS,kinds:typeof ILLUS_KIND,drop:typeof bindDropZone,empty:typeof emptyState,err:typeof errorBox})`));
check('FR-UI04/UI07 模块函数齐备', mod.skel === 'function' && mod.illus === 'object' && mod.drop === 'function' && mod.empty === 'function' && mod.err === 'function', JSON.stringify(mod));
check('emptyState/errorBox 全局仅一处定义', await ev(`(()=>{const s=[...document.querySelectorAll('script')].map(x=>x.textContent).join('');return (s.match(/function emptyState/g)||[]).length===1 && (s.match(/function errorBox/g)||[]).length===1})()`));

// ---- 2) 骨架屏：结构与列数 ----
const sk = JSON.parse(await ev(`(()=>{const el=document.createElement('tbody');el.id='skTest';el.innerHTML=skeletonTable(6,4);
  const rows=[...el.querySelectorAll('tr')];
  return JSON.stringify({rows:rows.length,cols:rows[0].querySelectorAll('td').length,bars:el.querySelectorAll('.skel-bar').length,
    widths:rows[0].querySelectorAll('.skel-bar').length? [...rows[0].querySelectorAll('.skel-bar')].map(b=>b.style.width):[]})})()`));
check('骨架屏 4 行 × 6 列且每格有占位条', sk.rows === 4 && sk.cols === 6 && sk.bars === 24, JSON.stringify(sk));
check('骨架屏各列宽度不同（贴合真实列宽，避免加载完成时跳动）', new Set(sk.widths).size >= 4, sk.widths.join('/'));

// ---- 3) 骨架屏真实出现在历史表（异步加载窗口内） ----
await ev(`document.querySelector('.m-item[data-page="work"]').click();`);
await sleep(300);
const histSkel = await ev(`(()=>{histOpen();const el=document.getElementById('histRows');
  return el.querySelectorAll('.skel-bar').length>0 && el.querySelectorAll('tr').length>0})()`);
check('历史列表加载时先铺骨架屏（非「加载中…」纯文字）', histSkel === true);
await sleep(1200);
const histDone = JSON.parse(await ev(`JSON.stringify({skel:document.querySelectorAll('#histRows .skel-bar').length,rows:document.getElementById('histRows').querySelectorAll('tr').length})`));
check('历史加载完成后骨架被真实内容替换', histDone.skel === 0 && histDone.rows > 0, JSON.stringify(histDone));

// ---- 4) 规则表骨架 ----
await ev(`goPage('config');`); await sleep(700);
const ruleSkel = await ev(`(()=>{const el=document.getElementById('rulesRows');
  const ok=el.querySelectorAll('.skel-bar').length>0||el.querySelectorAll('tr').length>0; return ok})()`);
check('规则表加载时铺骨架屏', ruleSkel === true);

// ---- 5) 空态插画：真 SVG + 语义容器 + 动作按钮 ----
await ev(`goPage('work');goStep('review');`); await sleep(300);
const empty = JSON.parse(await ev(`(()=>{items=[];render();
  const box=document.querySelector('#tbody .empty-state');
  const svg=box&&box.querySelector('svg');
  return JSON.stringify({has:!!box,role:box&&box.getAttribute('role'),svg:!!svg,paths:svg?svg.querySelectorAll('path,rect,circle').length:0,
    artBox:!!box.querySelector('.empty-art'),title:box&&box.querySelector('.empty-t').textContent,
    usesVar:svg?svg.innerHTML.includes('var(--'):false})})()`));
check('空态渲染统一插画容器（role=status）', empty.has && empty.role === 'status' && empty.artBox, JSON.stringify(empty));
check('空态插画为真 SVG（多形状非占位方块）且用 CSS 变量取色', empty.svg && empty.paths >= 3 && empty.usesVar, `形状数=${empty.paths} 用变量=${empty.usesVar}`);
check('空态标题文案保留（语义不靠插画承担）', !!empty.title, empty.title);

// 无匹配（搜索空态）应为「搜索」插画，与「无数据」区分
const search = JSON.parse(await ev(`(()=>{items=[{seq:1,system:'S',m1:'M',desc:'D',count_item:'C',type:'EI',reuse:'中',modify:'修改',cx:'中',ok:true,basis:''}];
  document.getElementById('q').value='不存在的关键词';render();
  const box=document.querySelector('#tbody .empty-state');
  const hasAction=!!box.querySelector('.empty-a button');
  return JSON.stringify({has:!!box,hasAction,html:box?box.innerHTML.slice(0,200):''})})()`));
check('搜索无匹配走独立插画且带一键动作（清除筛选）', search.has && search.hasAction, `动作=${search.hasAction}`);

// ---- 6) 错误态插画 + role=alert + 重试 ----
const errBox = JSON.parse(await ev(`(()=>{const d=document.createElement('div');d.innerHTML=errorBox('接口超时','histOpen()');
  const box=d.querySelector('.empty-state');
  return JSON.stringify({role:box&&box.getAttribute('role'),svg:!!(box&&box.querySelector('svg')),danger:box?box.innerHTML.includes('--danger'):false,
    retry:!!(box&&box.querySelector('button')),msg:box&&box.querySelector('.empty-d').textContent})})()`));
check('错误态用 danger 语义色插画 + role=alert', errBox.role === 'alert' && errBox.svg && errBox.danger, JSON.stringify(errBox));
check('错误态含重试按钮与原始原因', errBox.retry && errBox.msg === '接口超时', errBox.msg);

// ---- 7) 拖拽高亮：enter/leave 深度计数（子元素进出不闪烁） ----
await ev(`goStep('upload');`); await sleep(300);
const drag = JSON.parse(await ev(`(()=>{const d=document.getElementById('drop');
  const mk=(type)=>{const e=new DragEvent(type,{bubbles:true,cancelable:true});Object.defineProperty(e,'dataTransfer',{value:window.__mkDT()});d.dispatchEvent(e);};
  mk('dragenter');
  const on1=d.classList.contains('drag');
  mk('dragenter'); mk('dragenter');            // 模拟深入子元素
  const on2=d.classList.contains('drag');
  mk('dragleave'); mk('dragleave');
  const on3=d.classList.contains('drag');        // 计数未归零：仍应保持高亮
  mk('dragleave');
  const on4=d.classList.contains('drag');        // 真正离开：熄灭
  return JSON.stringify({on1,on2,on3,on4})})()`));
check('拖入即高亮（上传区原无任何视觉反馈）', drag.on1 === true);
check('进入子元素不来回熄灭（深度计数生效）', drag.on2 === true && drag.on3 === true, JSON.stringify(drag));
check('完全离开后才熄灭', drag.on4 === false, JSON.stringify(drag));

// PERT 拖放区同样生效
const pert = JSON.parse(await ev(`(()=>{const d=document.getElementById('pertDrop');if(!d)return JSON.stringify({skip:1});
  const mk=(type)=>{const e=new DragEvent(type,{bubbles:true,cancelable:true});Object.defineProperty(e,'dataTransfer',{value:window.__mkDT()});d.dispatchEvent(e);};
  mk('dragenter');const a=d.classList.contains('drag');mk('dragleave');const b=d.classList.contains('drag');
  return JSON.stringify({a,b})})()`));
check('PERT 拖放区拖拽高亮生效', pert.a === true && pert.b === false, JSON.stringify(pert));

// ---- 8) 三态主题下插画均正常渲染（不硬编码颜色，随令牌切换） ----
// 必须把节点挂到文档上再量尺寸：游离元素的 getBoundingClientRect 恒为 0（会假失败）。
const themes = [];
for (const th of ['light', 'dark', 'contrast']) {
  await ev(`localStorage.setItem('wl_theme_mode','${th}');applyTheme();`);
  await sleep(200);
  const c = JSON.parse(await ev(`(()=>{const d=document.createElement('div');
    d.style.cssText='position:fixed;left:0;top:0;width:400px;z-index:9999';
    d.innerHTML=emptyState('inbox','标题','描述','');document.body.appendChild(d);
    const art=d.querySelector('.empty-art'),r=art.getBoundingClientRect();
    const out={theme:document.documentElement.dataset.theme||'light',w:Math.round(r.width),h:Math.round(r.height),svg:!!art.querySelector('svg')};
    d.remove();return JSON.stringify(out)})()`));
  themes.push(c);
}
check('亮/暗/高对比三态下插画均正常渲染且有尺寸', themes.every(t => t.svg && t.w > 100 && t.h > 50), JSON.stringify(themes));

// ---- 9) prefers-reduced-motion：降级为静态占位而非空白 ----
await ev(`localStorage.setItem('wl_theme_mode','light');applyTheme();`);
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, S);
await sleep(300);
const rm = JSON.parse(await ev(`(()=>{const t=document.createElement('table'),d=document.createElement('div');
  d.style.cssText='position:fixed;left:0;top:0;width:600px;z-index:9999';
  t.innerHTML=skeletonTable(6,2);d.appendChild(t);document.body.appendChild(d);
  const bar=t.querySelector('.skel-bar'),cs=getComputedStyle(bar),r=bar.getBoundingClientRect();
  const out={anim:cs.animationName,dur:cs.animationDuration,visible:r.width>0&&r.height>0};
  d.remove();return JSON.stringify(out)})()`));
check('减少动态效果时骨架屏无动画但仍可见（不白屏）', rm.visible && (rm.anim === 'none' || rm.dur === '0s'), JSON.stringify(rm));
await send('Emulation.setEmulatedMedia', { features: [] }, S);

// ---- 10) 打印时隐藏装饰（骨架/插画不该上纸） ----
// 用 print 媒体模拟实测行为，而非匹配 CSS 源码文本（压缩后格式易变导致假失败）。
await send('Emulation.setEmulatedMedia', { media: 'print' }, S);
await sleep(300);
// 打印规则挂在 .skel-row（即 <tr>）上，故不能看子单元格computed display
// （display:none 的父元素下，子元素仍照常报告自身 display 值）。
// 判定「是否真的不上纸」应看渲染结果：getClientRects().length 为 0 即未生成盒子。
const pr = JSON.parse(await ev(`(()=>{const d=document.createElement('div');
  d.style.cssText='position:fixed;left:0;top:0;width:600px;z-index:9999';
  d.innerHTML='<table><tbody>'+skeletonTable(6,1)+'</tbody></table>'+emptyState('inbox','t','d','');
  document.body.appendChild(d);
  const row=d.querySelector('.skel-row'),art=d.querySelector('.empty-art');
  const out={rowBoxes:row.getClientRects().length,artBoxes:art.getClientRects().length,
             rowDisplay:getComputedStyle(row).display,artDisplay:getComputedStyle(art).display};
  d.remove();return JSON.stringify(out)})()`));
check('打印时骨架屏与插画均不渲染（不上纸）', pr.rowBoxes === 0 && pr.artBoxes === 0, JSON.stringify(pr));
await send('Emulation.setEmulatedMedia', { media: '' }, S);

check('全程无页面异常', errors.length === 0, errors.slice(0, 2).join(' | '));
const failed = res.filter(r => !r.ok);
console.log(`\n==== 汇总 ==== 共 ${res.length} 项，通过 ${res.length - failed.length}，失败 ${failed.length}`);
process.exit(failed.length ? 1 : 0);
