/* V4.4 generic internal quote helpers. No business data. */
(function(root){'use strict';
const B=typeof module==='object'&&module.exports?require('./quote-bridge'):root.QuoteBridge;
const C=typeof module==='object'&&module.exports?require('./catalog-core'):root.CatalogCore;
function canonical(x){if(Array.isArray(x))return '['+x.map(canonical).join(',')+']';if(x&&typeof x==='object')return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';return JSON.stringify(x)}
function mergeCatalog(old,next){C.validate(old);C.validate(next);const out={...old,...next};for(const kind of ['models','rules']){const map=new Map;for(const x of [...old[kind],...next[kind]]){const key=x.id+'@'+x.rev;if(map.has(key)&&canonical(map.get(key))!==canonical(x))throw Error('知识库版本冲突：'+key);map.set(key,x)}out[kind]=[...map.values()]}const refs=new Map;for(const x of [...(old.references||[]),...(next.references||[])])refs.set(canonical(x),x);out.references=[...refs.values()];return C.validate(out)}
function draftReplacement({oldAmount,newAmount,qty=1,label,source,priceType}){if(priceType!=='MATCHED_SELL_PRICE'||!label||!source||![oldAmount,newAmount,qty].every(Number.isSafeInteger)||oldAmount<0||newAmount<0||qty<1)throw Error('必须明确同口径销售价、数量及替换依据');const amount=(newAmount-oldAmount)*qty;if(!Number.isSafeInteger(amount)||!amount)throw Error('差价为零或超出安全范围');return {label,source,amount,oldAmount,newAmount,qty,priceType,kind:'REPLACEMENT_DRAFT'}}
function exportArchive(storage){return {schema:'luton-v43-archive/1',quotes:B.read(storage)}}
function importArchive(storage,backup){if(backup?.schema!=='luton-v43-archive/1'||!Array.isArray(backup.quotes))throw Error('档案备份格式错误');const existing=B.read(storage),map=new Map(existing.map(q=>[q.id,q]));for(const q of backup.quotes){B.verify(q);if(map.has(q.id)&&canonical(map.get(q.id))!==canonical(q))throw Error('档案编号冲突：'+q.id);map.set(q.id,q)}storage.setItem(B.KEY,JSON.stringify([...map.values()]));return map.size}
const api={mergeCatalog,draftReplacement,exportArchive,importArchive};if(typeof module==='object'&&module.exports)module.exports=api;else root.V44Tools=api;
})(typeof globalThis!=='undefined'?globalThis:this);
