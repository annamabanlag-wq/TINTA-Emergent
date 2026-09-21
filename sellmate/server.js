const http=require("http"),fs=require("fs"),path=require("path");
const port=process.env.PORT||3000;
const html=fs.readFileSync(path.join(__dirname,"index.html"),"utf8");
const server=http.createServer((req,res)=>{
  if(req.url==="/"||req.url==="/index.html"){res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});return res.end(html);}
  if(req.url==="/health"){res.writeHead(200,{"Content-Type":"application/json"});return res.end(JSON.stringify({ok:true,app:"SELLMATE PH"}));}
  res.writeHead(404);res.end("Not found");
});
server.listen(port,"0.0.0.0",()=>console.log("SELLMATE PH listening on "+port));