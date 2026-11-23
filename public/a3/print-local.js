(()=>{
  const id=new URLSearchParams(location.hash.slice(1)).get("id");
  const data=JSON.parse(localStorage.getItem("luton-a3-frozen-web-preview-v1")||"{}");
  const item=JSON.parse(data["luton-quote-v45"]||"[]").find(q=>q.id===id&&q.worksheet);
  const equipment=item?.worksheet.lines.find(row=>row.kind==="model");
  if(!equipment){
    document.body.replaceChildren();
    document.body.textContent="当前设备没有这条锁价记录。";
    return;
  }
  const text=(id,value)=>{document.getElementById(id).textContent=value};
  text("customer",item.customer);
  text("sales",item.sales);
  text("date",item.request.date);
  text("snapshotId",item.id);
  text("quoteModel",equipment.name.includes(item.request.model)?equipment.name:equipment.name+"（"+item.request.model+"）");
  document.querySelector(".base tbody tr").cells[1].textContent=equipment.qty;
  const amount=Number(item.amount).toLocaleString("zh-CN");
  text("snapshotAmount",item.currency==="CNY"?"人民币 "+amount+" 元":item.currency+" "+amount);
  const projects=item.worksheet.lines.filter(row=>row.kind!=="model");
  if(!projects.length)return;
  const block=document.getElementById("projects");
  const title=document.createElement("h2");
  title.textContent="配置项目";
  const table=document.createElement("table");
  table.className="project-list";
  const headers=table.createTHead().insertRow();
  for(const name of ["项目名称","数量"]){
    const th=document.createElement("th");
    th.textContent=name;
    headers.append(th);
  }
  const body=table.createTBody();
  for(const project of projects){
    const row=body.insertRow();
    row.insertCell().textContent=project.name;
    row.insertCell().textContent=project.qty;
  }
  block.append(title,table);
})();
