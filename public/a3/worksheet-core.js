/* Shared conversion from editable worksheet lines to the existing quotation request. */
(function(root){
'use strict';
const C=typeof module==='object'&&module.exports?require('./catalog-core'):root.CatalogCore;
function prepare(c, sheet, date, evidence, confirmed) {
  if(!Array.isArray(sheet)||!sheet.length||sheet.length>100)throw Error('请输入 1 至 100 行报价项目');
  const devices=sheet.filter(r=>r.kind==='model');
  if(devices.length!==1)throw Error('请选择且仅选择一台目录设备');
  const model=devices[0].id;
  const items=[],manual=[];
  const lines=sheet.map((r,index)=>{
    const prefix='第 '+(index+1)+' 行 ';
    const label=typeof r.name==='string'?r.name.trim():'';
    const qty=Number(r.qty);
    if(!label||!/^\d+$/.test(r.qty)||!Number.isSafeInteger(qty)||qty<1)throw Error(prefix+'请填写项目名和正整数数量');
    if(r.kind==='model'||r.kind==='rule'){
      const kind=r.kind==='model'?'models':'rules';
      const approved=C.reviewed(c[kind],r.id,date);
      if(!approved)throw Error(prefix+'目录价格待核或缺价');
      if(r.rev!==approved.rev)throw Error(prefix+'核定版本已变，请重新核对目录价格');
      if(r.kind==='model'&&qty!==1)throw Error(prefix+'设备数量须为 1');
      if(r.kind==='rule'){
        if(approved.model!==model)throw Error(prefix+'增减规则不适用于 '+model);
        if(approved.maxQty!=null&&qty>approved.maxQty)throw Error(prefix+'数量超过上限 '+approved.maxQty);
        items.push({id:r.id,qty});
      }
      const amount=qty*approved.amount;
      if(!Number.isSafeInteger(amount))throw Error(prefix+'金额超出范围');
      return {kind:r.kind,id:r.id,rev:r.rev,name:label,qty,unit:approved.amount,amount};
    }
    if(r.kind!=='manual'||![1,-1].includes(r.sign)||!/^\d+$/.test(r.unit))throw Error(prefix+'请填写人民币整数单价');
    const unit=Number(r.unit);
    if(!Number.isSafeInteger(unit)||!Number.isSafeInteger(unit*qty))throw Error(prefix+'金额超出范围');
    const amount=unit*qty*r.sign;
    if(!amount)throw Error(prefix+'临时项金额须非零');
    manual.push({label,amount,source:evidence,coverageKey:'worksheet-row-'+index,confirmed});
    return {kind:'manual',name:label,qty,unit:r.sign*unit,amount};
  });
  return {request:{model,date,items,manual},lines};
}
const api={prepare};if(typeof module==='object'&&module.exports)module.exports=api;else root.WorksheetCore=api;
})(typeof globalThis!=='undefined'?globalThis:this);
