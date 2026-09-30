const fs=require("fs");
const html=fs.readFileSync("d:/code/otherProjects/27_Evaluation/frontend/index.html","utf-8");
const m=html.match(/<script>([\s\S]*?)<\/script>/);
try{new Function(m[1]);console.log("JS syntax OK, len="+m[1].length);
  // 检查关键函数存在
  ["goPage","pertNew","pertAdd","pertRefresh","pertGen","pertDel"].forEach(f=>{
    if(!m[1].includes("function "+f))console.log("MISSING func "+f);});
  console.log("funcs present");
}catch(e){console.log("JS ERR: "+e.message);process.exit(1);}