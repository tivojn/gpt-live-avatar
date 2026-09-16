// Run with Electron and locally licensed packs. All captures remain in ignored build/.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=root+'/build/qa-hair-contact';
fs.mkdirSync(out,{recursive:true});app.setPath('userData',out+'/profile');app.on('window-all-closed',()=>{});
const server=http.createServer((req,res)=>{
 const u=decodeURIComponent(req.url.split('?')[0]);
 if(u==='/'){res.setHeader('Content-Type','text/html');return res.end('<script type="module" src="/avatar3d.js"></script>');}
 const file=u.startsWith('/asset/')?root+'/build/characters/'+u.slice(7):root+'/web'+u;
 if(!fs.existsSync(file)&&fs.existsSync(file+'.deflate')){res.setHeader('Content-Type','application/json');return res.end(zlib.inflateRawSync(fs.readFileSync(file+'.deflate')));}
 if(!fs.existsSync(file)){res.statusCode=404;return res.end();}
 res.setHeader('Content-Type',({'.js':'text/javascript','.json':'application/json','.gltf':'model/gltf+json'})[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
});
app.whenReady().then(async()=>{const errors=[];try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const w=new BrowserWindow({show:false,width:1000,height:1000,webPreferences:{backgroundThrottling:false}});
 w.webContents.on('console-message',d=>{if(d.level==='error')errors.push(d.message);});
 await w.loadURL('http://127.0.0.1:'+server.address().port);
 const report=await w.webContents.executeJavaScript(fs.readFileSync(__dirname+'/hair-contact-renderer.js','utf8'));
 for(const shot of await w.webContents.executeJavaScript('shots'))fs.writeFileSync(out+'/'+shot.name+'.png',Buffer.from(shot.data.split(',')[1],'base64'));
 assert.equal(report.records,4,'All four Sarah hair sections need contact');
 assert(report.contact.correctedVertices>100,'Regression motions must exercise penetrating hair');
 assert.equal(report.contact.maxScalpDisplacement,0,'Scalp/root geometry must remain attached without collision deformation');
 assert(report.contact.maxResidual<1e-6,'Torso correction must resolve the complete crossing, not push hair through the front');
 assert.equal(report.shadowMaterials.length,4);assert(report.shadowMaterials.every(r=>r.contact),'Portrait shadows must use the same corrected hair');
 assert.equal(report.glError,0);assert.deepEqual(errors,[]);
 fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }catch(error){console.error(error,errors);process.exitCode=1;}finally{server.close();app.exit(process.exitCode||0);}});
