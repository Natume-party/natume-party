(function(){'use strict';const status=t=>$('v45Status').textContent=t, val=id=>$(id).value.trim();let snap=null;
function configs(){return val('v45Config').split('\n').filter(x=>x.trim()).map(x=>{const p=x.indexOf('=');return p<1?[]:[x.slice(0,p).trim(),x.slice(p+1).trim()]})}
function buildSnapshot(){return V45.snapshot(cat,quoteRequest(),{
    parentQuoteId:$('quoteWorkbench').dataset.parent,id:$('quoteWorkbench').dataset.draftId || crypto.randomUUID(),customer:val('customer'),sales:val('sales'),createdAt,quotedAt:draftTime(),
    reviewer:val('sheetv45Reviewer'),evidence:val('sheetv45Evidence'),scopeConfirmed:$('scopeConfirmed').checked,
    config:configs(),fx:draftFx()
  })}
window.buildSnapshot=buildSnapshot;
function invalidate(){snap=null;$('v45Publish').disabled=true}
function list(){try{$('v45History').replaceChildren(new Option('选择历史报价',''),...V45.read(localStorage).map(q=>new Option(q.quotedAt.slice(0,16)+' · '+(q.request?.model||q.input?.model)+' · '+q.currency+' '+q.amount.toLocaleString(),q.id)))}catch(e){status(e.message)}}
function refreshReview(){const kind=$('v45Kind').value;const rows=current(cat[kind]);options($('v45ReviewId'),rows);readReview()}
function readReview(){const r=CatalogCore.latest(cat[$('v45Kind').value],val('v45ReviewId'),date());if(!r)return;$('v45ReviewAmount').value=r.amount??'';$('v45ReviewScope').value=r.scope??'';$('v45Effective').value=r.effectiveFrom??'';$('v45ReviewSource').textContent=r.source+' · v'+r.rev+' · '+r.status+' · '+(r.note||'')}
const originalDraw=draw;draw=function(){originalDraw();invalidate();refreshReview()};
$('v45Kind').onchange=refreshReview;$('v45ReviewId').onchange=readReview;
$('v45Approve').onclick=()=>{try{if(!$('v45ReviewConfirm').checked||!val('v45ReviewAmount'))throw Error('请人工核对原表及金额');const kind=val('v45Kind'),id=val('v45ReviewId'),r=CatalogCore.latest(cat[kind],id,date());persist(V45.approve(cat,kind,id,r.rev,{reviewer:val('v45Reviewer'),evidence:val('v45Evidence'),effectiveFrom:val('v45Effective'),scope:val('v45ReviewScope'),amount:Number(val('v45ReviewAmount')),reviewedAt:new Date().toISOString()}));$('v45ReviewConfirm').checked=false;status('已新增本地核价版本（非角色授权审批）')}catch(e){status(e.message)}};
$('v45ManualConfirm').onclick=()=>{try{if(!manual.length)throw Error('没有临时项');const keys=val('v45Coverage').split(',').map(x=>x.trim());if(keys.length!==manual.length||keys.some(x=>!x)||new Set(keys).size!==keys.length||!$('v45ManualCheck').checked)throw Error('逐项填写唯一覆盖键并确认范围');manual=manual.map((x,i)=>({...x,coverageKey:keys[i],confirmed:true}));draw();status('临时项范围已本地确认，仍需本次报价复核')}catch(e){status(e.message)}};
$('v45Lock').onclick=()=>{try{snap=buildSnapshot();V45.save(localStorage,snap);$('v45Publish').disabled=false;list();status('已锁定本地测试快照：'+snap.currency+' '+snap.amount.toLocaleString()+' / '+snap.id)}catch(e){invalidate();status(e.message)}};
$('v45Publish').onclick=()=>{try{V45.publish(localStorage,snap,$('displayConfirmed').checked);location.href='/a3/display#model='+encodeURIComponent(snap.request.model)}catch(e){status(e.message)}};
$('v45ClearDisplay').onclick=()=>{localStorage.removeItem(V45.ACTIVE);localStorage.removeItem(QuoteBridge.ACTIVE);status('主机已撤销。请在 Pad 确认已显示「等待报价」。')};
$('v45Backup').onclick=()=>{try{dl(V45.backup(localStorage),'quote-unified-v45.json')}catch(e){status(e.message)}};
$('v45Restore').onchange=async()=>{try{const f=$('v45Restore').files[0];if(!f)return;if(f.size>20e6)throw Error('备份超限');if(!confirm('合并历史档案，冲突整批拒绝？'))return;status('合并完成：'+V45.restore({getItem:localStorage.getItem,setItem:localStorage.importHistory},JSON.parse(await f.text()))+' 条');list()}catch(e){status(e.message)}finally{$('v45Restore').value=''}};
$('v45History').onchange=()=>{try{const q=V45.read(localStorage).find(x=>x.id===val('v45History'));$('v45HistoryDetail').textContent=q?JSON.stringify(q,null,2):''}catch(e){status(e.message)}};
for(const id of ['customer','sales','quoteTime','scopeConfirmed','v45Reviewer','v45Evidence','v45Config','v45Currency','v45Rate','v45RateSource','v45RateAt','v45RateConfirm'])$(id).addEventListener('input',invalidate);
$('v45Publish').disabled=true;refreshReview();list();
})();
