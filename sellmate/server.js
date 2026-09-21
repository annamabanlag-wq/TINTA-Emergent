const http=require("http");
const fs=require("fs");
const path=require("path");
const crypto=require("crypto");

const PORT=process.env.PORT||3000;
const ROOT=__dirname;
const DATA_DIR=path.join(ROOT,"data");
const UPLOAD_DIR=path.join(ROOT,"uploads");
const DATA_FILE=path.join(DATA_DIR,"data.json");
fs.mkdirSync(DATA_DIR,{recursive:true});
fs.mkdirSync(UPLOAD_DIR,{recursive:true});

const defaultData={settings:{gcashName:"",gcashNumber:"",gcashQrUrl:"",proPrice:99,contactNote:""},payments:[],users:[]};
function loadData(){try{const d=JSON.parse(fs.readFileSync(DATA_FILE,"utf8"));return {settings:Object.assign({},defaultData.settings,d.settings||{}),payments:Array.isArray(d.payments)?d.payments:[],users:Array.isArray(d.users)?d.users:[]};}catch(e){fs.writeFileSync(DATA_FILE,JSON.stringify(defaultData,null,2));return structuredClone(defaultData)}}
let data=loadData();
function saveData(){fs.writeFileSync(DATA_FILE,JSON.stringify(data,null,2))}
const sessions=new Map();
function send(res,status,body,type="application/json",headers={}){res.writeHead(status,Object.assign({"Content-Type":type},headers));res.end(body)}
function json(res,status,obj,headers={}){send(res,status,JSON.stringify(obj),"application/json; charset=utf-8",headers)}
function readBody(req){return new Promise((resolve,reject)=>{let b="",size=0;req.on("data",c=>{size+=c.length;if(size>2_000_000){reject(new Error("payload too large"));req.destroy()}else b+=c});req.on("end",()=>{try{resolve(b?JSON.parse(b):{})}catch(e){reject(e)}});req.on("error",reject)})}
function isAdmin(req){const c=req.headers.cookie||"",m=c.match(/sellmate_admin=([^;]+)/);return !!(m&&sessions.has(m[1]))}
function clean(v,max=500){return String(v??"").trim().slice(0,max)}
function uid(p){return p+"_"+crypto.randomBytes(7).toString("hex")}
function saveReceipt(dataUrl,id){const m=String(dataUrl||"").match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/);if(!m||m[2].length>1_500_000)return null;const ext=m[1]==="image/png"?"png":m[1]==="image/webp"?"webp":"jpg";const name=id+"."+ext;fs.writeFileSync(path.join(UPLOAD_DIR,name),Buffer.from(m[2],"base64"));return "/uploads/"+name}
function file(res,name,type){try{send(res,200,fs.readFileSync(path.join(ROOT,name)),type)}catch(e){send(res,404,"Not found","text/plain")}}

const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,"http://localhost");
  if(req.method==="GET"&&url.pathname==="/"){return file(res,"index.html","text/html; charset=utf-8")}
  if(req.method==="GET"&&url.pathname==="/admin"){return file(res,"admin.html","text/html; charset=utf-8")}
  if(req.method==="GET"&&url.pathname==="/health"){return json(res,200,{ok:true,app:"SELLMATE PH",payments:data.payments.length})}
  if(req.method==="GET"&&url.pathname==="/api/public-config"){return json(res,200,{plans:[{id:"free",name:"Starter",price:0},{id:"pro",name:"Pro",price:Number(data.settings.proPrice)||99}],gcash:data.settings})}
  if(req.method==="GET"&&url.pathname.startsWith("/uploads/")){const n=path.basename(url.pathname),full=path.join(UPLOAD_DIR,n);if(!full.startsWith(UPLOAD_DIR)||!fs.existsSync(full))return send(res,404,"Not found","text/plain");const ext=path.extname(full).toLowerCase();return send(res,200,fs.readFileSync(full),ext===".png"?"image/png":ext===".webp"?"image/webp":"image/jpeg")}
  if(req.method==="POST"&&url.pathname==="/api/admin/login"){const b=await readBody(req);if(!process.env.SELLMATE_ADMIN_KEY||clean(b.key,200)!==process.env.SELLMATE_ADMIN_KEY)return json(res,401,{error:"Invalid admin key"});const token=crypto.randomBytes(32).toString("hex");sessions.set(token,Date.now());return json(res,200,{ok:true},{ "Set-Cookie":"sellmate_admin="+token+"; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=86400"})}
  if(req.method==="POST"&&url.pathname==="/api/admin/logout"){const c=req.headers.cookie||"",m=c.match(/sellmate_admin=([^;]+)/);if(m)sessions.delete(m[1]);return json(res,200,{ok:true},{"Set-Cookie":"sellmate_admin=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0"})}
  if(url.pathname.startsWith("/api/admin/")){
   if(!isAdmin(req))return json(res,401,{error:"Admin login required"});
   if(req.method==="GET"&&url.pathname==="/api/admin/dashboard"){const approved=data.payments.filter(x=>x.status==="approved");return json(res,200,{users:data.users.length,payments:data.payments.length,pending:data.payments.filter(x=>x.status==="pending").length,approved:approved.length,revenue:approved.reduce((s,x)=>s+Number(x.amount||0),0),settings:data.settings})}
   if(req.method==="GET"&&url.pathname==="/api/admin/payments"){return json(res,200,{payments:data.payments.slice().sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))})}
   if(req.method==="POST"&&url.pathname==="/api/admin/settings"){const b=await readBody(req);data.settings.gcashName=clean(b.gcashName,120);data.settings.gcashNumber=clean(b.gcashNumber,60);data.settings.gcashQrUrl=clean(b.gcashQrUrl,1000);data.settings.proPrice=Math.max(1,Math.round(Number(b.proPrice)||99));data.settings.contactNote=clean(b.contactNote,300);saveData();return json(res,200,{ok:true,settings:data.settings})}
   const m=url.pathname.match(/^\/api\/admin\/payments\/([^/]+)\/(approve|reject)$/);
   if(req.method==="POST"&&m){const p=data.payments.find(x=>x.id===m[1]);if(!p)return json(res,404,{error:"Payment not found"});p.status=m[2]==="approve"?"approved":"rejected";p.reviewedAt=new Date().toISOString();let u=data.users.find(x=>x.email===p.email);if(!u){u={id:uid("usr"),email:p.email,plan:"free",createdAt:new Date().toISOString()};data.users.push(u)}if(p.status==="approved"){u.plan="pro";u.proSince=new Date().toISOString();u.proPaymentId=p.id}saveData();return json(res,200,{ok:true,payment:p,user:u})}
  }
  if(req.method==="POST"&&url.pathname==="/api/payment-submit"){const b=await readBody(req),email=clean(b.email,200).toLowerCase(),reference=clean(b.reference,120);if(!email.includes("@"))return json(res,400,{error:"Valid email is required"});if(!reference)return json(res,400,{error:"GCash reference number is required"});const id=uid("pay"),amount=Math.max(1,Math.round(Number(b.amount)||data.settings.proPrice||99)),item={id,email,amount,reference,note:clean(b.note,300),receiptUrl:saveReceipt(b.receiptDataUrl,id),status:"pending",createdAt:new Date().toISOString()};data.payments.push(item);if(!data.users.some(x=>x.email===email))data.users.push({id:uid("usr"),email,plan:"free",createdAt:new Date().toISOString()});saveData();return json(res,200,{ok:true,paymentId:id,status:"pending",message:"Payment submitted. Admin review is required before Pro is activated."})}
  if(req.method==="GET"&&url.pathname==="/api/pro-status"){const email=clean(url.searchParams.get("email"),200).toLowerCase(),u=data.users.find(x=>x.email===email);return json(res,200,{email,plan:u?.plan||"free",proSince:u?.proSince||null})}
  send(res,404,"Not found","text/plain");
 }catch(e){console.error(e);json(res,500,{error:"Server error"})}
});
server.listen(PORT,"0.0.0.0",()=>console.log("SELLMATE PH listening on "+PORT));