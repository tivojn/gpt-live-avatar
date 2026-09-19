'use strict';
// Windows: turn "a command found on the path" into something spawn() can start WITHOUT a shell.
// This app never runs a child through a shell (no interpolation of anything a model or a page wrote),
// and on Windows only real executables start that way. `npm install -g` leaves three shims beside each
// other (name, name.cmd, name.ps1); none of them is one. The .cmd shim always ends in
//   "%_prog%"  "%dp0%\node_modules\<package>\<script>.js" %*
// so the script it names is started with node.exe directly, which is all the shim does. The shim is only
// read, never run, and the script must lie inside the shim's own folder.
const fs=require('node:fs'),path=require('node:path');
const isFile=file=>{try{return fs.statSync(file).isFile();}catch{return false;}};
const pathDirs=env=>String(env.PATH||env.Path||'').split(';').filter(Boolean);
// An engine may bring the Node it needs (OpenClaw refuses older ones): `nodeDirs` are looked in first.
function findNode(dir,env,nodeDirs=[]){
 for(const file of [...nodeDirs.map(d=>path.join(d,'node.exe')),path.join(dir,'node.exe'),...pathDirs(env).map(d=>path.join(d,'node.exe'))])if(isFile(file))return file;
 return '';
}
// file: an .exe, an npm shim in any of its three forms, or a name without extension. → {file,prefix} or null.
function resolveWindowsCommand(file,env=process.env,nodeDirs=[]){
 if(typeof file!=='string'||!path.win32.isAbsolute(file))return null;
 if(/\.(exe|com)$/i.test(file))return isFile(file)?{file,prefix:[]}:null;
 const dir=path.dirname(file),name=path.basename(file).replace(/\.(cmd|ps1|bat)$/i,'');
 if(isFile(path.join(dir,name+'.exe')))return {file:path.join(dir,name+'.exe'),prefix:[]};
 let shim;try{shim=fs.readFileSync(path.join(dir,name+'.cmd'),'utf8');}catch{return null;}
 if(shim.length>20000)return null;
 const match=/"%(?:~dp0|dp0%)\\([^"%]+\.(?:m?js|cjs))"\s+%\*/i.exec(shim);if(!match)return null;
 const script=path.resolve(dir,...match[1].split(/\\/));
 if(!script.toLowerCase().startsWith(path.resolve(dir).toLowerCase()+path.sep)||!isFile(script))return null;
 const node=findNode(dir,env,nodeDirs);if(!node)throw Error('Node.js was not found. Install Node.js, or reinstall '+name+'.');
 return {file:node,prefix:[script]};
}
// The first of `names` that can be started, looking through `dirs` in order.
function findWindowsCommand(names,dirs,env=process.env,nodeDirs=[]){
 for(const dir of dirs)for(const name of names){
  if(!isFile(path.join(dir,name+'.exe'))&&!isFile(path.join(dir,name+'.cmd')))continue;
  const found=resolveWindowsCommand(path.join(dir,name),env,nodeDirs);if(found)return {...found,name};
 }
 return null;
}
module.exports={resolveWindowsCommand,findWindowsCommand,pathDirs};
