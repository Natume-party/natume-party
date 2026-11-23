const prefix = "/api/quote/";
const cookie = "__Host-luton-quote";
const seconds = 8 * 3600;
const enc = new TextEncoder();
const headers = {
  "Cache-Control": "no-store, private",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
};
const sessionCookie = (value, age) =>
  cookie+"="+value+"; Path=/; Max-Age="+age+"; Secure; HttpOnly; SameSite=Strict";
const result = (value, status=200, extra={}) => Response.json(value,{status,headers:{...headers,...extra}});
const fail = (status, message) => result({error:message},status);
const bytes = buffer => [...new Uint8Array(buffer)].map(n=>n.toString(16).padStart(2,"0")).join("");
async function signingKey(env) {
  const material=await crypto.subtle.digest("SHA-256",enc.encode(JSON.stringify([env.QUOTE_SESSION_KEY,env.QUOTE_ACCESS_KEY])));
  return crypto.subtle.importKey("raw",material,{name:"HMAC",hash:"SHA-256"},false,["sign","verify"]);
}
async function smallJSON(request) {
  if(!request.body || Number(request.headers.get("Content-Length")||0)>512)return null;
  const reader=request.body.getReader();
  const decoder=new TextDecoder();
  let size=0, text="";
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>512){await reader.cancel();return null}
      text+=decoder.decode(value,{stream:true});
    }
    return JSON.parse(text+decoder.decode());
  }catch{return null}
}
async function consume(db,scope,window,limit) {
  const {meta}=await db.prepare(
    "INSERT INTO quote_login_attempts(scope, window, used) VALUES(?1, ?2, 1) "+
    "ON CONFLICT(scope) DO UPDATE SET window=excluded.window, used=CASE WHEN window=excluded.window THEN used+1 ELSE 1 END "+
    "WHERE window<>excluded.window OR used<?3"
  ).bind(scope,window,limit).run();
  return meta.changes===1;
}
async function sessionValid(request,key,now) {
  const pattern=/(?:^|;\s*)__Host-luton-quote=(\d{1,12}\.[a-f0-9]{32})\.([a-f0-9]{64})(?:;|$)/;
  const match=pattern.exec(request.headers.get("Cookie")||"");
  if(!match)return false;
  const expiry=Number(match[1].split(".")[0]);
  if(expiry<=now||expiry>now+seconds)return false;
  const signature=Uint8Array.from(match[2].match(/../g),v=>parseInt(v,16));
  return crypto.subtle.verify("HMAC",key,signature,enc.encode("session:"+match[1]));
}
function quoteCatalog(raw) {
  const data=JSON.parse(raw);
  const models=data.models.map(m=>({id:m.id,name:m.name,configuration:typeof m.configuration==="string"?m.configuration:"",configurationStatus:typeof m.configurationStatus==="string"?m.configurationStatus:"",reference:Array.isArray(m.reference)?m.reference.filter(x=>Array.isArray(x)&&x.length===2&&x.every(v=>typeof v==='string')):[],amount:m.amount}));
  if(!models.length||models.some(m=>typeof m.id!=="string"||typeof m.name!=="string"||!Number.isSafeInteger(m.amount)||m.amount<=0))
    throw Error("Invalid quote catalog");
  const modelIds=new Set(models.map(m=>m.id));
  const rules=data.rules.filter(r=>modelIds.has(r.model)).map(r=>({
    id:r.id,model:r.model,name:r.name,note:typeof r.note==='string'?r.note:'',type:['increase','decrease','included','confirm'].includes(r.type)?r.type:undefined,amount:r.type!=="confirm"&&Number.isSafeInteger(r.amount)?r.amount:null,
    coverage:Array.isArray(r.coverage)?r.coverage.filter(v=>typeof v==="string"):[],
    maxQty:Number.isSafeInteger(r.maxQty)&&r.maxQty>0?r.maxQty:null,status:r.status==="已核定"?"已核定":"待核参考"
  }));
  return {date:data.date,models,rules};
}
export async function pricing(request,env) {
  const {origin,pathname}=new URL(request.url);
  const route=pathname.slice(prefix.length);
  if(request.method==="POST"&&(request.headers.get("Origin")!==origin || request.headers.get("Sec-Fetch-Site")==="cross-site"))
    return fail(403,"请从本站核价入口操作");
  if(route==="logout"&&request.method==="POST")
    return result({ok:true},200,{"Set-Cookie":sessionCookie("",0)});
  if(!env.QUOTE_DB || (env.QUOTE_ACCESS_KEY||"").length<24 || (env.QUOTE_SESSION_KEY||"").length<32)
    return fail(503,"核价中心尚未开启");
  const now=Math.floor(Date.now()/1000),key=await signingKey(env);
  if(route==="login"&&request.method==="POST"){
    if(!(request.headers.get("Content-Type")||"").startsWith("application/json"))return fail(415,"仅支持 JSON");
    const data=await smallJSON(request);
    if(typeof data?.password!=="string"||!data.password||data.password.length>128)return fail(400,"请输入核价密码");
    const ip=request.headers.get("CF-Connecting-IP");
    if(!ip)return fail(503,"登录服务暂不可用");
    const scope=bytes(await crypto.subtle.sign("HMAC",key,enc.encode("address:"+ip)));
    const window=Math.floor(now/600);
    if(!await consume(env.QUOTE_DB,"ip:"+scope,window,8)||!await consume(env.QUOTE_DB,"global",window,120))
      return result({error:"尝试太频繁，请稍后重试"},429,{"Retry-After":String(600-now%600)});
    const expected=await crypto.subtle.sign("HMAC",key,enc.encode("password:"+env.QUOTE_ACCESS_KEY));
    if(!await crypto.subtle.verify("HMAC",key,expected,enc.encode("password:"+data.password)))
      return fail(401,"核价密码不正确");
    const id=(now+seconds)+"."+crypto.randomUUID().replaceAll("-","");
    const signature=bytes(await crypto.subtle.sign("HMAC",key,enc.encode("session:"+id)));
    return result({ok:true},200,{"Set-Cookie":sessionCookie(id+"."+signature,seconds)});
  }
  if(route==="catalog"&&request.method==="GET"){
    if(!await sessionValid(request,key,now))return fail(401,"请先登录核价中心");
    const row=await env.QUOTE_DB.prepare("SELECT payload FROM quote_catalog WHERE id=1").first();
    return row?result(quoteCatalog(row.payload)):fail(503,"价格目录尚未加载");
  }
  return fail(404,"核价接口不存在");
}
export async function pricingAsset(request,env){
  const asset=await env.ASSETS.fetch(request);
  const out=new Headers(asset.headers);
  for(const [name,value] of Object.entries(headers))out.set(name,value);
  out.set("Content-Security-Policy","default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  out.set("X-Robots-Tag","noindex, nofollow");
  return new Response(asset.body,{status:asset.status,statusText:asset.statusText,headers:out});
}
