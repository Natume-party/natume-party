/* Independent integer-CNY quote kernel. No eval, network, or storage. */
(function(root){'use strict';
const MAX=Number.MAX_SAFE_INTEGER;
function money(v){if(typeof v!=='number'||!Number.isSafeInteger(v))throw Error('金额必须为安全整数人民币元');return v}
function add(a,b){return money(money(a)+money(b))}
function calc({base,lines=[],missing=[],scopeVerified=false,model,priceType='INTERNAL',historical=false}){
 const issues=[...missing.map(String)], seen=new Set(), coverage=new Set();let total=money(base);if(total<=0)issues.push('基础价必须大于零');
 const detail=[];
 for(const line of lines){if(!line.id||seen.has(line.id))throw Error('重复或缺失行ID');seen.add(line.id);
 if(line.model&&line.model!==model){issues.push('型号不匹配: '+line.id);continue}
 if(line.priceType&&line.priceType!==priceType){issues.push('价格类型不匹配: '+line.id);continue}
 if(line.historical&&!historical){issues.push('历史规则不可用于新报价: '+line.id);continue}
 if(line.amount==null){issues.push('未定价: '+line.id);continue}
 const keys=line.coverage||[];if(keys.some(k=>coverage.has(k))){issues.push('重复供货计价: '+line.id);continue}keys.forEach(k=>coverage.add(k));
 const qty=line.qty??1;if(!Number.isSafeInteger(qty)||qty<=0)throw Error('数量必须为正整数');const amount=money(money(line.amount)*qty);total=add(total,amount); detail.push({id:line.id,qty,unit:line.amount,amount});
 }
 if(!scopeVerified)issues.push('供货范围待核');if(total<=0)issues.push('总价必须大于零');
 return {subtotal:total,detail,issues,finalizable:issues.length===0&&!historical};
}
function snapshot(input,{customer,sales,createdAt,quotedAt,currency='CNY',rate=1,rateAt=null,rateSource=null,rateState='BASE',id,priceVersion,now=new Date().toISOString()}){
 const r=calc(input);if(!r.finalizable)throw Error(r.issues.join('；')||'历史结果不得发布');if(![customer,sales,id,priceVersion].every(x=>typeof x==='string'&&x.trim()))throw Error('客户、业务员、编号和价格版本不能为空');if(![createdAt,quotedAt,now].every(x=>typeof x==='string'&&Number.isFinite(Date.parse(x))))throw Error('时间无效');if(Date.parse(quotedAt)<Date.parse(createdAt))throw Error('报价时间早于新建时间');
 if(!Number.isFinite(rate)||rate<=0||currency==='CNY'&&rate!==1||currency!=='CNY'&&(!rateAt||!rateSource||!['FRESH','MANUAL'].includes(rateState)))throw Error('外币需要有效已确认汇率');
 const amount=Math.round(r.subtotal*rate);money(amount);if(amount<=0)throw Error('折算金额无效');return JSON.parse(JSON.stringify({schema:1,id,priceVersion,customer,sales,createdAt,quotedAt,lockedAt:now,input,result:r,currency,rate,rateAt,rateSource,rateState,amount}));
}
const api={calc,snapshot,money};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.QuoteCore=api;
})(typeof globalThis!=='undefined'?globalThis:this);
