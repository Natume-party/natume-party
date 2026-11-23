(() => {
'use strict';
const work=$('quoteWorkbench'), main=work.parentElement;
const lockSection=$('v45Lock').closest('section');
const meta=$('customer').closest('.fields');
work.before(meta);
meta.classList.add('sheet-meta');
const heading=work.querySelector('h2');
heading.textContent='设备与配置';
function fold(title, elements, anchor){
  const details=document.createElement('details'), summary=document.createElement('summary');
  summary.textContent=title; details.append(summary); anchor.before(details);
  for(const el of elements) details.append(el);
  return details;
}
const detail=$('detail');
const grid=document.createElement('table');
grid.setAttribute('aria-label','报价项目明细');
grid.innerHTML='<thead><tr><th>报价项目</th><th>数量</th><th>核定单价（元）</th><th>行金额（元）</th><th>操作</th></tr></thead><tbody></tbody>';
detail.after(grid);
const hint=document.createElement('p');hint.className='keys';hint.textContent='Enter 加入当前项目　·　Tab 移到下一格　·　Esc 取消编辑或撤回上一次项目变更';
heading.after(hint);
const quick=$('manualName').closest('.fields'), quickActions=$('manualAdd').parentElement;
const tools=fold('临时项目与配置替换',[quick,quickActions,$('repAdd').closest('section'),$('v45Coverage').closest('label'),$('v45ManualConfirm').parentElement],grid);
grid.after(tools);
const extras=document.createElement('section');main.append(extras);
const aux=fold('目录维护、核价与旧版档案',[],extras);
aux.append(...work.querySelectorAll(':scope > details.quote-data-tools'),$('refSearch').closest('section'),$('v45Approve').closest('section'),$('archiveExport').closest('section'));
aux.append(document.getElementById("export").parentElement);
extras.remove();
work.after(lockSection);
$('v45Config').rows=3;
lockSection.querySelector('h2').textContent='报价汇总与展示';
const fxFields=$('v45Currency').closest('.fields');
lockSection.querySelector('h2').after($('total'),fxFields);
const preview=document.createElement('output');preview.id='fxPreview';fxFields.after(preview);
const status=document.createElement('div');status.className='state';meta.after(status);
const summary=document.createElement('p');$('v45HistoryDetail').before(summary);
const raw=fold('查看完整记录',[$('v45HistoryDetail')],summary);summary.after(raw);
const auth=document.createElement('div');auth.className='fields';
for(const id of ['v45Reviewer','v45Evidence']){
  const original=$(id), label=document.createElement('label'), field=document.createElement('input');
  label.textContent=id==='v45Reviewer'?'本单复核人':'本单核价依据';field.id='sheet'+id;
  label.append(field);auth.append(label);
}
$('v45Lock').parentElement.before(auth,$('scopeConfirmed').closest('label'),$('displayConfirmed').closest('label'));

// Keep the quote sheet visible while history and catalog tools occupy their own views.
const historySection = $('v45History').closest('section');
const nav = document.createElement('nav');
nav.className = 'view-switch';
nav.setAttribute('aria-label','工作台视图');
meta.before(nav);
const quotePanels = [meta,status,work,lockSection];
const views = [
  ['本次报价', quotePanels],
  ['报价历史', [historySection]],
  ['目录与核价', [aux]]
];
for (const [title, panels] of views) {
  const tab = document.createElement('button');
  tab.textContent = title;
  tab.type = 'button';
  tab.onclick = () => {
    for (const [,group] of views) for (const panel of group) panel.hidden = !panels.includes(panel);
    for (const item of nav.children) item.setAttribute('aria-pressed',String(item===tab));
    if (panels.includes(aux)) aux.open=true;
  };
  nav.append(tab);
}
nav.firstElementChild.click();
const search = work.querySelector('.quote-lookup');
fold('查找项目',[search],hint).classList.add('sheet-search');
hint.textContent='Enter 加项 · Esc 回退';
heading.after(hint);
$('quoteEditModel').textContent='改价';
$('quoteEditRule').textContent='改价';
$('add').textContent='加入明细';
$('clear').textContent='清空项目';
work.append($('clear').parentElement);
const scopeNote=$('scope');
fold('供货范围与来源',[scopeNote],work.lastElementChild);
const lockTitle=lockSection.querySelector('h2');
lockTitle.textContent='报价汇总';
const confirmations=$('v45RateConfirm').closest('label');
fxFields.append(confirmations);
for (const el of [...lockSection.children]) {
  if(el.tagName==='P' && el.querySelector('small')) el.hidden=true;
}
const group=document.createElement('details');
const groupTitle=document.createElement('summary');
groupTitle.textContent='锁价与客户展示';
group.append(groupTitle);
const keep=new Set([lockTitle,$('total'),fxFields,preview]);
for(const child of [...lockSection.children])if(!keep.has(child))group.append(child);
lockSection.append(group);
function showRateFields(){
  const foreign=$('v45Currency').value!=='CNY';
  for(const id of ['v45Rate','v45RateAt','v45RateSource','v45RateConfirm'])
    $(id).closest('label').hidden=!foreign;
}
$('v45Currency').addEventListener('change',showRateFields);
showRateFields();

const sourceDraw=draw;
let lastRows=null,context='',undo=[],latestLocked=null;
function currentRows(){return JSON.stringify({items,manual})}
function format(value){return value==null?'缺价':value.toLocaleString('zh-CN')}
function updateState(){
  const active=localStorage.getItem(V45.ACTIVE);
  const published=active && V45.read(localStorage).find(q=>q.id===active);
  const describe=q=>q.customer+' · '+q.currency+' '+format(q.amount);
  status.textContent=published?'当前展示　'+describe(published):'';
}
function refreshPreview(){
  try{
    if(result?.subtotal==null)throw Error('请补齐项目金额');
    const fx=draftFx();
    preview.textContent='预计对外金额　'+fx.currency+' '+format(V45.fxAmount(result.subtotal,fx,draftTime()));
  }catch(e){preview.textContent='预计对外金额　—　'+e.message}
}
function row(label,qty,unit,amount,edit,remove,updateQty){
  const tr=grid.tBodies[0].insertRow();
  for(const v of [label,qty,format(unit),format(amount)])tr.insertCell().textContent=v;
  if(updateQty){
    const input=document.createElement('input');
    input.type='number';input.min='1';input.step='1';input.value=qty;
    input.setAttribute('aria-label',label+' 数量');input.style.width='5em';
    tr.cells[1].replaceChildren(input);
    input.onchange=()=>{
      const value=Number(input.value);
      if(value===qty)return;
      if(!Number.isSafeInteger(value)||value<1||!updateQty(value)){
        input.value=qty;
        $('quotePriceNotice').textContent='请输入规则允许的正整数数量。';
      }
    };
    input.onkeydown=e=>{
      if(e.key==='Enter'&&!e.isComposing){
        e.preventDefault();input.blur();$('qty').focus();
      }
    };
  }
  const actions=tr.insertCell();
  for(const [title,fn] of [['维护',edit],['移除',remove]])if(fn){
    const b=document.createElement('button');b.type='button';b.textContent=title;b.onclick=fn;actions.append(b);
  }
}
function render(){
  const key=date()+'|'+$('model').value, next=currentRows();
  if(key!==context){undo=[];context=key}
  else if(lastRows!==null && lastRows!==next)undo.push(lastRows);
  lastRows=next;
  grid.tBodies[0].replaceChildren();
  const m=CatalogCore.quoteRow(cat.models,$('model').value,date());
  if(m)row(m.label,1,m.amount,m.amount,()=>$('quoteEditModel').click());
  items.forEach((x,i)=>{
    const r=CatalogCore.quoteRow(cat.rules,x.id,date());
    row(r?.label||x.id,x.qty,r?.amount,r?.amount==null?null:r.amount*x.qty,()=>{
      $('rule').value=x.id;refreshQuoteCatalog();$('quoteEditRule').click();
        },()=>{items.splice(i,1);draw()},value=>{
      if(r?.maxQty!=null && value>r.maxQty)return false;
      x.qty=value;draw();return true;
    });
  });
  manual.forEach((x,i)=>row(x.label,x.qty||1,x.kind==='REPLACEMENT_DRAFT'?x.newAmount-x.oldAmount:x.amount,x.amount,null,()=>{manual.splice(i,1);draw()}));
  refreshPreview();updateState();
}
draw=function(){sourceDraw();render()};
$('add').onclick=()=>{
  const id=$('rule').value, qty=Number($('qty').value);
  const r=CatalogCore.quoteRow(cat.rules,id,date());
  if(!r || !Number.isSafeInteger(qty)||qty<=0 || (r.maxQty!=null && qty>r.maxQty) || items.some(x=>x.id===id)){
    $('quotePriceNotice').textContent='请检查数量上限及重复项目。';return;
  }
  items.push({id,qty});$('quotePriceNotice').textContent='';draw();
};
const actions={rule:'add',qty:'add',manualName:'manualAdd',manualAmt:'manualAdd',manualSource:'manualAdd',repName:'repAdd',repOld:'repAdd',repNew:'repAdd',repQty:'repAdd',repSource:'repAdd'};
let cell=null,initial='';
document.addEventListener('focusin',e=>{cell=e.target;initial=cell.value});
document.addEventListener('keydown',e=>{
  if(e.isComposing || e.keyCode===229 || e.ctrlKey || e.altKey || e.metaKey)return;
  const el=e.target;
  if(e.key==='Enter' && actions[el.id]){
    e.preventDefault();if(!e.repeat)$(actions[el.id]).click();initial=el.value;return;
  }
  if(e.key!=='Escape')return;
  if(quoteCatalogEdit){e.preventDefault();finishQuoteCatalogEdit('已取消本次价格编辑。');return}
  if(el===cell && el.matches('textarea,input:not([type=checkbox]):not([type=file])') && el.value!==initial){
    e.preventDefault();el.value=initial;el.dispatchEvent(new Event('input',{bubbles:true}));return;
  }
  if(undo.length){
    e.preventDefault();const old=undo.pop();({items,manual}=JSON.parse(old));lastRows=old;draw();
    $('quotePriceNotice').textContent='已回退上一次项目变更。';
  }
});
document.addEventListener('input',e=>{
  if(['v45Currency','v45Rate','v45RateAt','v45RateSource','v45RateConfirm','date','quoteTime'].includes(e.target.id))refreshPreview();
  if(e.target.id==='customer')updateState();
  if(['sheetv45Reviewer','sheetv45Evidence'].includes(e.target.id))$('v45Publish').disabled=true;
});
const history=V45.read(localStorage);latestLocked=history.at(-1)||null;
for(const id of ['v45Lock','v45Publish','v45ClearDisplay']){
  const prev=$(id).onclick;
  $(id).onclick=()=>{
    prev();
    if(id==='v45Lock' && !$('v45Publish').disabled)latestLocked=V45.read(localStorage).at(-1);
    updateState();
  };
}
$('v45History').addEventListener('change',()=>{
  const q=V45.read(localStorage).find(x=>x.id===$('v45History').value);
  summary.textContent=q?[q.customer,q.request?.model||q.input?.model,q.currency+' '+format(q.amount),q.quotedAt].join('　·　'):'';
});
render();
const center=document.createElement('section');
center.id='center';
center.innerHTML='<header><h2>历史核算</h2><button type="button" id="continueQuote">进入本次核算</button></header><div id="quoteLedger"></div>';
meta.before(center);
const centerButton=document.createElement('button');
centerButton.textContent='历史核算';nav.prepend(centerButton);
function showCenter(){
  saveDraft.hidden=true;saveStatus.hidden=true;
  for(const [,panels] of views)for(const panel of panels)panel.hidden=true;
  center.hidden=false;
  markA3Tab(historyTab);
  for(const b of nav.children)b.setAttribute('aria-pressed',String(b===centerButton));
  reloadLedger();
}
centerButton.onclick=showCenter;
const hiddenDetailTab=[...nav.children].find(b=>b.textContent==='报价历史');
hiddenDetailTab.classList.add('internal-detail-route');
for(const tab of [...nav.children].slice(1))tab.addEventListener('click',()=>{center.hidden=true;saveDraft.hidden=meta.hidden;saveStatus.hidden=meta.hidden});
function view(name){[...nav.children].find(b=>b.textContent===name).click()}
$('continueQuote').onclick=()=>view('本次报价');
const searchBar=document.createElement('div');searchBar.className='top-search';
searchBar.innerHTML='<label for="globalLookup">工作台搜索</label><input id="globalLookup" type="search" placeholder="搜索客户、设备、业务员或功能" autocomplete="off"><kbd>Ctrl K</kbd><div id="findResults" hidden></div>';
main.prepend(searchBar);
const place=main.querySelector('h1');place.textContent='展会报价';
place.hidden=true;place.nextElementSibling.hidden=true;
nav.setAttribute('aria-label','左侧功能栏');
const quickPush=document.createElement('button');quickPush.type='button';quickPush.className='primary';quickPush.id='quickPush';quickPush.textContent='本机展示';
const missing=document.createElement('p');missing.id='missingFields';missing.setAttribute('role','status');
groupTitle.after(missing,quickPush);
const needDetails=document.createElement('details');
const needTitle=document.createElement('summary');needDetails.append(needTitle,missing);
group.before(needDetails,quickPush);
function blockers(){
  const needs=[];
  for(const [id,label] of [['customer','客户名称'],['sales','业务员'],['sheetv45Reviewer','本单复核人'],['sheetv45Evidence','本单核价依据'],['v45Config','对外完整配置']])
    if(!$(id).value.trim())needs.push(label);
  if(!$('scopeConfirmed').checked)needs.push('价格及供货范围确认');
  if(!$('displayConfirmed').checked)needs.push('展示配置确认');
  if(!['LB1500','LB4000'].includes($('model').value))needs.push('受支持的展示型号');
  if($('v45Currency').value!=='CNY'){
    for(const [id,label] of [['v45Rate','外币汇率'],['v45RateAt','汇率时间'],['v45RateSource','汇率来源']])
      if(!$(id).value.trim())needs.push(label);
    if(!$('v45RateConfirm').checked)needs.push('人工汇率确认');
  }
  if(!result || result.subtotal==null)needs.push('可用报价金额');
  else{
    try{V45.fxAmount(result.subtotal,draftFx(),draftTime())}catch(e){if(!needs.some(n=>n.includes('汇率')))needs.push(e.message)}
    for(const issue of result.issues)if(!issue.startsWith('人工项待供货范围复核: ') || manual.some(m=>!m.confirmed))needs.push(issue);
    if(!needs.length){
      try{buildSnapshot()}catch(e){needs.push(e.message)}
    }
  }
  return needs;
}
function refreshReadiness(){
  saveDraft.disabled=!$('v45Publish').disabled;
  const errors=blockers();
  missing.textContent=errors.length?'待补齐：'+errors.join('、'):'核算资料齐全，可推送至 Pad';
  needDetails.hidden=!errors.length;
  needTitle.textContent='待补资料（'+errors.length+'）';
  quickPush.disabled=!!errors.length;
}
quickPush.onclick=()=>{
  refreshReadiness();if(quickPush.disabled)return;
  if($('v45Publish').disabled)$('v45Lock').click();
  if(!$('v45Publish').disabled)$('v45Publish').click();
  group.open=true;
};
const draftKey='quote-drafts-v1';
const fieldIds=('date quoteTime customer sales model rule qty manualName manualAmt manualSource repName repOld repNew repQty repSource repConfirm v45Coverage v45ManualCheck v45Config v45Currency v45Rate v45RateSource v45RateAt v45RateConfirm sheetv45Reviewer sheetv45Evidence scopeConfirmed displayConfirmed').split(' ');
const activeDraft=$('quoteWorkbench').dataset;
function drafts(){return JSON.parse(localStorage.getItem(draftKey)||'[]')}
function captureFields(){
  return Object.fromEntries(fieldIds.map(id=>[id,$(id).type==='checkbox'?$(id).checked:$(id).value]));
}
function draftContent(){return JSON.stringify([captureFields(),items,manual])}
let savedContent=draftContent(),cleanStart=savedContent;
function catalogBasis(){return JSON.stringify(result && [result.model,result.detail,result.subtotal])}
function mayLeave(){return draftContent()===savedContent || !$('v45Publish').disabled || confirm('当前报价有未保存的更改，放弃这些更改？')}
const saveDraft=document.createElement('button');saveDraft.id='saveDraft';saveDraft.textContent='保存草稿';
meta.after(saveDraft);
const saveStatus=document.createElement('span');saveStatus.id='draftNotice';saveStatus.setAttribute('role','status');saveDraft.after(saveStatus);
const newDraft=document.createElement('button');newDraft.textContent='新建报价';$('continueQuote').before(newDraft);
$('continueQuote').hidden=true;
newDraft.onclick=()=>{if(mayLeave())beginSheet()};
function writeDraft(){
  try{
    if(quoteCatalogEdit)throw Error('请先保存或取消项目价格编辑');
    const id=activeDraft.draftId||crypto.randomUUID();
    const data={id,parent:activeDraft.parent||null,createdAt,updatedAt:new Date().toISOString(),fields:captureFields(),items,manual,
      needs:blockers(),basis:catalogBasis(),amount:preview.textContent.replace('预计对外金额','').trim()};
    const others=drafts().filter(d=>d.id!==id);
    localStorage.setItem(draftKey,JSON.stringify([...others,data]));
    activeDraft.draftId=id;savedContent=draftContent();saveStatus.textContent='草稿已保存到主机';
  }catch(error){saveStatus.textContent=error.message}
}
saveDraft.onclick=writeDraft;
function resumeDraft(id){
  const d=drafts().find(x=>x.id===id);
  if(!d || !mayLeave())return;
  applySaved(d);
}
function applySaved(d){
  const id=d.id;
  if(d.parent)activeDraft.parent=d.parent;else delete activeDraft.parent;
  view('本次报价');activeDraft.draftId=id;createdAt=d.createdAt;
  $('date').value=d.fields.date;items=[];manual=[];draw();
  $('model').value=d.fields.model;items=structuredClone(d.items);manual=structuredClone(d.manual);draw();
  for(const field of fieldIds){
    if(field==='model'||field==='date')continue;
    const el=$(field);
    if(el.type==='checkbox')el.checked=Boolean(d.fields[field]);else el.value=d.fields[field]??'';
  }
  showRateFields();
  const changed=catalogBasis()!==d.basis;
  if(changed){$('scopeConfirmed').checked=false;$('displayConfirmed').checked=false}
  undo=[];lastRows=currentRows();savedContent=draftContent();
  refreshQuoteCatalog();refreshPreview();updateState();refreshReadiness();
  saveStatus.textContent=changed?'目录已变化，请重新核对本次金额和配置':'已打开保存的草稿';
}
const lockDraft=$('v45Lock').onclick;
$('v45Lock').onclick=()=>{
  lockDraft();
  if(!$('v45Publish').disabled){delete activeDraft.draftId;delete activeDraft.parent;savedContent=draftContent();saveStatus.textContent='已转入锁价历史'}
};
function draftRow(d){
  return {id:d.id,sales:d.fields.sales||'—',customer:d.fields.customer||'未填客户',model:d.fields.model,
    time:Date.parse(d.fields.date+'T'+d.fields.quoteTime)||Date.parse(d.updatedAt),state:d.sheetLines?'逐行草稿':d.needs.length?'草稿 · 待补齐':'草稿 · 待复核',
    money:d.amount,missing:d.needs.join('、')||'打开草稿复核当前价格',isDraft:true};
}

function rows(){
  const active=localStorage.getItem(V45.ACTIVE);
  const entries=V45.read(localStorage).map(q=>({
    id:q.id,sales:q.sales,customer:q.customer,model:q.request?.model||q.input?.model||'—',
    time:new Date(q.quotedAt).getTime(),state:q.id===active?'已发布':'已锁价',money:q.currency+' '+format(q.amount)
  }));
  entries.push(...drafts().map(draftRow));
  if(!activeDraft.draftId && $('v45Publish').disabled && draftContent()!==cleanStart){
    entries.push({id:'@draft',missing:blockers().join('、')||'齐全',sales:$('sales').value.trim()||'—',customer:$('customer').value.trim()||'当前草稿',model:$('model').value,
      time:new Date(date()+'T'+$('quoteTime').value).getTime()||0,state:blockers().length?'待完善':'可推送',money:preview.textContent.replace('预计对外金额','').trim()});
  }
  return entries.sort((a,b)=>b.time-a.time);
}
function openRecord(r){
  if(r.isDraft){const record=drafts().find(d=>d.id===r.id);if(record?.sheetLines){beginSheet(record);return}resumeDraft(r.id);return}
  if(r.id==='@draft'){view('本次报价');return}
  view('报价历史');
  $('v45History').value=r.id;$('v45History').dispatchEvent(new Event('change'));
  raw.open=false;
}
const storedPush=document.createElement('button');
storedPush.type='button';storedPush.textContent='推送此报价到 Pad';storedPush.className='primary';storedPush.disabled=true;
const storedConfirm=document.createElement('label');
const reviewed=document.createElement('input');reviewed.type='checkbox';
storedConfirm.append(reviewed,'已核对此单客户及展示配置');
const sent=document.createElement('p');sent.setAttribute('role','status');
summary.after(storedConfirm,storedPush,sent);
function selectedQuote(){return V45.read(localStorage).find(q=>q.id===$('v45History').value)}
function allowStoredPush(){
  const q=selectedQuote();
  storedPush.disabled=!reviewed.checked || q?.schema!=='luton-v45/1' || !['LB1500','LB4000'].includes(q.request.model);
}
reviewed.onchange=allowStoredPush;
$('v45History').addEventListener('change',()=>{reviewed.checked=false;storedPush.disabled=true;sent.textContent=''});
storedPush.onclick=()=>{
  const q=selectedQuote();
  try{V45.publish(localStorage,q,reviewed.checked);sent.textContent='主机已发布 '+q.customer+' · '+q.currency+' '+format(q.amount);updateState()}
  catch(error){sent.textContent=error.message}
};
document.addEventListener('input',e=>{
  if(['customer','sales','v45Currency','v45Rate','v45RateAt','v45RateSource','sheetv45Reviewer','sheetv45Evidence','quoteTime'].includes(e.target.id))
    $('displayConfirmed').checked=false;
},true);
const ledger=new Tabulator($('quoteLedger'),{layout:'fitColumns',responsiveLayout:'collapse',placeholder:'暂无报价',
  columnDefaults:{formatter:'plaintext',minWidth:80},initialSort:[{column:'time',dir:'desc'}],columns:[
    {title:'报价时间',field:'time',minWidth:160,sorter:'number',formatter:c=>new Date(c.getValue()).toLocaleString('sv-SE')},
    {title:'客户 / 项目',field:'customer',minWidth:130},{title:'设备',field:'model'},{title:'业务员',field:'sales'},
    {title:'报价金额',field:'money',minWidth:130},{title:'状态',field:'state'},{title:'待补资料',field:'missing',minWidth:155,variableHeight:true,formatter:'textarea'},
    {title:'',headerSort:false,width:68,formatter:()=>{const b=document.createElement('button');b.textContent='打开';return b},cellClick:(e,c)=>openRecord(c.getRow().getData())}
  ]});
ledger.on('rowDblClick',(e,r)=>openRecord(r.getData()));
ledger.on('rowTap',(e,r)=>openRecord(r.getData()));
let built=false;ledger.on('tableBuilt',()=>{built=true;reloadLedger()});
function reloadLedger(){if(built){ledger.replaceData(rows());ledger.redraw(true)}}
const finder=$('globalLookup'), choices=$('findResults');let matches=[],index=0;
function searchCommands(){
  const commands=[newTab,historyTab,infoTab].map(tab=>({label:tab.textContent,run:()=>tab.click()}));
  for(const r of rows())commands.push({label:[r.customer,r.model,r.sales,r.state,r.money].join(' · '),keywords:[r.id,new Date(r.time).toLocaleDateString()],run:()=>openRecord(r)});
  matches=LUTON.commandPalette.rankCommands(commands,finder.value,9);index=0;choices.replaceChildren();
  for(const [i,item] of matches.entries()){
    const b=document.createElement('button');b.type='button';b.textContent=item.label;
    b.onclick=()=>{choices.hidden=true;finder.value='';item.run()};choices.append(b);
  }
  if(!matches.length)choices.textContent='没有匹配结果';
  choices.hidden=false;highlight();
}
function highlight(){[...choices.children].forEach((el,i)=>el.classList.toggle('chosen',i===index))}
finder.oninput=searchCommands;finder.onfocus=searchCommands;
document.addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();finder.focus();finder.select();searchCommands()}
  if(e.target!==finder||e.isComposing)return;
  if(e.key==='Escape'){e.stopImmediatePropagation();choices.hidden=true;finder.blur()}
  if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();index=LUTON.commandPalette.moveIndex(index,e.key==='ArrowDown'?1:-1,matches.length);highlight()}
  if(e.key==='Enter' && !choices.hidden){e.preventDefault();choices.children[index]?.click()}
},true);
document.addEventListener('focusin',e=>{if(!searchBar.contains(e.target))choices.hidden=true});
document.addEventListener('click',e=>{if(!searchBar.contains(e.target))choices.hidden=true;refreshReadiness()});
document.addEventListener('input',refreshReadiness);
const home=document.createElement('section');
home.id='entryHome';
home.innerHTML='<h2>A3 核算中心</h2><p class="a3-trial">试用目录为合成数据。草稿与历史保存于当前浏览器。</p><div class="entry-tiles"><button id="startCalculation" type="button">新建核算</button><button id="pastCalculations" type="button">历史核算</button></div>';
main.prepend(home);
function toggleHome(on){
  for(const el of main.children){
    if(el===home || el.tagName==='SCRIPT')continue;
    if(on){el.dataset.entryHidden=String(el.hidden);el.hidden=true}
    else if(el.dataset.entryHidden!==undefined){el.hidden=el.dataset.entryHidden==='true';delete el.dataset.entryHidden}
  }
  home.hidden=!on;document.body.classList.toggle('at-entry',on);
}
const back=document.createElement('button');back.textContent='返回中心';nav.prepend(back);
back.onclick=()=>toggleHome(true);
$('startCalculation').onclick=()=>beginSheet();
$('pastCalculations').onclick=()=>{toggleHome(false);showCenter()};
const defaultFields=captureFields();
const simple=document.createElement('section');
simple.id='simpleQuote';simple.hidden=true;main.append(simple);
simple.innerHTML='<header><button id="simpleBack">返回历史</button><h1>新建核算</h1></header><div class="simple-meta"><label>客户<input id="simpleCustomer"></label><label>业务员<input id="simpleSales"></label><label>报价日期<input type="date" id="simpleDate"></label></div><section class="simple-base"><h2>设备基础价</h2><div class="simple-base-fields"><label>设备型号<select id="simpleModel"></select></label><div><span>基础价（人民币）</span><strong id="simpleBaseAmount">—</strong><small id="simpleBaseStatus"></small><small id="simpleBaseConfig"></small></div></div></section><h2 class="simple-adjustments-title">设备增减项</h2><div class="simple-catalog-tools"><label>选用设备增减项<select id="simpleRuleChoice"></select></label><button type="button" id="simpleUseRule">加入增减项</button></div><p id="simpleRuleNotice" role="status"></p><div class="simple-scroll"><table><thead><tr><th>行</th><th>增减项目</th><th>加 / 减</th><th>数量</th><th>单价（元）</th><th>金额（元）</th><th>行操作</th></tr></thead><tbody id="simpleBody"></tbody></table></div><div class="simple-bottom"><button id="simpleAdd">＋ 添加临时项</button><div class="simple-summary"><span id="simpleDelta"></span><strong id="simpleTotal"></strong></div></div><details id="sheetFinalize" class="sheet-final"><summary>核价确认、对外配置与币种</summary><div class="fields"><label>复核人<input id="simpleReviewer"></label><label>核价依据<input id="simpleEvidence"></label><label>报价币种<select id="simpleCurrency"><option>CNY</option><option>USD</option><option>EUR</option><option>RUB</option><option>VND</option><option>JPY</option><option>GBP</option><option>AED</option><option>SAR</option><option>THB</option><option>IDR</option></select></label></div><div id="simpleFx" class="fields" hidden><label>1 CNY = 外币<input id="simpleRate"></label><label>汇率来源<input id="simpleRateSource"></label><label>汇率时间<input id="simpleRateTime" type="datetime-local"></label><label><input id="simpleRateConfirm" type="checkbox">已人工核对汇率</label></div><label>对外配置<textarea id="simpleConfig" rows="3" placeholder="每行填写 项目=规格"></textarea></label><label><input id="simpleConfirm" type="checkbox">已核对单价及供货范围</label><label><input id="simpleDisplayConfirm" type="checkbox">已核对客户展示内容</label></details><p id="simpleForeignPreview"></p><p id="simpleBlockers" role="status"></p><footer><button id="simpleSave">保存草稿</button><button id="simpleAdvanced">本机展示</button><button id="simpleRevoke">撤销展示</button><button class="primary" id="simplePrint">输出报价单</button></footer><p id="simpleNote" role="status"></p><datalist id="simpleOptions"></datalist>';
aux.insertAdjacentHTML('afterbegin','<section id="a3CategoryTools"><h2>价格目录</h2><p id="a3CatalogSummary" role="status"></p><div class="simple-catalog-tools"><label>类型<select id="categoryKind"><option value="model">设备基础价</option><option value="rule">设备增减项</option><option value="reference">配套参考</option></select></label><label>项目<select id="categoryItem"></select></label><label>分类<select id="categoryFamily"></select></label><button type="button" id="categorySave">保存分类</button></div><p id="categoryNotice" role="status"></p><button type="button" id="simpleImportLocal">导入本机目录</button></section>');
aux.querySelector('summary').textContent='信息维护';
$('file').closest('label').hidden=true;
$('load44').hidden=true;
const sidebar=document.createElement('nav');
sidebar.id='a3Sidebar';
sidebar.setAttribute('aria-label','左侧功能栏');
sidebar.innerHTML='<strong>A3 核算中心</strong>';
const newTab=$('startCalculation'), historyTab=$('pastCalculations');
newTab.textContent='新建';
historyTab.textContent='历史';
const infoTab=document.createElement('button');
infoTab.type='button';
infoTab.id='informationMaintenance';
infoTab.textContent='信息维护';
sidebar.append(newTab,historyTab,infoTab);
main.before(sidebar);
document.body.classList.add('a3-shell');
function markA3Tab(active){
  for(const tab of [newTab,historyTab,infoTab]){
    if(tab===active)tab.setAttribute('aria-current','page');else tab.removeAttribute('aria-current');
  }
}
function leaveSimple(){
  if(simple.hidden)return true;
  if(sheetFormState()!==sheetStart&&!confirm('本次修改尚未保存，确定离开？'))return false;
  simple.hidden=true;return true;
}
newTab.onclick=()=>{if(leaveSimple())beginSheet()};
function goHistory(){
  if(!leaveSimple())return;
  toggleHome(false);
  home.hidden=true;simple.hidden=true;
  showCenter();
}
historyTab.onclick=goHistory;
infoTab.onclick=()=>{
  if(!leaveSimple())return;
  toggleHome(false);
  home.hidden=true;simple.hidden=true;
  view('目录与核价');
  renderCategoryItems();
  markA3Tab(infoTab);
};
const sheetBody=$('simpleBody'), picks=new Map(), ruleChoices=new Map();
const families=[
  ['soil','稳定土'],['concrete','混凝土'],['asphalt','沥青'],['common','通用'],['unknown','待分类']
];
const familyNames=new Map(families);
const categoriesKey='quote-category-overrides-v1';
let categories=JSON.parse(localStorage.getItem(categoriesKey)||'{}');
function automaticFamily(entry){
  const source=[entry.id,entry.label,entry.group].filter(Boolean).join(' ');
  const matched=[
    ['soil', /稳定土|\bWCB/i],
    ['concrete', /混凝土|\bY?HZS/i],
    ['asphalt', /沥青|热再生|\bLB\d|\bLZS/i],
    ['common', /通用/],
  ].filter(([,term])=>term.test(source));
  return matched.length===1?matched[0][0]:'unknown';
}
function referenceKey(entry){
  return JSON.stringify([entry.group||'',entry.label,entry.sourcePage||'']);
}
function categoryKey(kind,entry){
  return kind+':'+(kind==='reference'?referenceKey(entry):entry.id);
}
function familyOf(kind,entry){
  if(!entry)return 'unknown';
  const override=categories[categoryKey(kind,entry)];
  if(familyNames.has(override))return override;
  const imported=cat.a3Families?.[categoryKey(kind,entry)];
  if(familyNames.has(imported))return imported;
  if(kind==='rule'){
    const model=cat.models.find(item=>item.id===entry.model);
    return model?familyOf('model',model):automaticFamily(entry);
  }
  return automaticFamily(entry);
}
const classificationRows=new Map();
function renderCategoryItems(){
  const kind=$('categoryKind').value, selector=$('categoryItem'), previous=selector.value;
  const source=kind==='reference'?(cat.references||[]):cat[kind==='model'?'models':'rules'];
  const count=items=>new Set(items.map(item=>item.id)).size;
  const demo=cat.models.every(item=>item.label.startsWith('演示'));
  $('a3CatalogSummary').textContent=(demo?'合成目录':'本机目录')+' · '+count(cat.models)+' 个设备型号 · '+count(cat.rules)+' 条增减规则 · '+(cat.references||[]).length+' 条配套参考';
  classificationRows.clear();
  for(const item of source){
    const key=categoryKey(kind,item);
    if(!classificationRows.has(key)||(classificationRows.get(key).rev||0)<(item.rev||0))classificationRows.set(key,item);
  }
  selector.replaceChildren(new Option('请选择项目',''));
  for(const [key,item] of classificationRows){
    const title=kind==='rule'?item.model+' · '+item.label:item.label;
    selector.add(new Option(familyNames.get(familyOf(kind,item))+' · '+title,key));
  }
  selector.value=classificationRows.has(previous)?previous:'';
  updateCategorySelection();
}
function updateCategorySelection(){
  const key=$('categoryItem').value;
  $('categoryFamily').value=categories[key]||'';
  $('categorySave').disabled=!classificationRows.has(key);
}
$('categoryFamily').replaceChildren(new Option('自动识别',''),...families.map(([id,label])=>new Option(label,id)));
$('categoryKind').onchange=renderCategoryItems;
$('categoryItem').onchange=updateCategorySelection;
$('categorySave').onclick=()=>{
  const key=$('categoryItem').value, value=$('categoryFamily').value;
  if(!classificationRows.has(key))return;
  const updated={...categories};
  if(value)updated[key]=value;else delete updated[key];
  try{
    localStorage.setItem(categoriesKey,JSON.stringify(updated));
    categories=updated;
    refreshCatalogRows();
    $('categoryNotice').textContent='分类已保存在当前浏览器';
  }catch(e){$('categoryNotice').textContent=e.message}
};
const importField=$('file');
const importCatalogFromFile=importField.onchange;
importField.onchange=async ()=>{
  await importCatalogFromFile();
  refreshCatalogRows();
  $('categoryNotice').textContent=$('status').textContent;
};
$('simpleImportLocal').onclick=()=>importField.click();
let sheetId,lines=[],sheetStart='',openedAt,sheetParent;
const emptyLine=()=>({name:'',sign:1,qty:'1',unit:'',model:null});
function baseRows(){return lines.filter(r=>r.kind==='model')}
function adjustmentRows(){return lines.filter(r=>r.kind!=='model')}
function selectedModel(){
  const rows=baseRows();
  return rows.length===1?rows[0].id:'';
}
function sheetPrice(kind,id){
  return CatalogCore.quoteRow(cat[kind],id,$('simpleDate').value);
}
function updateBasePanel(){
  const selector=$('simpleModel'), rows=baseRows();
  const selected=selectedModel();
  selector.replaceChildren(new Option('请选择设备型号',''));
  const models=Array.from(new Set(cat.models.map(r=>r.id)),id=>sheetPrice('models',id)).filter(Boolean);
  for(const [id,label] of families){
    const group=document.createElement('optgroup');
    group.label=label;
    for(const model of models.filter(item=>familyOf('model',item)===id)){
      group.append(new Option(model.label.includes(model.id)?model.label:model.id+' · '+model.label,model.id));
    }
    if(group.children.length)selector.append(group);
  }
  if(selected && ![...selector.options].some(option=>option.value===selected))
    selector.add(new Option(selected+'（当前目录无可用型号）',selected));
  selector.value=selected;
  const row=rows.length===1?rows[0]:null;
  const amount=row?rowAmount(row):null;
  $('simpleBaseAmount').textContent=amount==null?'—':format(amount)+' 元';
  const note=rows.length>1?'此草稿有多个设备，请重新选择本单设备':row?.priceNote||'';
  const pending=row&&CatalogCore.latest(cat.models,row.id,$('simpleDate').value);
  const pendingText=pending?.status==='STAGED' && pending.rev>row.rev &&
    pending.amount!==null?'待核调整 '+format(pending.amount)+' 元':'';
  $('simpleBaseStatus').textContent=[note,pendingText].filter(Boolean).join(' · ');
  const model=sheetPrice('models',selected);
  const config=model?.standardConfiguration||model?.scope;
  $('simpleBaseConfig').textContent=config?'基础配置 '+config:'';
}
$('simpleModel').onchange=()=>{
  const id=$('simpleModel').value;
  const selected=sheetPrice('models',id);
  lines=adjustmentRows();
  if(selected)lines.unshift({...emptyLine(),kind:'model',id,model:id,name:selected.label});
  if(!adjustmentRows().length)lines.push(emptyLine());
  $('simpleConfirm').checked=false;$('simpleDisplayConfirm').checked=false;
  refreshCatalogRows();
};
function populatePicks(){
  picks.clear();
  ruleChoices.clear();
  const model=selectedModel(), date=$('simpleDate').value;
  const selected=sheetPrice('models',model), family=familyOf('model',selected);
  const selector=$('simpleRuleChoice');
  const previous=selector.value;
  selector.replaceChildren(new Option(model?'选择本型号增减项':'请先选择设备',''));
  const options={increase:[],decrease:[],included:[],pending:[]};
  for(const id of new Set(cat.rules.map(x=>x.id))){
    const r=sheetPrice('rules',id);
    if(!r||r.model!==model)continue;
    const kind=r.amount===null?'pending':r.amount>0?'increase':r.amount<0?'decrease':'included';
    const priceNote=r.amount===null?'缺价':r.status==='STAGED'?'待核':'';
    const value={name:r.label,sign:r.amount<0?-1:1,qty:'1',unit:r.amount===null?'':String(Math.abs(r.amount)),
      model:null,id:r.id,rev:r.rev,kind:'rule',priceNote};
    ruleChoices.set(r.id,value);
    const label=[r.label,r.amount===null?'金额待核':format(r.amount)+' 元',familyNames.get(familyOf('rule',r)),priceNote==='待核'?'待核':''].filter(Boolean);
    options[kind].push(new Option(label.join(' · '),r.id));
  }
  for(const [kind,label] of [['increase','增配'],['decrease','减配'],['included','不另计价'],['pending','金额待核']]){
    if(!options[kind].length)continue;
    const group=document.createElement('optgroup');
    group.label=label;
    group.append(...options[kind]);
    selector.append(group);
  }
  selector.value=ruleChoices.has(previous)?previous:'';
  $('simpleUseRule').disabled=!selector.value;
  $('simpleRuleNotice').textContent=model&&!ruleChoices.size?'该型号暂无适用的目录增减项':'';

  function offer(source,name,unit){
    if(!name||(unit!==null&&!Number.isSafeInteger(unit)))return;
    const key=[source,name,unit===null?'需核价':format(unit)+' 元'].join(' · ');
    picks.set(key,{name,sign:unit<0?-1:1,qty:'1',unit:unit===null?'':String(Math.abs(unit)),model:null});
  }
  for(const ref of cat.references||[]){
    const category=familyOf('reference',ref);
    if(selected&&(category==='common'||(category!=='unknown'&&category===family))){
      offer(familyNames.get(category)+'配套参考',ref.label,null);
    }
  }
  for(const q of V45.read(localStorage)){
    if(!model||(q.request?.model||q.input?.model)!==model)continue;
    if(q.worksheet){
      for(const line of q.worksheet.lines)if(line.kind==='manual')offer('历史临时项',line.name,line.unit);
      continue;
    }
    for(const r of q.request?.manual||[])offer('历史临时项',r.label,r.kind==='REPLACEMENT_DRAFT'?r.newAmount-r.oldAmount:r.amount);
    for(const r of q.input?.lines||[])offer('历史临时项',r.id,r.amount);
  }
  for(const draft of drafts()){
    if(!model||draft.fields?.model!==model)continue;
    for(const row of draft.sheetLines||[])if(!row.kind&&row.unit!=='')offer('草稿临时项',row.name,row.sign*Number(row.unit));
  }
  $('simpleOptions').replaceChildren(...Array.from(picks.keys(),key=>new Option(key)));
  renderCategoryItems();
}
$('simpleRuleChoice').onchange=()=>{$('simpleUseRule').disabled=!$('simpleRuleChoice').value};
$('simpleUseRule').onclick=()=>{
  const choice=ruleChoices.get($('simpleRuleChoice').value);
  if(!choice)return;
  if(adjustmentRows().some(row=>row.kind==='rule'&&row.id===choice.id)){
    $('simpleRuleNotice').textContent='该目录项目已经加入，请直接修改数量';
    return;
  }
  const empty=adjustmentRows().find(row=>!row.kind&&!used(row));
  if(empty)Object.assign(empty,choice);else lines.push({...choice});
  $('simpleConfirm').checked=false;$('simpleDisplayConfirm').checked=false;
  $('simpleRuleNotice').textContent='';
  renderLines();sheetReadiness();
};
function fingerprint(){return JSON.stringify([lines,$('simpleCustomer').value,$('simpleSales').value,$('simpleDate').value])}
function beginSheet(record){
  if(home.hidden)toggleHome(true);home.hidden=true;simple.hidden=false;markA3Tab(newTab);
  $('simpleCustomer').value=record?.fields.customer||'';$('simpleSales').value=record?.fields.sales||'';
  $('simpleDate').value=record?.fields.date||new Date().toLocaleDateString('sv-SE');
  sheetId=record?.id||crypto.randomUUID();openedAt=record?.createdAt||new Date(Math.floor(Date.now()/1000)*1000).toISOString();sheetParent=record?.parent;
  lines=structuredClone(record?.sheetLines||[emptyLine()]);
  for(const row of lines){
    if(!row.kind && row.model){
      row.kind='model';row.id=row.model;
    }
  }
  if(!adjustmentRows().length)lines.push(emptyLine());
  simple.querySelector('h1').textContent=record?'修改核算':'新建核算';$('simpleNote').textContent='';
  recallSheetFields(record);refreshCatalogRows();sheetStart=sheetFormState();$('simpleModel').focus();
}
function used(r){return r.name.trim()!==''||r.unit!==''||r.qty!=='1'}
function rowAmount(r){
  const n=Number(r.qty),u=Number(r.unit);
  if(!r.name.trim()||!/^\d+$/.test(r.qty)||n<1||!/^\d+$/.test(r.unit)||!Number.isSafeInteger(n)||!Number.isSafeInteger(u)||!Number.isSafeInteger(n*u))return null;
  return n*u*r.sign;
}
function totals(){
  const rows=baseRows();
  const base=rows.length===1?rowAmount(rows[0]):null;
  const missing=[];
  if(base==null)missing.push('请选择一台基础价完整的设备');
  let delta=0, invalidAdjustment=false;
  adjustmentRows().forEach((r,i)=>{
    const mismatch=r.kind==='rule'&&sheetPrice('rules',r.id)?.model!==selectedModel();
    const amount=mismatch?null:rowAmount(r);
    if(used(r)&&amount==null){
      missing.push('第 '+(i+1)+' 行'+(mismatch?'不适用于所选设备':'项目、数量或单价需补齐'));
      invalidAdjustment=true;
    }
    if(amount!=null)delta+=amount;
    sheetBody.rows[i].cells[5].textContent=mismatch?'不适用':amount==null?'—':format(amount);
  });
  const total=base+delta;
  if(!Number.isSafeInteger(delta)||!Number.isSafeInteger(total)){
    missing.push('金额超出范围');invalidAdjustment=true;
  }
  $('simpleDelta').textContent='增减净额　'+(invalidAdjustment?'—':(delta>0?'+':'')+format(delta)+' 元');
  $('simpleTotal').textContent='合计（人民币）　'+(missing.length?'—':format(total)+' 元');
  return {total,missing};
}
function renderLines(){
  updateBasePanel();
  sheetBody.replaceChildren();
  const adjustments=adjustmentRows();
  adjustments.forEach((r,i)=>{
    const tr=sheetBody.insertRow();tr.insertCell().textContent=i+1;
    for(const key of ['name','sign','qty','unit']){
      const el=document.createElement(key==='sign'?'select':'input');
      if(key==='name'){el.setAttribute('list','simpleOptions');el.placeholder='输入临时项，或复用参考和历史临时项'}
      if(key==='sign'){el.append(new Option('＋ 加项','1'),new Option('－ 减项','-1'))}
      if(key==='qty'||key==='unit')el.inputMode='numeric';
      if(key==='sign')el.disabled=Boolean(r.kind);
      if(key==='name'||key==='unit')el.readOnly=Boolean(r.kind);
      el.value=r[key];el.setAttribute('aria-label','第'+(i+1)+'行'+({name:'项目',sign:'方向',qty:'数量',unit:'单价'}[key]));
      let before;
      el.onfocus=()=>{before=structuredClone(r)};
      el.oninput=()=>{
        if(key==='name'&&picks.has(el.value)){
          Object.assign(r,{kind:null,id:null,rev:null,model:null,priceNote:''},picks.get(el.value));el.value=r.name;
          for(const [j,k] of ['sign','qty','unit'].entries())tr.cells[j+2].firstChild.value=r[k];
        }else r[key]=key==='sign'?Number(el.value):el.value;
        if(['name','sign','unit'].includes(key)){
          tr.cells[2].firstChild.disabled=Boolean(r.kind);
          tr.cells[4].firstChild.readOnly=Boolean(r.kind);
        }
        $('simpleConfirm').checked=false;$('simpleDisplayConfirm').checked=false;
        totals();
      };
      el.onkeydown=e=>{
        if(e.isComposing||e.keyCode===229)return;
        if(e.key==='Escape'){e.preventDefault();e.stopPropagation();if(before)Object.assign(r,before);renderLines();sheetBody.rows[i].cells[1].firstChild.focus()}
        if(e.key==='Enter'){
          e.preventDefault();if(e.repeat)return;
          if(!adjustments[i+1])lines.push(emptyLine());renderLines();sheetBody.rows[i+1].cells[1].firstChild.focus();
        }
      };
      const cell=tr.insertCell();cell.append(el);
      if(key==='name'){
        const note=document.createElement('small');note.className='row-price-note';note.textContent=r.priceNote||'';cell.append(note);
        el.addEventListener('input',()=>{note.textContent=r.priceNote||''});
      }
    }
    tr.insertCell();
    const actions=document.createElement('div');
    actions.className='line-actions';
    const add=document.createElement('button');
    add.type='button';
    add.textContent='＋';
    add.setAttribute('aria-label','在第 '+(i+1)+' 行下方添加一行');
    add.onclick=()=>{
      lines.splice(lines.indexOf(r)+1,0,emptyLine());
      renderLines();
      sheetBody.rows[i+1].cells[1].firstChild.focus();
    };
    const remove=document.createElement('button');
    remove.type='button';
    remove.textContent='－';
    remove.setAttribute('aria-label','删除第 '+(i+1)+' 行');
    remove.onclick=()=>{
      lines.splice(lines.indexOf(r),1);
      if(!adjustmentRows().length)lines.push(emptyLine());
      $('simpleConfirm').checked=false;
      $('simpleDisplayConfirm').checked=false;
      renderLines();
      sheetReadiness();
    };
    actions.append(add,remove);
    tr.insertCell().append(actions);
  });totals();
}
$('simpleDate').onchange=populatePicks;
$('simpleAdd').onclick=()=>{lines.push(emptyLine());renderLines();sheetBody.rows[adjustmentRows().length-1].cells[1].firstChild.focus()};
function saveSheet(){
  const {total,missing}=totals(),values=lines.filter(used);
  const readiness=sheetReadiness();
  const m=values.find(r=>r.model);
  const fields={...defaultFields,model:m?.model||'',date:$('simpleDate').value,quoteTime:new Date().toTimeString().slice(0,8),customer:$('simpleCustomer').value.trim(),sales:$('simpleSales').value.trim()};
  const data={id:sheetId,parent:sheetParent,createdAt:openedAt,updatedAt:new Date().toISOString(),fields,items:[],manual:[],sheetLines:structuredClone(values),sheetFields:Object.fromEntries(sheetFieldIds.map(id=>{
    const e=$(id);return [id,e.type==='checkbox'?e.checked:e.value];
  })),needs:readiness.padMissing,amount:missing.length?'—':'CNY '+format(total)};
  localStorage.setItem(draftKey,JSON.stringify([...drafts().filter(d=>d.id!==sheetId),data]));sheetStart=sheetFormState();return data;
}
$('simpleSave').onclick=()=>{try{saveSheet();$('simpleNote').textContent='已保存，可从历史核算继续填写。'}catch(e){$('simpleNote').textContent=e.message}};
$('simpleBack').onclick=goHistory;
function sheetInput(){
  return [...baseRows(),...adjustmentRows()].filter(used).map(r=>({kind:r.kind||'manual',...(r.kind&&r.kind!=='manual'?{id:r.id,rev:r.rev}:{}),
    name:r.name,qty:r.qty,sign:r.sign,unit:r.unit}));
}
const sheetControls=$('sheetFinalize');
function sheetData(){
  const values=sheetInput();
  const model=values.find(r=>r.kind==='model')?.id||'';
  const date=$('simpleDate').value;
  const currency=$('simpleCurrency').value;
  const fx=currency==='CNY'?{currency,rate:'1',source:null,at:null}:{
    currency,rate:$('simpleRate').value.trim(),source:$('simpleRateSource').value.trim(),
    at:$('simpleRateTime').value?new Date($('simpleRateTime').value).toISOString():null,
    confirmed:$('simpleRateConfirm').checked
  };
  const config=$('simpleConfig').value.split('\n').filter(x=>x.trim()).map(x=>{
    const split=x.indexOf('=');return split<1?[]:[x.slice(0,split).trim(),x.slice(split+1).trim()];
  });
  return {values,model,date,meta:{id:sheetId,parentQuoteId:sheetParent,customer:$('simpleCustomer').value.trim(),
    sales:$('simpleSales').value.trim(),createdAt:openedAt,quotedAt:new Date().toISOString(),
    reviewer:$('simpleReviewer').value.trim(),evidence:$('simpleEvidence').value.trim(),
    scopeConfirmed:$('simpleConfirm').checked,config,fx},displayConfirmed:$('simpleDisplayConfirm').checked,configText:$('simpleConfig').value};
}
function sheetProblems(data){
  const missing=[];
  for(const [value,label] of [[data.meta.customer,'客户'],[data.meta.sales,'业务员'],[data.meta.reviewer,'复核人'],[data.meta.evidence,'核价依据'],[data.configText,'对外配置']])
    if(!value)missing.push(label);
  if(!data.meta.scopeConfirmed)missing.push('确认价格与供货范围');
  try{
    const p=WorksheetCore.prepare(cat,data.values,data.date,data.meta.evidence,data.meta.scopeConfirmed);
    const calculated=CatalogCore.calculate(cat,{...p.request,manual:[]});
    if(!calculated.finalizable)missing.push(...calculated.issues);
    if(!missing.length)buildSheetSnapshot(data);
  }catch(e){missing.push(e.message)}
  return missing;
}
function buildSheetSnapshot(data){
  return V45.snapshot(cat,{date:data.date},{...data.meta,worksheet:{input:data.values}});
}
function sheetFingerprint(data){
  return JSON.stringify([data.values,data.date,data.meta.customer,data.meta.sales,data.meta.reviewer,data.meta.evidence,
    data.meta.scopeConfirmed,data.meta.config,data.meta.fx]);
}
let frozenSheet=null, frozenFingerprint='';
function sheetReadiness(){
  const data=sheetData(), missing=sheetProblems(data);
  const padMissing=[...missing];
  if(!['LB1500','LB4000'].includes(data.model))padMissing.push('支持 Pad 展示的型号');
  if(!data.displayConfirmed)padMissing.push('确认客户展示配置');
  $('simpleBlockers').textContent=missing.length?'定稿待补：'+missing.join('、'):padMissing.length?'Pad 待补：'+padMissing.join('、'):'可定稿、可推送 Pad';
  const preview=$('simpleForeignPreview');
  preview.textContent=!missing.length && data.meta.fx.currency!=='CNY' ?
    '对外报价 '+data.meta.fx.currency+' '+format(buildSheetSnapshot(data).amount) : '';
  return {data,missing,padMissing};
}
function runOutput(publish){
  try{
    const {data,missing,padMissing}=sheetReadiness();
    const errors=publish?padMissing:missing;
    if(errors.length){sheetControls.open=true;throw Error(errors.join('、'))}
    const fingerprint=sheetFingerprint(data);
    if(frozenFingerprint!==fingerprint){
      const saved=buildSheetSnapshot(data);
      V45.save(localStorage,saved);
      frozenSheet=V45.read(localStorage).find(q=>q.id===saved.id);
      frozenFingerprint=fingerprint;
      sheetParent=frozenSheet.id;sheetId=crypto.randomUUID();sheetStart=sheetFormState();
    }
    if(publish){
      V45.publish(localStorage,frozenSheet,data.displayConfirmed);
      $('simpleNote').textContent='主机已发布 '+frozenSheet.currency+' '+format(frozenSheet.amount);
    }else{
      $('simpleNote').textContent='已锁价，可从历史重打';
      window.open('/a3/quote-print#id='+encodeURIComponent(frozenSheet.id),'_blank','noopener');
    }
    refreshSheetHistory();
  }catch(e){$('simpleNote').textContent=e.message}
}
function refreshSheetHistory(){
  const previous=$('v45History').value;
  $('v45History').replaceChildren(new Option('选择历史报价',''),...V45.read(localStorage).map(q=>new Option(q.customer+' · '+q.currency+' '+format(q.amount),q.id)));
  $('v45History').value=previous;
}
$('simplePrint').onclick=()=>runOutput(false);
$('simpleAdvanced').onclick=()=>runOutput(true);
$('simpleRevoke').onclick=()=>{
  try{localStorage.removeItem(V45.ACTIVE);$('simpleNote').textContent='主机已撤销展示'}catch(e){$('simpleNote').textContent=e.message}
};
const sheetFieldIds=['simpleReviewer','simpleEvidence','simpleConfig','simpleConfirm','simpleDisplayConfirm','simpleCurrency','simpleRate','simpleRateSource','simpleRateTime','simpleRateConfirm'];
function sheetFormState(){return JSON.stringify([fingerprint(),sheetFieldIds.map(id=>$(id).type==='checkbox'?$(id).checked:$(id).value)])}
function recallSheetFields(record){
  const saved=record?.sheetFields||{};
  for(const id of sheetFieldIds){
    const el=$(id);
    if(el.type==='checkbox')el.checked=saved[id]===true;else el.value=saved[id]??(id==='simpleCurrency'?'CNY':'');
  }
  frozenSheet=null;frozenFingerprint='';
  sheetControls.open=false;
  flipRateFields();
}
function flipRateFields(){$('simpleFx').hidden=$('simpleCurrency').value==='CNY'}
simple.addEventListener('change',e=>{
  if(e.target.id==='simpleCurrency')flipRateFields();
  sheetReadiness();
});
simple.addEventListener('input',e=>{
  if(['simpleConfig','simpleCustomer','simpleSales','simpleCurrency','simpleRate','simpleRateTime','simpleRateSource'].includes(e.target.id))$('simpleDisplayConfirm').checked=false;
  if(['simpleConfig','simpleReviewer','simpleEvidence'].includes(e.target.id))$('simpleConfirm').checked=false;
  sheetReadiness();
});
function refreshCatalogRows(){
  populatePicks();
  let changed=false;
  for(const r of lines){
    if(r.kind!=='model'&&r.kind!=='rule')continue;
    const catalog=cat[r.kind==='model'?'models':'rules'], date=$('simpleDate').value;
    const approved=CatalogCore.reviewed(catalog,r.id,date);
    const visible=approved||CatalogCore.latest(catalog,r.id,date);
    const old=r.rev,unit=r.unit,note=r.priceNote;
    r.rev=visible?.rev??null;r.unit=visible?.amount==null?'':String(Math.abs(visible.amount));r.sign=visible?.amount<0?-1:1;
    r.priceNote=!visible||visible.amount==null?'缺价':approved?'':'待核';
    changed ||= old!==r.rev || unit!==r.unit || note!==r.priceNote;
  }
  if(changed){
    $('simpleConfirm').checked=false;$('simpleDisplayConfirm').checked=false;
    $('simpleNote').textContent='报价日期或目录版本已变，已重新带入单价，请复核';
  }
  renderLines();sheetReadiness();
}
$('simpleDate').onchange=()=>{
  $('simpleConfirm').checked=false;$('simpleDisplayConfirm').checked=false;
  refreshCatalogRows();
};
function addReprint(){
const reprint=document.createElement('button');reprint.textContent='重打已锁价报价单';editHistory.after(reprint);
reprint.onclick=()=>{const q=selectedQuote();if(q?.worksheet)window.open('/a3/quote-print#id='+encodeURIComponent(q.id),'_blank','noopener')};
$('v45History').addEventListener('change',()=>{reprint.hidden=!selectedQuote()?.worksheet});
reprint.hidden=true;
}


function editLocked(q){
  if(!mayLeave())return;
  const model=q.request?.model||q.input?.model;
  const now=new Date();
  const fields={...defaultFields,date:now.toLocaleDateString('sv-SE'),quoteTime:now.toTimeString().slice(0,8),model,
    customer:q.customer,sales:q.sales,sheetv45Reviewer:q.reviewer||'',sheetv45Evidence:q.evidence||'',
    v45Config:(q.config||[]).map(pair=>pair.join('=')).join('\n'),v45Currency:q.currency,
    v45Rate:q.fx?.rate||String(q.rate||1),v45RateSource:q.fx?.source||q.rateSource||'',v45RateAt:'',
    scopeConfirmed:false,displayConfirmed:false,v45RateConfirm:false};
  const rateAt=q.fx?.at||q.rateAt;
  if(rateAt){const x=new Date(rateAt);fields.v45RateAt=new Date(+x-x.getTimezoneOffset()*60000).toISOString().slice(0,16)}
  if(!cat.models.some(m=>m.id===model)){alert('当前目录缺少历史型号 '+model+'，请先维护型号后再修订。');return}
  const legacy=(q.input?.lines||[]).map(l=>({label:l.id,source:'历史报价 '+q.id,amount:l.amount*(l.qty||1),confirmed:false}));
  const data={id:crypto.randomUUID(),parent:q.id,createdAt:new Date(Math.floor(+now/1000)*1000).toISOString(),fields,
    items:q.request?.items||[],manual:q.request?.manual||legacy};
  applySaved(data);
  activeDraft.parent=q.id;
  saveStatus.textContent='正在修订历史报价 · 原单 '+q.id+'。请核对当前价格与配置。';
  savedContent='';group.open=true;
}
const editHistory=document.createElement('button');editHistory.id='editHistory';editHistory.textContent='修改这笔核算';
summary.after(editHistory);editHistory.onclick=()=>{
  const q=selectedQuote();
  if(!q)return;
  if(!q.worksheet){editLocked(q);return}
  const sheetLines=q.worksheet.lines.map(r=>({kind:r.kind==='manual'?null:r.kind,id:r.id,rev:r.rev,name:r.name,qty:String(r.qty),
    unit:String(Math.abs(r.unit)),sign:r.unit<0?-1:1,model:r.kind==='model'?r.id:null}));
  beginSheet({parent:q.id,fields:{customer:q.customer,sales:q.sales},sheetLines,
    sheetFields:{simpleConfig:q.config.map(pair=>pair.join('=')).join('\n'),simpleCurrency:q.currency}});
};

addReprint();
refreshReadiness();showCenter();
if(sessionStorage.getItem('open-new-484')){sessionStorage.removeItem('open-new-484');home.hidden=true;view('本次报价')}else beginSheet();


})();
