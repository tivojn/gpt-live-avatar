'use strict';
// Run: env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron qa/hip-corrective.cjs [output-directory]
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),zlib=require('node:zlib');
const root=path.resolve(__dirname,'..');
const out=process.argv[2]?path.resolve(process.argv[2]):fs.mkdtempSync(path.join(os.tmpdir(),'gla-hip-qa-'));
fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(out,'profile'));app.on('window-all-closed',()=>{});
const errors=[];
const server=http.createServer((req,res)=>{
 let url;try{url=decodeURIComponent(req.url.split('?')[0]);}catch{res.writeHead(400);return res.end();}
 if(url==='/'){res.setHeader('Content-Type','text/html');return res.end('<script type="module" src="/avatar3d.js"></script>');}
 if(req.method==='POST'&&/^\/capture\/[-a-z0-9]+\.png$/.test(url)){
  const chunks=[];req.on('data',chunk=>chunks.push(chunk));req.on('end',()=>{fs.writeFileSync(path.join(out,path.basename(url)),Buffer.concat(chunks));res.end('ok');});return;
 }
 const asset=url.startsWith('/asset/'),base=path.join(root,asset?'build/characters':'web');
 const file=path.resolve(base,'.'+(asset?url.slice(6):url));
 if(!file.startsWith(base+path.sep)){res.writeHead(403);return res.end();}
 if(!fs.existsSync(file)&&fs.existsSync(file+'.deflate')){res.setHeader('Content-Type','application/json');return res.end(zlib.inflateRawSync(fs.readFileSync(file+'.deflate')));}
 if(!fs.existsSync(file)){errors.push('Missing '+url);res.writeHead(404);return res.end();}
 res.setHeader('Content-Type',({'.js':'text/javascript','.json':'application/json','.gltf':'model/gltf+json'})[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
});
app.whenReady().then(async()=>{
 let code=0;
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const window=new BrowserWindow({show:false,width:1200,height:1000,webPreferences:{backgroundThrottling:false}});
  window.webContents.on('console-message',details=>{if(details.level==='error')errors.push(details.message);});
  await window.loadURL('http://127.0.0.1:'+server.address().port);
  const result=await window.webContents.executeJavaScript(fs.readFileSync(path.join(__dirname,'hip-corrective-renderer.js'),'utf8'));
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({result,errors},null,2));
  if(errors.length)throw Error(errors.join('\n'));
  console.log('Hip renderer QA passed:',out);
 }catch(error){console.error(error);code=1;}finally{server.close();app.exit(code);}
});
