'use strict';
const http=require('node:http'),crypto=require('node:crypto');
// OpenClaw ACP rejects per-session MCP injection. This short-lived loopback
// endpoint exposes only the app's existing, request-scoped tool allowlist. The
// native runtime calls it through its own terminal tool and approval policy.
async function runtimeTools(tools,signal,onResult=()=>{}){
 const secret=crypto.randomBytes(32).toString('hex');let calls=0,active=false;
 const server=http.createServer(async(req,res)=>{
  const reply=(code,body)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
  if(req.method!=='POST'||req.url!=='/'+secret||req.headers.origin||!req.headers['content-type']?.startsWith('application/json')||signal.aborted){reply(403,{error:'Unavailable'});return;}
  if(active||++calls>40){reply(429,{error:'Tool request limit reached'});return;}
  active=true;
  try{
   let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>180000)throw Error('Tool request too large.');}
   const {tool,args={}}=JSON.parse(body);signal.throwIfAborted();
   if(!tools.tools.some(t=>t.name===tool))throw Error('Unknown avatar tool.');
   const result=await tools.execute(tool,args,signal);onResult({tool,ok:result?.ok!==false,summary:JSON.stringify(result).slice(0,4000),...(result?.path?{path:result.path}:{})});reply(200,result);
  }catch(e){reply(400,{ok:false,error:signal.aborted?'Request cancelled.':String(e.message).slice(0,600)});}finally{active=false;}
 });
 server.requestTimeout=35000;server.headersTimeout=5000;server.keepAliveTimeout=1000;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const close=()=>{server.closeAllConnections();server.close();};signal.addEventListener('abort',close,{once:true});
 const url=`http://127.0.0.1:${server.address().port}/${secret}`;
 return {close(){signal.removeEventListener('abort',close);close();},instructions:`For avatar controls and the current browser page, call the GPT-Live Avatar task tool endpoint using your terminal: HTTP POST ${url} with Content-Type: application/json and JSON {"tool":"TOOL_NAME","args":{...}}. Use Python urllib or curl, with proper JSON escaping. Do not display the private endpoint. It expires after this task. Available tool definitions: ${JSON.stringify(tools.tools)}. Use avatar_state to find exact character and motion IDs before moving or playing a motion. Follow tool results; never invent success. Other code, shell, web and file work uses your native runtime tools.`};
}
module.exports={runtimeTools};
