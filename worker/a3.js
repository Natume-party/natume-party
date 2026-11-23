const cookieName = "__Host-luton-a3";
const lifetime = 4 * 3600;
const encoder = new TextEncoder();
const common = {
  "Cache-Control": "no-store, private",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
  "Content-Security-Policy": "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
};
const json = (status, value, extra = {}) => Response.json(value, {status, headers:{...common,...extra}});
const cookie = (value, age) => cookieName+"="+value+"; Max-Age="+age+"; Path=/; Secure; HttpOnly; SameSite=Strict";
const hex = bytes => Array.from(new Uint8Array(bytes), byte=>byte.toString(16).padStart(2,"0")).join("");
const sign = async (key, text) => hex(await crypto.subtle.sign("HMAC",key,encoder.encode(text)));
const verify = (key, text, tag) => crypto.subtle.verify("HMAC",key,Uint8Array.from(tag.match(/../g),n=>parseInt(n,16)),encoder.encode(text));
const windowSize = 1800;

async function withinLimit(db, scope, window, max) {
  const result = await db.prepare(
    "INSERT INTO quote_login_attempts(scope,window,used) VALUES(?1,?2,1) "+
    "ON CONFLICT(scope) DO UPDATE SET used=CASE WHEN window=excluded.window THEN used+1 ELSE 1 END,window=excluded.window "+
    "WHERE window<>excluded.window OR used<?3"
  ).bind(scope,window,max).run();
  return result.meta.changes === 1;
}

async function readPassword(request) {
  if (!request.body || Number(request.headers.get("Content-Length") || 0) > 256) return null;
  if (!request.headers.get("Content-Type")?.startsWith("application/json")) return null;
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0, text = "";
  try {
    for (;;) {
      const {done,value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 256) { await reader.cancel(); return null; }
      text += decoder.decode(value,{stream:true});
    }
    const password = JSON.parse(text+decoder.decode())?.password;
    return /^\d{6}$/.test(password) && typeof password === "string" ? password : null;
  } catch { return null; }
}

async function isSignedIn(request,key,now) {
  const raw = request.headers.get("Cookie") || "";
  const match = /(?:^|;\s*)__Host-luton-a3=(\d{1,12}\.[a-f0-9]{32})\.([a-f0-9]{64})(?:;|$)/.exec(raw);
  if (!match) return false;
  const expiry = Number(match[1].split(".")[0]);
  return expiry > now && expiry <= now+lifetime && await verify(key,"session:"+match[1],match[2]);
}

async function asset(env, url, path) {
  const resource = await env.ASSETS.fetch(new URL(path, url));
  const headers = new Headers(resource.headers);
  for (const [key,value] of Object.entries(common)) headers.set(key,value);
  return new Response(resource.body,{status:resource.status,headers});
}

export async function a3(request, env) {
  const url = new URL(request.url);
  if (url.protocol !== "https:" || url.hostname !== "natume.party") return json(404,{error:"入口不存在"});
  if (url.pathname === "/a3" && request.method === "GET")
    return new Response(null,{status:308,headers:{...common,Location:"/a3/"}});
  if (!env.A3_DB || !/^\d{6}$/.test(env.A3_PASSWORD || "") || (env.A3_SESSION_KEY || "").length < 32)
    return json(503,{error:"核算中心暂不可用"});
  try {
    const key = await crypto.subtle.importKey("raw",encoder.encode(env.A3_SESSION_KEY+"|"+env.A3_PASSWORD),{name:"HMAC",hash:"SHA-256"},false,["sign","verify"]);
    const now = Math.floor(Date.now()/1000);
    if (request.method === "POST") {
      if (request.headers.get("Origin") !== url.origin || request.headers.get("Sec-Fetch-Site") === "cross-site")
        return json(403,{error:"请从本站打开核算中心"});
      if (url.pathname === "/a3/logout") return json(200,{ok:true},{"Set-Cookie":cookie("",0)});
      if (url.pathname !== "/a3/login") return json(404,{error:"入口不存在"});
      const password = await readPassword(request);
      if (password === null) return json(401,{error:"密码不正确"});
      const ip = request.headers.get("CF-Connecting-IP");
      if (!ip) return json(503,{error:"登录服务暂不可用"});
      const window = Math.floor(now/windowSize);
      const scope = "ip:"+await sign(key,ip);
      if (!await withinLimit(env.A3_DB,scope,window,5) || !await withinLimit(env.A3_DB,"all",window,20))
        return json(429,{error:"尝试过多，请稍后再试"},{"Retry-After":String(windowSize-now%windowSize)});
      const tag = await sign(key,"password:"+env.A3_PASSWORD);
      if (!await verify(key,"password:"+password,tag)) return json(401,{error:"密码不正确"});
      const token = (now+lifetime)+"."+crypto.randomUUID().replaceAll("-","");
      return json(200,{ok:true},{"Set-Cookie":cookie(token+"."+await sign(key,"session:"+token),lifetime)});
    }
    if (request.method !== "GET" && request.method !== "HEAD") return json(405,{error:"不支持的请求"});
    const signedIn = await isSignedIn(request,key,now);
    if (url.pathname === "/a3/") return asset(env,url,signedIn?"/a3/catalog-workbench":"/a3/entry-login");
    if (!signedIn) return json(401,{error:"请先登录核算中心"});
    return asset(env,url,url.pathname);
  } catch { return json(503,{error:"核算中心暂不可用"}); }
}
