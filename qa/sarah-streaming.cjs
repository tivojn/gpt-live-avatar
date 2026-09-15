// Run with Electron. Requires licensed local build/characters; images stay local.
// GLA_REPO=/path/to/repo GLA_SARAH_STAGE=/path/to/audit electron qa/sarah-dress.cjs
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),zlib=require('node:zlib');
const root=path.resolve(process.env.GLA_REPO||path.join(__dirname,'..'));
const stage=process.env.GLA_SARAH_STAGE&&path.resolve(process.env.GLA_SARAH_STAGE);
const out=path.resolve(process.env.GLA_QA_OUT||path.join(root,'work','sarah-dress-qa'));
fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(out,'isolated-profile'));app.on('window-all-closed',()=>{});
const errors=[];
const server=http.createServer((req,res)=>{
 const u=decodeURIComponent(req.url.split('?')[0]);
 if(req.method==='POST'&&u.startsWith('/capture/')){const name=path.basename(u);let chunks=[];req.on('data',x=>chunks.push(x));req.on('end',()=>{fs.writeFileSync(path.join(out,name),Buffer.concat(chunks));res.end('ok');});return;}
 if(u==='/'){res.setHeader('Content-Type','text/html');return res.end('<script type="module" src="/avatar3d.js"></script>');}
 let file=u.startsWith('/asset/')?path.join(root,'build/characters',u.slice(7)):path.join(root,'web',u);
 if(stage){
  if(['/avatar3d-body-brief.js','/avatar3d-garment-fit.js','/avatar3d-cloth-occlusion.js'].includes(u))file=path.join(stage,'final/web',u);
 }
 if(!fs.existsSync(file)&&fs.existsSync(file+'.deflate')){res.setHeader('Content-Type','application/json');return res.end(zlib.inflateRawSync(fs.readFileSync(file+'.deflate')));}
 if(!fs.existsSync(file)){errors.push('404 '+u);res.statusCode=404;return res.end();}
 res.setHeader('Content-Type',({'.js':'text/javascript','.json':'application/json','.gltf':'model/gltf+json'})[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
});
app.whenReady().then(async()=>{try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const w=new BrowserWindow({show:false,width:1200,height:1000,webPreferences:{backgroundThrottling:false}});
 w.webContents.on('console-message',e=>{if(e.level==='error')errors.push(e.message);});
 await w.loadURL('http://127.0.0.1:'+server.address().port);
 const report=await w.webContents.executeJavaScript(fs.readFileSync(path.join(__dirname,'sarah-streaming-renderer.js'),'utf8'));
 if(report.failure)throw Error(report.failure);
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({...report,errors},null,2));
 if(errors.length)throw Error(errors.join('\n'));
 console.log(JSON.stringify({passed:true,...report}));
 }catch(e){fs.writeFileSync(path.join(out,'failure.txt'),String(e.stack||e)+'\n'+errors.join('\n'));console.error(e);process.exitCode=1;}finally{server.close();app.exit(process.exitCode||0);}});
