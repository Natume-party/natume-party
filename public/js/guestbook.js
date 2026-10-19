// Natume guestbook: visitor content is always inserted as text, never HTML.
let adminKey = '';
const make = (tag, cls='', value='') => {
  const e=document.createElement(tag);
  if(cls)e.className=cls;
  e.textContent=value;
  return e;
};
async function api(path='',options={}) {
  const r=await fetch('/api/guestbook'+path,{cache:'no-store',...options});
  const body=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(body.error||'请求失败');
  return body;
}
const jsonHeaders={'Content-Type':'application/json'};
export async function renderGuestbook(host) {
  host.innerHTML=[
    '<section class="guestbook"><h2>✉️ 河边留言簿</h2>',
    '<p class="gb-intro">路过的小伙伴，留句话吧。我会时不时回来看看。</p>',
    '<form id="gb-form" class="gb-form"><label for="gb-name">怎么称呼你？</label>',
    '<input id="gb-name" maxlength="32" required placeholder="你的昵称" autocomplete="nickname">',
    '<label for="gb-msg">想说些什么？</label>',
    '<textarea id="gb-msg" maxlength="500" rows="3" required placeholder="给 Natume 留一句话…"></textarea>',
    '<small>留言审核后公开，请勿留下手机号、住址等私人资料。</small>',
    '<button type="submit">投进信箱 ↗</button><p id="gb-status" role="status"></p></form>',
    '<div class="gb-head"><h3>河边的来信</h3><button type="button" id="gb-refresh">刷新</button></div>',
    '<div id="gb-list" aria-live="polite">正在读信…</div>',
    '<details class="gb-owner"><summary>Natume 管理留言</summary>',
    '<form id="gb-login"><label for="gb-key">管理员密钥（不保存到浏览器）</label>',
    '<input id="gb-key" type="password" required autocomplete="off" placeholder="输入管理员密钥">',
    '<button type="submit">进入管理</button></form><p id="gb-owner-status" role="status"></p>',
    '<div id="gb-owner-list"></div><button type="button" id="gb-logout" hidden>退出管理</button>',
    '</details></section>'
  ].join('');
  const $=q=>host.querySelector(q),list=$('#gb-list'),status=$('#gb-status'),adminList=$('#gb-owner-list');
  const feedback=(node,message,success=false)=>{node.textContent=message;node.classList.toggle('ok',success);};
  async function refresh() {
    try {
      const {messages}=await api();
      list.replaceChildren();
      if(!messages.length){list.append(make('p','gb-empty','还没有公开留言。你可以留下第一封信。'));return;}
      for(const x of messages){
        const box=make('article','gb-entry'),head=make('div','gb-entry-head');
        head.append(make('strong','',x.author),make('time','',new Date(x.createdAt*1000).toLocaleDateString('zh-CN')));
        box.append(head,make('p','gb-text',x.message));
        if(x.reply) {
          const reply=make('div','gb-reply');
          reply.append(make('strong','','Natume 回复'),make('p','',x.reply));
          box.append(reply);
        }
        list.append(box);
      }
    }catch(e){feedback(list,e.message);}
  }
  $('#gb-form').addEventListener('submit',async e=>{
    e.preventDefault();
    const button=$('#gb-form button');
    button.disabled=true;feedback(status,'正在投递…');
    try{
      const result=await api('',{method:'POST',headers:jsonHeaders,body:JSON.stringify({author:$('#gb-name').value.trim(),message:$('#gb-msg').value.trim()})});
      feedback(status,result.notice,true);$('#gb-msg').value='';
    }catch(err){feedback(status,err.message);}
    finally{button.disabled=false;}
  });
  $('#gb-refresh').addEventListener('click',refresh);
  async function manage() {
    const data=await api('/admin',{headers:{Authorization:'Bearer '+adminKey}});
    $('#gb-login').hidden=true;$('#gb-logout').hidden=false;
    adminList.replaceChildren();
    if(!data.messages.length)adminList.append(make('p','','没有需要处理的留言。'));
    for(const x of data.messages) {
      const box=make('article','gb-admin-entry');
      box.append(make('strong','',x.author+(x.status==='pending'?' · 待审核':' · 已公开')),make('p','gb-text',x.message));
      const textarea=make('textarea');textarea.rows=2;textarea.maxLength=500;
      textarea.value=x.reply||'';textarea.placeholder='Natume 回复';
      const actions=make('div','gb-admin-actions');
      for(const [action,label] of [['reply','回复并公开'],['approve','只公开'],['hide','隐藏']]){
        const b=make('button','',label);b.type='button';
        b.addEventListener('click',async()=>{
          b.disabled=true;
          try{
            await api('/admin/'+x.id,{method:'POST',headers:{...jsonHeaders,Authorization:'Bearer '+adminKey},body:JSON.stringify({action,reply:textarea.value})});
            feedback($('#gb-owner-status'),'已保存',true);
            await manage();await refresh();
          }catch(e){feedback($('#gb-owner-status'),e.message);}
          finally{b.disabled=false;}
        });
        actions.append(b);
      }
      box.append(textarea,actions);adminList.append(box);
    }
  }
  $('#gb-login').addEventListener('submit',async e=>{
    e.preventDefault();adminKey=$('#gb-key').value.trim();$('#gb-key').value='';
    try{await manage();feedback($('#gb-owner-status'),'管理员身份已验证',true);}
    catch(err){adminKey='';feedback($('#gb-owner-status'),err.message);}
  });
  $('#gb-logout').addEventListener('click',()=>{
    adminKey='';$('#gb-login').hidden=false;$('#gb-logout').hidden=true;
    adminList.replaceChildren();feedback($('#gb-owner-status'),'已退出');
  });
  await refresh();
}