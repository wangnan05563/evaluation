/* ===== T00927：确认无误 → 生成进度条（后台真实阶段 + 轮询） ===== */
let genPollTimer=null;
function genProgPaint(pct,stage,isErr){
  const box=$("#genProg");if(!box)return;
  const p=Math.max(0,Math.min(100,Math.round(pct)));
  box.classList.add("on");box.classList.toggle("err",!!isErr);
  box.setAttribute("aria-valuenow",String(p));
  $("#genProgFill").style.width=p+"%";
  $("#genProgPct").textContent=p+"%";
  if(stage)$("#genProgTxt").textContent=stage;
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
      const p=+j.progress.pct||0, stage=j.progress.stage||"正在生成…";
      if(p<this.last)return;                       // 乱序/回退进度：忽略本次
      if(p!==this.last||stage!==this.lastStage){this.lastChange=Date.now();this.lastStage=stage;}
      this.last=p;
      const hold=Date.now()-this.lastChange;
      const txt=(hold>2000)?(stage+"（本阶段已用时 "+(hold/1000).toFixed(1)+"s）"):stage;
      if(txt!==this.shown){this.shown=txt;paint(p,txt);this.painted=true;}
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
      if(est>P.last){P.last=est;genProgPaint(est,"正在生成成品表…已用时 "+((Date.now()-t0)/1000).toFixed(1)+"s");}
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
      genProgPaint(100,"生成失败："+msg,true);
      setTimeout(genProgHide,2800);              // 失败文案保留片刻后收起，避免长期占位
    }
  };
}
// ===== T00963：结果页展示公式缓存补算状态（补算中 / 已写回 / 已跳过 / 失败） =====
let recalcPollTimer=null;
const RECALC_TXT={
  written:"母版公式缓存：已写回 ✓ 当前文件在 WPS / 预览器中也能直接看到数值",
  skipped:"母版公式缓存：已跳过（Excel 打开成品表时会自动重算，数值不受影响）",
  failed:"母版公式缓存：后台补算失败（成品表数据不受影响，可稍后重试生成）"
};
function showRecalcState(mode,job){
  const el=$("#recalcState");
  if(recalcPollTimer){clearInterval(recalcPollTimer);recalcPollTimer=null;}
  if(!el)return;
  if(mode==="sync"){el.style.display="block";el.textContent="母版公式缓存：生成时已同步写回";return;}
  if(mode!=="async"){el.style.display="block";el.textContent="母版公式缓存：未重算（Excel 打开时会自动重算）";return;}
  el.style.display="block";el.textContent="母版公式缓存：后台补算中…";
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
      if(st&&RECALC_TXT[st]){
        el.textContent=RECALC_TXT[st];
        if(recalcPollTimer){clearInterval(recalcPollTimer);recalcPollTimer=null;}
      }else if(Date.now()-t0>180000){                 // 长时间未到终态：停止轮询，保留进行中提示
        el.textContent="母版公式缓存：后台补算仍在进行（完成后会自动替换文件）";
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
    return "生成超时（超过 "+Math.round(genTimeoutMs()/1000)+"s），请检查后台服务或 Excel 是否被弹窗阻塞";
  return err.message;
}
$("#goRes").addEventListener("click",async ()=>{
  const pending=items.filter(x=>!x.ok).length;
  if(pending>0){toast(`尚有 ${pending} 项未确认，请逐项勾选后再生成`);return;}  // 未全确认给反馈，避免静默无反应
  const btn=$("#goRes");btn.disabled=true;
  const prog=beginGenProgress();
  const ctl=new AbortController();
  const guard=setTimeout(()=>ctl.abort(),genTimeoutMs());   // 超时兜底：中止等待，恢复按钮
  try{
    const resp=await fetch(API+"/api/generate",{method:"POST",headers:{"Content-Type":"application/json"},signal:ctl.signal,
      body:JSON.stringify(buildGeneratePayload(prog.job))});
    const res=await resp.json();
    if(!res.ok)throw new Error(res.msg||"生成失败");
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
function buildResult(){
  const s=gSummary||{ufp:0,adjusted_fp:0,work:{mid:0},cost:{mid:0}};
  $("#rFp").textContent=s.ufp;$("#rScale").textContent=s.adjusted_fp;
  $("#rWork").textContent=Math.round(s.work.mid);$("#rWorkL").textContent=s.work.low;$("#rWorkM").textContent=s.work.mid;$("#rWorkH").textContent=s.work.high;
  $("#rCost").textContent=s.cost.mid;$("#rCostL").textContent=s.cost.low;$("#rCostM").textContent=s.cost.mid;$("#rCostH").textContent=s.cost.high;
  const sys={};const ok=items.filter(x=>x.ok).length?items.filter(x=>x.ok):items;
  ok.forEach(x=>sys[x.system]=(sys[x.system]||0)+us(x));
  $("#sysList").innerHTML=Object.entries(sys).map(([k,v])=>`<div class="sysli"><div class="bico"><i aria-hidden="true" data-lucide="building-2"></i></div><div><b>${k}</b><small>${items.filter(x=>x.system===k).length} 个功能点</small></div><div class="v"><b>${v.toFixed(2)}</b><small>US</small></div></div>`).join("");
  window.lucide&&lucide.createIcons();
  refreshCharts();   // M2/FR-1.2：图表与明细联动（dispose 旧实例后重建）
}
