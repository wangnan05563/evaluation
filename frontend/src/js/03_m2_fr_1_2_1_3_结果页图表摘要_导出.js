/* ===== M2/FR-1.2、1.3：结果页图表摘要 + 导出管线 ===== */
let _charts={};
function chartTheme(){const cs=getComputedStyle(document.documentElement);
  return {brand:(cs.getPropertyValue("--brand")||"#2563EB").trim(),muted:(cs.getPropertyValue("--muted")||"#6B7280").trim(),grid:(cs.getPropertyValue("--chart-grid")||"#E5E7EB").trim(),tipBg:(cs.getPropertyValue("--chart-tip-bg")||"#FFFFFF").trim(),tipInk:(cs.getPropertyValue("--chart-tip-ink")||"#1F2937").trim()};}
function refreshCharts(){
  if(typeof echarts==="undefined"){chartsFallback();return;}
  const ok=items.filter(x=>x.ok).length?items.filter(x=>x.ok):items;
  const byType={},byReuse={};
  ok.forEach(x=>{byType[x.type]=(byType[x.type]||0)+1;byReuse[x.reuse]=(byReuse[x.reuse]||0)+1;});
  const sys={};ok.forEach(x=>sys[x.system]=(sys[x.system]||0)+us(x));
  let sysArr=Object.entries(sys).map(([k,v])=>({name:k,us:+v.toFixed(2)})).sort((a,b)=>b.us-a.us);
  if(sysArr.length>15){const rest=+sysArr.slice(14).reduce((s,x)=>s+x.us,0).toFixed(2);
    sysArr=sysArr.slice(0,14);sysArr.push({name:t("result.chart_other"),us:rest});}
  const th=chartTheme();
  // T01556：图表随 setLang→refreshCharts 重建，绘制期文案一律现取 t()；
  // tooltip 的 {b}/{c}/{d} 是 ECharts 占位符，字典值原样保留（t 不插值）。
  const opts={
    c1:{tooltip:{trigger:"item",formatter:t("result.chart_tip_item"),backgroundColor:th.tipBg,borderColor:th.grid,textStyle:{color:th.tipInk}},legend:{bottom:0,textStyle:{color:th.tipInk}},
        series:[{type:"pie",radius:["35%","65%"],data:Object.entries(byType).map(([k,v])=>({name:k,value:v})),
                 label:{formatter:"{b}\n{c}"}}]},
    c2:{tooltip:{backgroundColor:th.tipBg,borderColor:th.grid,textStyle:{color:th.tipInk}},grid:{left:44,right:16,top:20,bottom:24},
        xAxis:{type:"category",data:Object.keys(byReuse).map(k=>t("common.lv."+LV[k]))},yAxis:{type:"value",minInterval:1},
        series:[{type:"bar",barWidth:"45%",data:Object.values(byReuse),itemStyle:{color:th.brand}}]},
    c3:{tooltip:{backgroundColor:th.tipBg,borderColor:th.grid,textStyle:{color:th.tipInk}},grid:{left:90,right:30,top:10,bottom:24},
        xAxis:{type:"value"},yAxis:{type:"category",inverse:true,data:sysArr.map(x=>x.name)},
        series:[{type:"bar",barWidth:"55%",data:sysArr.map(x=>x.us),itemStyle:{color:th.brand},
                 label:{show:true,position:"right",formatter:"{c} US"}}]},
    c4:{tooltip:{backgroundColor:th.tipBg,borderColor:th.grid,textStyle:{color:th.tipInk}},grid:{left:60,right:30,top:24,bottom:24},
        xAxis:{type:"category",data:[t("result.kpi.low"),t("result.kpi.mid"),t("result.kpi.high")]},yAxis:{type:"value"},
        series:[{type:"bar",barWidth:"40%",data:[gSummary?gSummary.work.low:0,gSummary?gSummary.work.mid:0,gSummary?gSummary.work.high:0],
                 itemStyle:{color:th.brand},label:{show:true,position:"top"}}]}};
  ["c1","c2","c3","c4"].forEach(id=>{
    const el=document.getElementById(id);if(!el)return;
    if(_charts[id]){_charts[id].dispose();delete _charts[id];}
    try{
      _charts[id]=echarts.init(el);
      _charts[id].setOption({...opts[id],
        toolbox:{right:8,top:0,feature:{saveAsImage:{name:id+"-"+baseName(),pixelRatio:2}}}});
    }catch(e){/* 单图初始化失败不影响其余 */}
  });
  window.lucide&&lucide.createIcons();
}
function chartsFallback(){  // echarts 缺失（离线极端场景）：数字表格降级
  ["c1","c2","c3","c4"].forEach(id=>{const el=document.getElementById(id);if(!el)return;
    el.innerHTML=`<small style="color:var(--muted)">${t("result.chart_fallback")}</small>`;});
}
window.addEventListener("resize",()=>Object.values(_charts).forEach(c=>c.resize()));
function baseName(){return (gSid||"工作量评估").replace("-工作量评估.xlsx","").replace(/\.xlsx$/,"");}
function _dl(name,content,mime){const blob=new Blob([content],{type:mime});const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),3000);}
function expToggle(e){e&&e.stopPropagation();const m=$("#expMenu");m.style.display=m.style.display==="block"?"none":"block";}
document.addEventListener("click",()=>{const m=document.getElementById("expMenu");if(m)m.style.display="none";});
function expCsvStr(){  // FR-1.3：全字段 CSV（BOM 由调用方加）
  const head="seq,系统,模块,描述,计数项名称,类型,重用度,修改类型,复杂度";
  const rows=items.map(it=>[it.seq,it.system,it.m1,it.desc,it.count_item,it.type,it.reuse,it.modify,it.cx||""]
    .map(v=>`"${String(v??"").replaceAll('"','""')}"`).join(","));
  return head+"\n"+rows.join("\n");
}
function expCsv(){if(!items.length){toast(t("result.export.no_items"));return;}
  _dl(baseName()+"-功能点明细.csv","\uFEFF"+expCsvStr(),"text/csv;charset=utf-8");toast(t("result.export.csv_done"));}
function expMdStr(){  // FR-1.3：Markdown 摘要
  if(!gSummary)return "";
  const s=gSummary,now=new Date().toLocaleString("zh-CN");
  const ok=items.filter(x=>x.ok).length?items.filter(x=>x.ok):items;
  const byType={},byReuse={};ok.forEach(x=>{byType[x.type]=(byType[x.type]||0)+1;byReuse[x.reuse]=(byReuse[x.reuse]||0)+1;});
  const sys={};ok.forEach(x=>sys[x.system]=(sys[x.system]||0)+us(x));
  const top=[...ok].sort((a,b)=>us(b)-us(a)).slice(0,10);
  let md=`# 工作量估算摘要（${baseName()}）\n\n- 生成时间：${now}\n- 估算方法：${$("#methodSel").value}\n- 未调整功能点：${s.ufp} FP\n- 调整后规模：${s.adjusted_fp} FP\n- 工作量（人天）：低 ${s.work.low} / 中 ${s.work.mid} / 高 ${s.work.high}\n- 费用（万元）：低 ${s.cost.low} / 中 ${s.cost.mid} / 高 ${s.cost.high}\n\n## 分布统计\n\n| 维度 | 项 | 数量 |\n|---|---|---|\n`;
  Object.entries(byType).forEach(([k,v])=>{md+=`| 类型 | ${k} | ${v} |\n`;});
  Object.entries(byReuse).forEach(([k,v])=>{md+=`| 重用度 | ${k} | ${v} |\n`;});
  Object.entries(sys).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>{md+=`| 模块 | ${k} | US ${v.toFixed(2)} |\n`;});
  md+=`\n## Top10 功能点（按 US 降序）\n\n| # | 系统 | 描述 | 类型 | 重用度 | US |\n|---|---|---|---|---|---|\n`;
  top.forEach((x,i)=>{md+=`| ${i+1} | ${x.system} | ${x.desc} | ${x.type} | ${x.reuse} | ${us(x).toFixed(2)} |\n`;});
  if(gbState&&gbState.out){const o=gbState.out;
  md+=`
## 国标造价（GB/T 36964-2018）

- 规模 S = UFP(${o.ufp}) × GSC(${o.gsc}) × CF(${o.stage}=${o.cf}) = ${o.S}
- AE = PDR(${o.pdr}) × S × SWF(${o.swf}) × RDF(${o.rdf}) = ${o.ae} 人时（${(o.ae/174).toFixed(2)} 人月）
- 费用 = AE/174 × 费率(${o.rate}) + DNHC(${o.dnhc}) = ${o.fee} 元
- 出处：GB/T 36964-2018 · 本测算基于 ${o.stage} 阶段，CF=${o.cf}${Object.keys(gbState.custom).length?"（含人工调整因子）":""}
`;}
return md;
}
function expMd(){if(!gSummary){toast(t("result.export.no_summary"));return;}
  const md=expMdStr();
  _dl(baseName()+"-摘要.md",md,"text/markdown;charset=utf-8");
  if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(md).then(()=>toast(t("result.export.md_clip"))).catch(()=>toast(t("result.export.md_done")));}
  else toast(t("result.export.md_done"));}
function expPdf(){  // FR-1.3：打印管线（用户在系统对话框选“另存为 PDF”）；canvas 打印可能空白，先转 <img>
  if(!items.length){toast(t("result.export.no_items"));return;}
  const snaps=[];
  Object.entries(_charts).forEach(([id,ch])=>{const el=document.getElementById(id);if(!el)return;
    snaps.push([el,el.innerHTML]);
    el.innerHTML=`<img src="${ch.getDataURL({pixelRatio:2})}" style="width:100%">`;});
  const done=()=>{snaps.forEach(([el,h])=>{el.innerHTML=h;});window.removeEventListener("afterprint",done);};
  window.addEventListener("afterprint",done);
  toast(t("result.export.print_tip"));
  setTimeout(()=>window.print(),300);
}
