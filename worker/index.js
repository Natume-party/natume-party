// Natume guestbook API. All visitor posts require moderation; the admin key
// is not present in source or browser storage. Only its SHA-256 digest is in D1.
const respond = (x, s=200) => Response.json(x,{status:s,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
const err = (s,m) => respond({error:m},s);
async function sha(s) {
  const a=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)));
  return [...a].map(n=>n.toString(16).padStart(2,"0")).join("");
}
const clean=(s,max)=>typeof s==="string"?s.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g,"").trim().slice(0,max+1):"";
async function parse(r) {
  if(Number(r.headers.get("content-length")||0)>3000) return null;
  const raw=await r.text();
  if(raw.length>3000) return null;
  try { return JSON.parse(raw); }catch{return null;}
}
async function adminHash(db) {
  const r=await db.prepare("SELECT value FROM guestbook_config WHERE key='admin_token_sha256'").first();
  return r?.value||"";
}
async function admin(r,db) {
  const v=r.headers.get("Authorization")||"";
  if(!v.startsWith("Bearer ")||v.length>140||v.length<39) return false;
  const actual=await sha(v.slice(7)),expected=await adminHash(db);
  if(actual.length!==expected.length) return false;
  let diff=0; for(let i=0;i<actual.length;i++)diff|=actual.charCodeAt(i)^expected.charCodeAt(i);
  return diff===0;
}
async function api(r,env) {
  const db=env.GUESTBOOK_DB;
  if(!db)return err(503,"留言服务尚未配置");
  const path=new URL(r.url).pathname,m=r.method;
  if(m!=="GET"){
    const origin=r.headers.get("Origin");
    if((origin&&origin!==new URL(r.url).origin)||r.headers.get("Sec-Fetch-Site")==="cross-site")return err(403,"无效来源");
    if(!(r.headers.get("Content-Type")||"").startsWith("application/json"))return err(415,"仅支持 JSON");
  }
  if(path==="/api/guestbook"&&m==="GET"){
    const x=await db.prepare("SELECT id,author,message,reply,created_at,replied_at FROM guestbook_messages WHERE status='approved' ORDER BY id DESC LIMIT 30").all();
    return respond({messages:(x.results||[]).map(a=>({id:a.id,author:a.author,message:a.message,reply:a.reply,createdAt:a.created_at,repliedAt:a.replied_at}))});
  }
  if(path==="/api/guestbook"&&m==="POST"){
    const d=await parse(r),author=clean(d?.author,32),message=clean(d?.message,500);
    if(!author||author.length>32||!message||message.length>500)return err(400,"昵称或留言长度无效");
    const ip=r.headers.get("CF-Connecting-IP"),hash=await adminHash(db);
    if(!hash||!ip)return err(503,"留言服务暂时不可用");
    const now=Math.floor(Date.now()/1000),day=new Date().toISOString().slice(0,10);
    const bucket=(await sha(hash+"|"+day+"|"+ip)).slice(0,36);
    const rate=await db.prepare("INSERT INTO guestbook_rate(bucket,day,count,last_at) VALUES(?,?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=guestbook_rate.count+1,last_at=excluded.last_at WHERE guestbook_rate.count<3 AND guestbook_rate.last_at<=excluded.last_at-60").bind(bucket,day,now).run();
    if(!rate.meta?.changes)return err(429,"提交太频繁，稍后再试");
    await db.prepare("INSERT INTO guestbook_messages(author,message,status,created_at) VALUES(?,?,'pending',?)").bind(author,message,now).run();
    return respond({ok:true,notice:"留言已收到，待 Natume 审核后公开。"},201);
  }
  if(path==="/api/guestbook/admin"&&m==="GET"){
    if(!await admin(r,db))return err(401,"管理员凭据无效");
    const x=await db.prepare("SELECT id,author,message,status,reply,created_at FROM guestbook_messages WHERE status!='hidden' ORDER BY (status='pending') DESC,id DESC LIMIT 100").all();
    return respond({messages:x.results||[]});
  }
  const route=path.match(/^\/api\/guestbook\/admin\/(\d+)$/);
  if(route&&m==="POST"){
    if(!await admin(r,db))return err(401,"管理员凭据无效");
    const d=await parse(r),id=Number(route[1]),now=Math.floor(Date.now()/1000);
    if(!Number.isSafeInteger(id)||id<1)return err(400,"无效记录");
    let q;
    if(d?.action==="reply"){
      const reply=clean(d.reply,500);
      if(!reply||reply.length>500)return err(400,"回复长度无效");
      q=db.prepare("UPDATE guestbook_messages SET status='approved',reply=?,replied_at=?,approved_at=COALESCE(approved_at,?) WHERE id=? AND status!='hidden'").bind(reply,now,now,id);
    }else if(d?.action==="approve"){
      q=db.prepare("UPDATE guestbook_messages SET status='approved',approved_at=COALESCE(approved_at,?) WHERE id=? AND status!='hidden'").bind(now,id);
    }else if(d?.action==="hide"){
      q=db.prepare("UPDATE guestbook_messages SET status='hidden' WHERE id=?").bind(id);
    }else return err(400,"操作无效");
    const result=await q.run();
    return result.meta?.changes?respond({ok:true}):err(404,"留言不存在");
  }
  return err(404,"接口不存在");
}
export default {
  async fetch(r,env) {
    if(!new URL(r.url).pathname.startsWith("/api/"))return env.ASSETS.fetch(r);
    try{return await api(r,env)}catch(e){console.error("Guestbook API failure",e?.name||"unknown");return err(503,"留言服务暂时不可用");}
  }
};