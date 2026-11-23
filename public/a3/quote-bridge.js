/* V4.3 unified quotation boundary; no production data. */
(function(root){'use strict';
const C=typeof module==='object'&&module.exports?require('./catalog-core'):root.CatalogCore;
const KEY='luton-quote-v43-snapshots',ACTIVE='luton-quote-v43-active';
const clone=x=>JSON.parse(JSON.stringify(x));
function canonical(x){if(Array.isArray(x))return '['+x.map(canonical).join(',')+']';if(x&&typeof x==='object')return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';return JSON.stringify(x)}
function snapshot(c,request,meta){const {id,customer,sales,createdAt,quotedAt,scopeConfirmed}=meta;const r=C.calculate(c,request);if(!r.finalizable||!scopeConfirmed)throw Error('价格、规则及供货范围须全部复核');if(![id,customer,sales].every(x=>typeof x==='string'&&x.trim()))throw Error('编号、客户、业务员必填');if(![createdAt,quotedAt].every(x=>typeof x==='string'&&Number.isFinite(Date.parse(x)))||Date.parse(quotedAt)<Date.parse(createdAt))throw Error('报价时间无效');const frozen={schema:1,models:[r.model],rules:r.detail.filter(x=>x.kind!=='MANUAL').map(({qty,lineAmount,...rule})=>rule)};return clone({schema:1,id,customer,sales,createdAt,quotedAt,scopeConfirmed:true,request,catalog:frozen,result:r,currency:'CNY',amount:r.subtotal})}
function verify(q){if(!q||q.schema!==1||q.currency!=='CNY')throw Error('快照格式无效');const r=snapshot(q.catalog,q.request,q);if(canonical(r)!==canonical(q))throw Error('快照内容不一致');return q}
function read(storage){const a=JSON.parse(storage.getItem(KEY)||'[]');if(!Array.isArray(a))throw Error('存档格式无效');const ids=new Set();for(const q of a){verify(q);if(ids.has(q.id))throw Error('存档编号重复');ids.add(q.id)}return a}
function save(storage,q){verify(q);const a=read(storage),old=a.find(x=>x.id===q.id);if(old&&canonical(old)!==canonical(q))throw Error('编号冲突');if(!old)storage.setItem(KEY,JSON.stringify([...a,q]));return q}
function projection(q){verify(q);return {model:q.result.model.id,amount:q.amount,currency:q.currency,scope:q.result.model.scope,options:q.result.detail.map(x=>({label:x.label,qty:x.qty}))}}
function publish(storage,q,model,confirmed){const p=projection(q);if(!confirmed||p.model!==model||!['LB1500','LB4000'].includes(model)||p.options.length)throw Error('展示仅支持已匹配的标准配置；其他型号及增减项暂不发布');save(storage,q);storage.setItem(ACTIVE,q.id);return p}
function active(storage,model){const id=storage.getItem(ACTIVE);if(!id)return null;const q=read(storage).find(x=>x.id===id);if(!q)throw Error('展示快照不存在');const p=projection(q);return p.model===model&&!p.options.length&&['LB1500','LB4000'].includes(model)?p:null}
const api={KEY,ACTIVE,snapshot,verify,read,save,projection,publish,active};if(typeof module==='object'&&module.exports)module.exports=api;else root.QuoteBridge=api;
})(typeof globalThis!=='undefined'?globalThis:this);
