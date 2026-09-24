const http=require("http"),fs=require("fs"),path=require("path"),url=require("url");
const PORT=Number(process.env.PORT||8080),ROOT=path.join(__dirname,"public");
const campaigns=[
{id:"c1",title:"Help Mara complete her leukemia treatment",category:"Medical",city:"Quezon City",beneficiary:"Mara C.",raised:185400,goal:300000,donors:127,verified:true,tone:"medical",copy:"Support Mara’s family with treatment, medicines, laboratory work and transport while she continues her care."},
{id:"c2",title:"A wheelchair and safer home for Jun",category:"Disability",city:"Cebu City",beneficiary:"Jun R.",raised:72400,goal:120000,donors:83,verified:true,tone:"disability",copy:"A community fundraiser for mobility equipment and basic home improvements that make everyday life safer."},
{id:"c3",title:"Keep the Santos family together after the fire",category:"Family",city:"Pasig",beneficiary:"Santos Family",raised:49850,goal:100000,donors:61,verified:true,tone:"family",copy:"Emergency support for temporary shelter, food, school needs and replacing essential belongings."},
{id:"c4",title:"Funeral assistance for a father of four",category:"Bereavement",city:"Iloilo City",beneficiary:"Dela Cruz Family",raised:91800,goal:130000,donors:104,verified:true,tone:"bereavement",copy:"Help the family cover funeral and burial costs while they navigate the loss of their main provider."},
{id:"c5",title:"Save Luna’s life and pay for surgery",category:"Pets",city:"Davao City",beneficiary:"Luna",raised:38100,goal:65000,donors:52,verified:true,tone:"pets",copy:"A rescue dog needs urgent surgery and aftercare. Every donation helps with veterinary treatment and recovery."},
{id:"c6",title:"School supplies and tuition for 3 siblings",category:"Education",city:"Antipolo",beneficiary:"Garcia Siblings",raised:62100,goal:90000,donors:75,verified:true,tone:"education",copy:"Help three siblings stay in school with tuition, uniforms, books and transportation support."}
];
function send(res,status,type,body){res.writeHead(status,{"content-type":type,"cache-control":"no-store"});res.end(body)}
function json(res,status,obj){send(res,status,"application/json",JSON.stringify(obj))}
function file(res,p){const map={"html":"text/html; charset=utf-8","js":"text/javascript; charset=utf-8","webmanifest":"application/manifest+json"};const f=path.join(ROOT,p),ext=path.extname(f).slice(1);if(!f.startsWith(ROOT)||!fs.existsSync(f))return send(res,404,"text/plain","Not found");send(res,200,map[ext]||"text/plain",fs.readFileSync(f))}
http.createServer((req,res)=>{
 const p=url.parse(req.url).pathname||"/";
 if(p==="/api/health")return json(res,200,{ok:true,service:"tulong-ph",mode:"demo",time:new Date().toISOString()});
 if(p==="/api/campaigns"&&req.method==="GET")return json(res,200,campaigns);
 if(p==="/api/campaigns"&&req.method==="POST"){let b="";req.on("data",d=>b+=d);req.on("end",()=>{try{const x=JSON.parse(b);if(!x.title||!x.goal)return json(res,400,{error:"title and goal are required"});const c={id:"c"+Date.now(),title:x.title,category:x.category||"Family",city:x.city||"Philippines",beneficiary:x.beneficiary||"Community member",raised:0,goal:Number(x.goal),donors:0,verified:false,tone:(x.category||"Family").toLowerCase(),copy:x.copy||""};campaigns.unshift(c);json(res,201,c)}catch(e){json(res,400,{error:"invalid json"})}});return}
 return file(res,"index.html");
}).listen(PORT,()=>console.log("TULONG PH on "+PORT));