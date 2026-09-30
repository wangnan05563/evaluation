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
function beginGenProgress(){
  // 每次生成一个 job id：服务端按真实阶段写进度，前端 300ms 轮询（ThreadingHTTPServer 不阻塞主请求）
  const job="g"+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
  if(genPollTimer){clearInterval(genPollTimer);genPollTimer=null;}
  const t0=Date.now();let last=0,got=false,lastChange=t0,lastStage="",shown="",settled=false;
  genProgPaint(2,"正在提交生成请求…");
  const tick=async ()=>{
    if(settled)return;   // 已结束（finish/fail）后不再绘制，防止在途轮询覆盖结果态
    try{
      const r=await fetch(API+"/api/generate/progress?job="+encodeURIComponent(job),{cache:"no-store"});
      const j=await r.json();
      if(j&&j.ok&&j.progress){
        got=true;
        const p=+j.progress.pct||0,stage=j.progress.stage||"正在生成…";
        if(p>=last){
          if(p!==last||stage!==lastStage){lastChange=Date.now();lastStage=stage;}
          last=p;
          // 同一阶段停留 >2s 时补一句真实已用时，避免看起来"卡住"（不伪造百分比）
          const hold=Date.now()-lastChange;
          const txt=(hold>2000)?(stage+"（本阶段已用时 "+(hold/1000).toFixed(1)+"s）"):stage;
          if(txt!==shown){shown=txt;genProgPaint(p,txt);}
        }
        return;
      }
    }catch(e){/* 轮询异常不打断生成主流程 */}
    if(settled)return;
    if(!got){   // 服务端无进度记录（旧实例/接口不可用）：按耗时推进并停在 92%，不伪装真实阶段
      const est=Math.min(92,Math.round((Date.now()-t0)/250));
      if(est>last){last=est;genProgPaint(est,"正在生成成品表…已用时 "+((Date.now()-t0)/1000).toFixed(1)+"s");}
    }
  };
  genPollTimer=setInterval(tick,300);tick();
  return {
    job,
    async finish(txt){
      settled=true;
      if(genPollTimer){clearInterval(genPollTimer);genPollTimer=null;}
      genProgPaint(100,txt||"生成完成");
      await new Promise(r=>setTimeout(r,420));   // 让 100% 可见后再跳转
      genProgHide();
    },
    fail(msg){
      settled=true;
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
$("#goRes").addEventListener("click",async ()=>{
  const pending=items.filter(x=>!x.ok).length;
  if(pending>0){toast(`尚有 ${pending} 项未确认，请逐项勾选后再生成`);return;}  // 未全确认给反馈，避免静默无反应
  const btn=$("#goRes");btn.disabled=true;
  const prog=beginGenProgress();
  const ctl=new AbortController();
  const guard=setTimeout(()=>ctl.abort(),genTimeoutMs());   // 超时兜底：中止等待，恢复按钮
  try{
    const resp=await fetch(API+"/api/generate",{method:"POST",headers:{"Content-Type":"application/json"},signal:ctl.signal,
      body:JSON.stringify({items:items.map(({system,m1,desc,count_item,type,reuse,modify})=>({system,m1,desc,count_item,type,reuse,modify})),method:$("#methodSel").value,
        title:(reopenCtx&&reopenCtx.title)?reopenCtx.title:(curFile&&curFile.name)?curFile.name.replace(/\.(docx|doc|pdf)$/i,''):"",
        reopen_group:reopenCtx?reopenCtx.group:undefined,hist_items:items,job:prog.job,brand_color:(localStorage.getItem('wl_brand')||'').trim(),gb_state:(gbState&&gbState.out)?gbState.out:undefined,template:tplSelected()})});
    const res=await resp.json();
    if(!res.ok)throw new Error(res.msg||"生成失败");
    gSummary=res.summary;gSid=res.sid;$("#dlName").textContent=gSid;
    if(res.history_id)localStorage.setItem("wl_last_history",res.history_id);   // FR-1.8 会话恢复锚点
    const asyncCalc=res.recalc==="async";   // T00931：公式缓存改为后台补算，结果已可下载
    await prog.finish(asyncCalc?"生成完成（公式缓存后台补算中），正在跳转结果…":"生成完成，正在跳转结果…");
    goStep("result");
    showRecalcState(res.recalc,prog.job);   // T00963：结果页展示补算状态
  }catch(err){
    const msg=(err&&err.name==="AbortError")
      ? "生成超时（超过 "+Math.round(genTimeoutMs()/1000)+"s），请检查后台服务或 Excel 是否被弹窗阻塞"
      : err.message;
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
