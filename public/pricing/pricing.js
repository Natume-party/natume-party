const $=id=>document.getElementById(id);
const money=new Intl.NumberFormat("zh-CN",{style:"currency",currency:"CNY",maximumFractionDigits:0});
let catalog, chosen=[], activeModel=null;
const route="/api/quote/";
async function request(name,body){
  const options=body===undefined?{}:{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)};
  const r=await fetch(route+name,{...options,cache:"no-store"});
  const data=await r.json();
  if(!r.ok){const e=Error(data.error||"请稍后重试");e.status=r.status;throw e}
  return data;
}
function showGate(){
  catalog=null;chosen=[];activeModel=null;
  $("pricing").hidden=true;$("gate").hidden=false;$("logout").hidden=true;
  $("filter").value="";$("models").replaceChildren();$("rules").replaceChildren();
  $("changes").querySelector("tbody").replaceChildren();$("basis").textContent=$("total").textContent="—";
}
async function load(){
  catalog=await request("catalog");chosen=[];activeModel=null;
  $("gate").hidden=true;$("pricing").hidden=false;$("logout").hidden=false;
  $("price-date").textContent="价格日期 "+catalog.date;
  filterModels();refreshModel();
}
$("login").onsubmit=async e=>{
  e.preventDefault();const button=e.target.querySelector("button");button.disabled=true;
  try{await request("login",{password:$("access").value});$("access").value="";await load();$("filter").focus()}
  catch(error){$("login-status").textContent=error.message;$("access").select()}
  finally{button.disabled=false}
};
$("logout").onclick=async()=>{
  try{await request("logout",{});showGate();$("login-status").textContent="已退出";$("access").focus()}
  catch(error){$("quote-status").textContent=error.message}
};
function filterModels(){
  const word=$("filter").value.trim().toLowerCase(), selected=activeModel?.id||"";
  const matches=catalog.models.filter(m=>m.id===selected||(m.id+" "+m.name+" "+m.configuration).toLowerCase().includes(word));
  $("models").replaceChildren(new Option(matches.length?"请选择设备":"未找到设备",""),...matches.map(m=>new Option(m.name+" · "+m.id,m.id)));
  $("models").value=selected;
}
$("filter").oninput=filterModels;
$("models").onchange=()=>{
  if(chosen.length&&!confirm("切换设备会清空当前增减项，继续吗？")){$("models").value=activeModel.id;return}
  activeModel=catalog.models.find(m=>m.id===$("models").value);
  chosen=[];$("quote-status").textContent="";refreshModel();
};
function refreshModel(){
  const modelId=activeModel?.id;
  const options=catalog.rules.filter(r=>r.model===modelId);
  const select=$("rules");
  select.replaceChildren(new Option(options.length?"选择增减项":"没有可选增减项",""));
  const groups={increase:"增配项目",decrease:"减配项目",included:"不另计价",confirm:"需核价或另算"};
  const kind=r=>r.type||(r.amount===null?'confirm':r.amount<0?'decrease':r.amount===0?'included':'increase');
  for(const [type,label] of Object.entries(groups)){
    const rows=options.filter(r=>kind(r)===type);
    if(!rows.length)continue;
    const group=document.createElement("optgroup");group.label=label;
    for(const r of rows){
      const option=new Option(r.name+" · "+(r.amount===null?"金额待核":money.format(r.amount))+
        (r.amount!==null&&r.status!=="已核定"?" · 待核":""),r.id);
      option.disabled=r.amount===null;group.append(option);
    }
    select.append(group);
  }
  $("rule-note").textContent="";
  $("equipment-config").textContent=activeModel?.configuration||"请先选择设备";
  $("configuration-status").textContent=activeModel?.configurationStatus||"";
  const reference=activeModel?.reference||[];
  $("reference").hidden=!reference.length;$("reference").open=false;
  $("technical").replaceChildren(...reference.flatMap(([label,value])=>{
    const dt=document.createElement("dt"),dd=document.createElement("dd");
    dt.textContent=label;dd.textContent=value;return [dt,dd];
  }));
  $("basis").textContent=activeModel?money.format(activeModel.amount):"—";
  $("add").disabled=!options.some(r=>r.amount!==null);
  draw();
}
function draw(){
  const tbody=$("changes").querySelector("tbody");tbody.replaceChildren();
  for(const [i,{rule,quantity}] of chosen.entries()){
    const row=tbody.insertRow();
    for(const value of [rule.name,quantity,money.format(rule.amount*quantity)])row.insertCell().textContent=value;
    const remove=document.createElement("button");remove.type="button";remove.textContent="移除";remove.setAttribute("aria-label","移除 "+rule.name);
    remove.onclick=()=>{chosen.splice(i,1);$("quote-status").textContent="";draw()};row.insertCell().append(remove);
  }
  $("changes").hidden=!chosen.length;
  const total=activeModel?activeModel.amount+chosen.reduce((sum,l)=>sum+l.rule.amount*l.quantity,0):null;
  const unreviewed=chosen.some(l=>l.rule.status!=="已核定");
  $("total").textContent=total!==null&&Number.isSafeInteger(total)&&total>0?money.format(total):"—";
  $("sum-title").textContent=unreviewed?"人民币试算":"人民币合计";
  $("sum-note").textContent=unreviewed?"含待核增减项，对客报价前须确认":total!==null&&(!Number.isSafeInteger(total)||total<=0)?"金额超出范围":'';
}
$("add").onclick=()=>{
  const rule=catalog.rules.find(r=>r.id===$("rules").value&&r.model===activeModel?.id);
  const quantity=Number($("quantity").value);
  if(!rule||rule.amount===null){$("quote-status").textContent="请选择有金额的增减项";return}
  if(!Number.isSafeInteger(quantity)||quantity<1||!Number.isSafeInteger(quantity*rule.amount)||(rule.maxQty&&quantity>rule.maxQty)){
    $("quote-status").textContent=rule.maxQty?"数量须为 1 至 "+rule.maxQty+" 的整数":"请输入有效数量";return
  }
  if(chosen.some(x=>x.rule.id===rule.id||x.rule.coverage.some(c=>rule.coverage.includes(c)))){
    $("quote-status").textContent="此供货项已加入，请先移除重复项";return
  }
  chosen.push({rule,quantity});$("quote-status").textContent="";$("quantity").value="1";draw();
};
$("rules").onchange=()=>{
  $("rule-note").textContent=catalog.rules.find(r=>r.model===activeModel?.id&&r.id===$("rules").value)?.note||"";
};
$("quantity").onkeydown=e=>{if(e.key==="Enter"&&!e.isComposing)$("add").click()};
load().catch(e=>{showGate();if(e.status!==401)$("login-status").textContent=e.message});
