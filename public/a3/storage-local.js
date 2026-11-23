const localStorage=(()=>{
  const store=window.localStorage, key="luton-a3-frozen-web-preview-v1";
  const initial={ "quote-catalog-v42":JSON.stringify(a3Seed) };
  const read=()=>JSON.parse(store.getItem(key)||JSON.stringify(initial));
  const edit=update=>{const state=read();update(state);store.setItem(key,JSON.stringify(state))};
  const setItem=(name,value)=>edit(state=>{
    state[name]=String(value);
    if(name==="luton-quote-v45"&&state["quote-drafts-v1"]){
      const locked=new Set(JSON.parse(value).map(quote=>quote.id));
      state["quote-drafts-v1"]=JSON.stringify(JSON.parse(state["quote-drafts-v1"]).filter(draft=>!locked.has(draft.id)));
    }
  });
  return {getItem:name=>read()[name]??null,setItem,removeItem:name=>edit(state=>delete state[name]),importHistory:setItem,viewUrl:()=>new URL("/a3/display",location.href).href};
})();
window.addEventListener("pageshow",event=>{if(event.persisted)location.reload()});
document.addEventListener("DOMContentLoaded",()=>{
  const home=document.getElementById("entryHome");
  if(!home)return;
  const logout=document.createElement("button");
  logout.type="button";
  logout.textContent="退出登录";
  logout.style.marginTop="12px";
  logout.onclick=async()=>{
    const reply=await fetch("/a3/logout",{method:"POST"});
    if(reply.ok)location.replace("/a3/");
  };
  home.append(logout);
});
