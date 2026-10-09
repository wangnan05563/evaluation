/* ===== T00927：确认无误 → 生成进度条（后台真实阶段 + 轮询） ===== */
let genPollTimer=null;
/* T01556（批次6）：进度条/补算状态文案 key 化。
   驻留 DOM 的文本走 dyn 注册表：只存「当前状态（key+参数）」，绘制函数每次求值现取 t()，
   切语言 dynPaint 自动重绘；瞬时 toast 点击时求值、消失即弃，无需注册。 */
let genStageCur={k:"gen.stage.generating",raw:"正在生成…"};   // 进度条当前阶段（genStageNorm 归一后的对象）
function genStageText(){
  const g=genStageCur;
  let base=g.k==null?g.raw
    :g.n!=null?tf(g.k,{n:g.n})
    :g.s!=null?tf(g.k,{s:g.s})
    :g.params!=null?tf(g.k,g.params)
    :t(g.k);
  return g.p==null?base:tf("gen.stage_elapsed",{stage:base,s:g.p});
}
/* T01556（批次6）：服务端中文阶段 → 字典 key 映射（与 01_core lm() 同思路的过渡层）。
   未知阶段原样显示（渐进迁移不误伤）；带插值的两条用正则提取参数。 */
const GEN_STAGE_KEYS={
  "正在排布系统与明细行…":"gen.stage.layout",
  "正在载入母版并扩容明细区…":"gen.stage.master",
  "正在保存成品表…":"gen.stage.save",
  "正在处理母版公式缓存（Excel 重算）…":"gen.stage.excel_prep",
  "母版公式重算完成，正在收尾…":"gen.stage.recalc_done",
  "已跳过 Excel 重算，正在收尾…":"gen.stage.recalc_skip",
  "成品表已生成；母版公式缓存在后台补算，正在收尾…":"gen.stage.async_tail",
  "正在启动 Excel 进程…":"gen.stage.excel_start",
  "正在打开成品表…":"gen.stage.excel_open",
  "正在重算母版公式…":"gen.stage.excel_recalc",
  "正在写回计算结果并关闭 Excel…":"gen.stage.excel_writeback",
  "正在校验并整理候选清单…":"gen.stage.validate",
  "正在生成成品表（填充母版明细）…":"gen.stage.fill",
  "正在汇总评估结果…":"gen.stage.summarize",
  "正在生成…":"gen.stage.generating",
  "正在提交生成请求…":"gen.stage.submit",
  "生成完成":"gen.done",
  "生成完成（公式缓存后台补算中）":"gen.done_async",
  "生成完成，正在跳转结果…":"gen.finish",
  "生成完成（公式缓存后台补算中），正在跳转结果…":"gen.finish_async",
};
/* 把服务端/本模块的中文阶段归一为 {k, p/n, raw}：k 命中字典 key；raw 为兜底原文 */
function genStageNorm(s){
  if(s&&typeof s==="object")return s;
  const raw=String(s??"");
  let m;
  if((m=raw.match(/^正在写入 (\d+) 条功能点明细…$/)))return {k:"gen.stage.write",n:+m[1],raw};
  if((m=raw.match(/^Excel 重算超时（>(\d+)s），已跳过；母版公式将由 Excel 打开时自动重算$/)))return {k:"gen.stage.excel_timeout",s:m[2],raw};
  if(GEN_STAGE_KEYS[raw])return {k:GEN_STAGE_KEYS[raw],raw};
  return {k:null,raw};
}
function genProgPaint(pct,stage,isErr){
  const box=$("#genProg");if(!box)return;
  const p=Math.max(0,Math.min(100,Math.round(pct)));
  box.classList.add("on");box.classList.toggle("err",!!isErr);
  box.setAttribute("aria-valuenow",String(p));
  $("#genProgFill").style.width=p+"%";
  $("#genProgPct").textContent=p+"%";
  if(stage!=null)genStageCur=genStageNorm(stage);   // 传入结构化阶段（字符串自动归一）
  dynText("#genProgTxt",genStageText);
}
function genProgHide(){const box=$("#genProg");if(box)box.classList.remove("on","err");}
// 生成超时兜底（需求「异常兜底」项）：超过该时长仍未返回则中止等待并恢复按钮，
// 避免后台卡住时按钮永久灰显。可临时改 window.WL_GEN_TIMEOUT_MS 调整（联调用）。
function genTimeoutMs(){return +window.WL_GEN_TIMEOUT_MS||180000;}
/* T01501（S3776）：生成进度轮询的状态机。抽出后 beginGenProgress 只负责编排，
   「拿到一条进度要不要画、画什么文本」的判定集中在这里，便于单独推演。
   规则（与重构前逐字一致）：
   - 仅当本次进度 ok 且带 progress 才认为「服务端有记录」（got）；
   - 百分比只允许前进（p < last 时忽略，防乱序回退）；
   - 阶段或百分比变化才算「本阶段重新计时」；
   - 同阶段停留 >2s 时在文案后追加真实已用时（不伪造百分比）；
   - 文案未变则不重绘（避免无谓 DOM 操作）。 */
function progressPoller(t0){
  return {
    last:0, got:false, painted:false, settled:false,
    lastChange:t0, lastStage:"", shown:"",
    consume(j,paint){
      this.painted=false;
      if(!(j&&j.ok&&j.progress))return;
      this.got=true;
      const p=+j.progress.pct||0, stage=genStageNorm(j.progress.stage||"正在生成…");
      const sigK=stage.k||stage.raw;
      if(p<this.last)return;                       // 乱序/回退进度：忽略本次
      if(p!==this.last||sigK!==this.lastStage){this.lastChange=Date.now();this.lastStage=sigK;}
      this.last=p;
      const hold=Date.now()-this.lastChange;
      if(hold>2000)stage.p=+(hold/1000).toFixed(1);   // 同阶段停留超 2s：追加真实已用时（不伪造百分比）
      const sig=sigK+"|"+(stage.p==null?"":stage.p);
      if(sig!==this.shown){this.shown=sig;paint(p,stage);this.painted=true;}
    },
  };
}
function beginGenProgress(){
  // 每次生成一个 job id：服务端按真实阶段写进度，前端 300ms 轮询（ThreadingHTTPServer 不阻塞主请求）
  const job="g"+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
  if(genPollTimer){clearInterval(genPollTimer);genPollTimer=null;}
  const t0=Date.now();
  // T01501（S3776）：轮询状态与「消费一次进度并决定是否绘制」原为 beginGenProgress 内的
  // 闭包变量 + 内联判定，三层嵌套（已结束 → 有进度 → 百分比是否前进）使复杂度超阈值。
  // 抽为 progressPoller 工厂：状态自封装，绘制决策集中一处，beginGenProgress 只做编排。
  const P=progressPoller(t0);
  genProgPaint(2,"正在提交生成请求…");
  const tick=async ()=>{
    if(P.settled)return;   // 已结束（finish/fail）后不再绘制，防止在途轮询覆盖结果态
    let j=null;
    try{
      const r=await fetch(API+"/api/generate/progress?job="+encodeURIComponent(job),{cache:"no-store"});
      j=await r.json();
    }catch(e){/* 轮询异常不打断生成主流程 */}
    if(P.settled)return;
    P.consume(j,genProgPaint);
    if(P.painted)return;
    // 服务端无进度记录（旧实例/接口不可用）：按耗时推进并停在 92%，不伪装真实阶段
    if(!P.got){
      const est=Math.min(92,Math.round((Date.now()-t0)/250));
      if(est>P.last){P.last=est;genProgPaint(est,{k:"gen.stage.fill",raw:"正在生成成品表…",p:+((Date.now()-t0)/1000).toFixed(1)});}
    }
  };
  genPollTimer=setInterval(tick,300);tick();
  return {
    job,
    async finish(txt){
      P.settled=true;
      if(genPollTimer){clearInterval(genPollTimer);genPollTimer=null;}
      genProgPaint(100,txt||"生成完成");
      await new Promise(r=>setTimeout(r,420));   // 让 100% 可见后再跳转
      genProgHide();
    },
    fail(msg){
      P.settled=true;
      if(genPollTimer){clearInterval(genPollTimer);genPollTimer=null;}
      genProgPaint(100,{k:"gen.fail_detail",params:{msg},raw:"生成失败："+msg},true);
      setTimeout(genProgHide,2800);              // 失败文案保留片刻后收起，避免长期占位
    }
  };
}
// ===== T00963：结果页展示公式缓存补算状态（补算中 / 已写回 / 已跳过 / 失败） =====
let recalcPollTimer=null;
/* T01556（批次6）：补算状态文案 key 化 + 驻留 DOM 走 dyn 注册表（切语言经 recalcStateK 重算重绘） */
const RECALC_KEYS={written:"gen.recalc.written",skipped:"gen.recalc.skipped",failed:"gen.recalc.failed"};
let recalcStateK="gen.recalc.running";
function showRecalcState(mode,job){
  const el=$("#recalcState");
  if(recalcPollTimer){clearInterval(recalcPollTimer);recalcPollTimer=null;}
  if(!el)return;
  if(mode==="sync"){el.style.display="block";recalcStateK="gen.recalc.sync";dynText(el,()=>t(recalcStateK));return;}
  if(mode!=="async"){el.style.display="block";recalcStateK="gen.recalc.none";dynText(el,()=>t(recalcStateK));return;}
  el.style.display="block";recalcStateK="gen.recalc.running";dynText(el,()=>t(recalcStateK));
  const t0=Date.now();
  recalcPollTimer=setInterval(async ()=>{
    if(document.body.dataset.step!=="result"){        // 离开结果页即停止轮询
      if(recalcPollTimer){clearInterval(recalcPollTimer);recalcPollTimer=null;}
      return;
    }
    try{
      const r=await fetch(API+"/api/generate/progress?job="+encodeURIComponent(job),{cache:"no-store"});
      const j=await r.json();
      const st=j&&j.ok&&j.progress&&j.progress.recalc;
      if(st&&RECALC_KEYS[st]){
        recalcStateK=RECALC_KEYS[st];dynPaint();
        if(recalcPollTimer){clearInterval(recalcPollTimer);recalcPollTimer=null;}
      }else if(Date.now()-t0>180000){                 // 长时间未到终态：停止轮询，保留进行中提示
        recalcStateK="gen.recalc.still";dynPaint();
        if(recalcPollTimer){clearInterval(recalcPollTimer);recalcPollTimer=null;}
      }
    }catch(e){/* 状态轮询失败不打断 */}
  },1000);
}
/* T01501（S3776）：生成请求体与「异常 → 文案」的映射原内联在点击处理器里，
   与 AbortController 兜底、超时提示交织。抽出后处理器只剩「校验 → 发请求 → 落地结果」。
   字段口径与顺序完全不变（服务端按 key 取值，顺序无关但保持原样便于比对）。 */
function buildGeneratePayload(job){
  return {
    items:items.map(({system,m1,desc,count_item,type,reuse,modify})=>({system,m1,desc,count_item,type,reuse,modify})),
    method:$("#methodSel").value,
    title:(reopenCtx&&reopenCtx.title)?reopenCtx.title:(curFile&&curFile.name)?curFile.name.replace(/\.(docx|doc|pdf)$/i,''):"",
    reopen_group:reopenCtx?reopenCtx.group:undefined,
    hist_items:items,
    job,
    brand_color:(localStorage.getItem('wl_brand')||'').trim(),
    gb_state:(gbState&&gbState.out)?gbState.out:undefined,
    template:tplSelected(),
  };
}
function genErrorMessage(err){
  if(err&&err.name==="AbortError")
    return tf("gen.timeout",{s:Math.round(genTimeoutMs()/1000)});
  return err.message;
}
$("#goRes").addEventListener("click",async ()=>{
  const pending=items.filter(x=>!x.ok).length;
  if(pending>0){toast(tf("gen.pending_confirm",{n:pending}));return;}  // 未全确认给反馈，避免静默无反应
  const btn=$("#goRes");btn.disabled=true;
  const prog=beginGenProgress();
  const ctl=new AbortController();
  const guard=setTimeout(()=>ctl.abort(),genTimeoutMs());   // 超时兜底：中止等待，恢复按钮
  try{
    const resp=await fetch(API+"/api/generate",{method:"POST",headers:{"Content-Type":"application/json"},signal:ctl.signal,
      body:JSON.stringify(buildGeneratePayload(prog.job))});
    const res=await resp.json();
    // 服务端 msg 经 lm() 映射；缺 msg 时用字典兜底（不直写中文，防英文态漏中文）
    if(!res.ok)throw new Error(res.msg?lm(res):t("gen.fail"));
    gSummary=res.summary;gSid=res.sid;$("#dlName").textContent=gSid;
    if(res.history_id)localStorage.setItem("wl_last_history",res.history_id);   // FR-1.8 会话恢复锚点
    const asyncCalc=res.recalc==="async";   // T00931：公式缓存改为后台补算，结果已可下载
    await prog.finish(asyncCalc?"生成完成（公式缓存后台补算中），正在跳转结果…":"生成完成，正在跳转结果…");
    goStep("result");
    showRecalcState(res.recalc,prog.job);   // T00963：结果页展示补算状态
  }catch(err){
    const msg=genErrorMessage(err);
    prog.fail(msg);toast(msg);
  }finally{
    clearTimeout(guard);btn.disabled=false;
  }
});
function sysListHTML(){  // T01556：分系统明细抽出为纯函数，注册进 dyn 后可随语言重绘
  const sys={};const ok=items.filter(x=>x.ok).length?items.filter(x=>x.ok):items;
  ok.forEach(x=>sys[x.system]=(sys[x.system]||0)+us(x));
  return Object.entries(sys).map(([k,v])=>`<div class="sysli"><div class="bico"><i aria-hidden="true" data-lucide="building-2"></i></div><div><b>${k}</b><small>${tf("result.n_fp",{n:items.filter(x=>x.system===k).length})}</small></div><div class="v"><b>${v.toFixed(2)}</b><small>US</small></div></div>`).join("");
}
function buildResult(){
  const s=gSummary||{ufp:0,adjusted_fp:0,work:{mid:0},cost:{mid:0}};
  $("#rFp").textContent=s.ufp;$("#rScale").textContent=s.adjusted_fp;
  $("#rWork").textContent=Math.round(s.work.mid);$("#rWorkL").textContent=s.work.low;$("#rWorkM").textContent=s.work.mid;$("#rWorkH").textContent=s.work.high;
  $("#rCost").textContent=s.cost.mid;$("#rCostL").textContent=s.cost.low;$("#rCostM").textContent=s.cost.mid;$("#rCostH").textContent=s.cost.high;
  dynHtml("#sysList",sysListHTML);
  window.lucide&&lucide.createIcons();
  refreshCharts();   // M2/FR-1.2：图表与明细联动（dispose 旧实例后重建）
}
