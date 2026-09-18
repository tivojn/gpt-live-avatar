'use strict';
// In-app update: download the release installer, prove it is ours, swap the
// app bundle, relaunch. The user starts each step (Download, then Install and
// Relaunch); nothing is fetched or installed silently.
//
// What "prove it is ours" means, in order, and a failure at any step discards
// the download and leaves the installed app untouched:
//   1. The installer's address is the release service's own, named for this
//      exact version and architecture (electron/releases.cjs already enforces
//      that on the release record; it is checked again here).
//   2. The bytes match the size and SHA-256 published in that record.
//   3. The app inside the disk image passes `codesign --verify --deep --strict`.
//   4. It is signed by the same Developer ID team, with the same bundle
//      identifier, as the app that is running.
//   5. Gatekeeper accepts it as a notarized Developer ID app.
//   6. Its own version is the one that was announced, and newer than this one.
// The swap itself is recoverable: the old bundle is moved to the Trash, not
// deleted, and is moved back if the new one cannot take its place.
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),cp=require('node:child_process');
const {RELEASE_BASE,compareVersions}=require('./releases.cjs');

const APP_NAME='GPT-Live Avatar.app',LIMIT=2*1024*1024*1024;
const execFile=(cmd,args,options={})=>new Promise((resolve,reject)=>cp.execFile(cmd,args,{timeout:180000,maxBuffer:4*1024*1024,...options},(error,stdout,stderr)=>error?reject(Object.assign(error,{stdout:String(stdout),stderr:String(stderr)})):resolve({stdout:String(stdout),stderr:String(stderr)})));
// `codesign -dv` reports on stderr.
const field=(text,name)=>(new RegExp('^'+name+'=(.*)$','m').exec(text)||[])[1]?.trim()||'';
const bundleOf=execPath=>{const i=String(execPath).indexOf('.app/Contents/MacOS/');return i<0?'':String(execPath).slice(0,i+4);};
const refuse=message=>Object.assign(Error(message),{refused:true});

class Updater{
  constructor({directory,currentVersion,execPath=process.execPath,isPackaged=false,arch=process.arch,fetchImpl=fetch,run=execFile,spawn=cp.spawn,pid=process.pid,home=os.homedir(),releaseBase=RELEASE_BASE,identity=null}={}){
    Object.assign(this,{directory,currentVersion,execPath,isPackaged,arch,fetch:fetchImpl,run,spawn,pid,home,releaseBase,identity});
  }
  file(version){return path.join(this.directory,'gpt-live-avatar-'+version+'-'+this.arch+'.dmg');}
  expectedURL(version){return this.releaseBase?this.releaseBase+'gpt-live-avatar-'+version+'-'+this.arch+'.dmg':null;}
  check(release){
    if(!release||typeof release.version!=='string'||compareVersions(release.version,this.currentVersion)<=0)throw refuse('That release is not newer than this app.');
    if(!release.downloadURL||release.downloadURL!==this.expectedURL(release.version))throw refuse('That installer is not on the official release service.');
    if(!/^[a-f0-9]{64}$/.test(release.sha256||'')||!Number.isSafeInteger(release.bytes)||release.bytes<=0||release.bytes>LIMIT)throw refuse('The release does not publish a usable checksum, so it cannot be installed from here.');
  }
  // Streams to a .part file, hashing as it goes; only a byte-exact, checksum-exact file keeps its name.
  async download(release,{signal,onProgress=()=>{}}={}){
    this.check(release);await fsp.mkdir(this.directory,{recursive:true});
    const file=this.file(release.version),part=file+'.part';
    await fsp.rm(part,{force:true});await fsp.rm(file,{force:true});
    const response=await this.fetch(release.downloadURL,{redirect:'error',signal});
    if(!response.ok||!response.body){await response.body?.cancel?.();throw Error('The installer could not be downloaded (HTTP '+response.status+').');}
    const hash=crypto.createHash('sha256'),out=fs.createWriteStream(part),reader=response.body.getReader();let received=0,last=-1;
    try{
      while(true){const {done,value}=await reader.read();if(done)break;received+=value.byteLength;
        if(received>release.bytes)throw refuse('The download is larger than the published installer and was discarded.');
        hash.update(value);if(!out.write(value))await new Promise(resolve=>out.once('drain',resolve));
        const percent=Math.floor(received/release.bytes*100);if(percent!==last){last=percent;onProgress({received,bytes:release.bytes,percent});}}
      await new Promise((resolve,reject)=>out.end(error=>error?reject(error):resolve()));
      if(received!==release.bytes)throw refuse('The download was incomplete and was discarded.');
      if(hash.digest('hex')!==release.sha256)throw refuse('The download did not match the published checksum and was discarded.');
      await fsp.rename(part,file);return file;
    }catch(error){out.destroy();try{await reader.cancel();}catch{}await fsp.rm(part,{force:true});throw error;}
  }
  // Who signed the app that is running: the yardstick for the one in the image.
  async ownIdentity(){
    if(this.identity)return this.identity;
    const bundle=bundleOf(this.execPath);if(!bundle)throw refuse('This copy of the app cannot update itself.');
    const {stderr}=await this.run('codesign',['-dv','--verbose=4',bundle]);
    const identity={team:field(stderr,'TeamIdentifier'),identifier:field(stderr,'Identifier')};
    if(!identity.team||identity.team==='not set'||!identity.identifier)throw refuse('This copy of the app is not signed, so it cannot verify an update.');
    return this.identity=identity;
  }
  // Mounts the image read-only and checks the app inside (steps 3 to 6 above). Returns the mounted app for staging.
  async verify(file,release){
    const mount=await fsp.mkdtemp(path.join(os.tmpdir(),'gla-update-'));
    const detach=async()=>{try{await this.run('hdiutil',['detach',mount,'-force']);}catch{}await fsp.rm(mount,{recursive:true,force:true}).catch(()=>{});};
    try{
      await this.run('hdiutil',['attach','-nobrowse','-readonly','-noautoopen','-mountpoint',mount,file]);
      const appPath=path.join(mount,APP_NAME);
      if(!fs.existsSync(path.join(appPath,'Contents','Info.plist')))throw refuse('The disk image does not contain GPT-Live Avatar.');
      await this.run('codesign',['--verify','--deep','--strict',appPath]).catch(()=>{throw refuse('The update’s code signature is not valid.');});
      const own=await this.ownIdentity(),{stderr}=await this.run('codesign',['-dv','--verbose=4',appPath]);
      if(field(stderr,'TeamIdentifier')!==own.team||field(stderr,'Identifier')!==own.identifier)throw refuse('The update is not signed by the developer of this app.');
      const gate=await this.run('spctl',['-a','-t','exec','-vv',appPath]).catch(()=>{throw refuse('macOS did not accept the update as a notarized app.');});
      if(!/accepted/.test(gate.stderr+gate.stdout)||!/Notarized Developer ID/.test(gate.stderr+gate.stdout))throw refuse('macOS did not accept the update as a notarized app.');
      const version=(await this.run('/usr/libexec/PlistBuddy',['-c','Print :CFBundleShortVersionString',path.join(appPath,'Contents','Info.plist')])).stdout.trim();
      if(version!==release.version||compareVersions(version,this.currentVersion)<=0)throw refuse('The installer contains version '+version+', not the announced '+release.version+'.');
      return {appPath,mount,detach,version};
    }catch(error){await detach();if(error.refused)await fsp.rm(file,{force:true});throw error;}
  }
  // Copies the verified app beside the installed one, so the swap is two renames on one volume.
  async stage(verified){
    try{
      if(!this.isPackaged)throw refuse('Install and Relaunch works in the installed app. This is a development run; the verified installer is in the updates folder.');
      const target=bundleOf(this.execPath);if(!target||path.basename(target)!==APP_NAME)throw refuse('This copy of the app cannot replace itself. Open the installer instead.');
      const parent=path.dirname(target);
      await fsp.access(parent,fs.constants.W_OK).catch(()=>{throw refuse('GPT-Live Avatar cannot write to '+parent+'. Open the installer and drag the app there yourself.');});
      const staged=path.join(parent,'.GPT-Live Avatar '+verified.version+' update.app');
      await fsp.rm(staged,{recursive:true,force:true}); // our own earlier staging copy only
      await this.run('ditto',[verified.appPath,staged]);
      await this.run('codesign',['--verify','--deep','--strict',staged]).catch(async()=>{await fsp.rm(staged,{recursive:true,force:true});throw refuse('The copied update failed its signature check.');});
      return {target,staged,version:verified.version};
    }finally{await verified.detach();}
  }
  // A small shell helper outlives this process: it waits for the app to quit,
  // moves the old bundle to the Trash, puts the new one in its place and opens
  // it; if the new one cannot move in, the old one goes back.
  async install(staging){
    const stamp=new Date().toISOString().replace(/[-:T]/g,'').slice(0,14),old=path.join(this.home,'.Trash','GPT-Live Avatar '+this.currentVersion+' '+stamp+'.app');
    const script=path.join(this.directory,'install-update.sh');
    await fsp.writeFile(script,['#!/bin/sh','pid="$1"; target="$2"; staged="$3"; old="$4"','i=0; while kill -0 "$pid" 2>/dev/null && [ "$i" -lt 150 ]; do sleep 0.2; i=$((i+1)); done',
      'if mv "$target" "$old"; then','  if mv "$staged" "$target"; then open "$target"; exit 0; fi','  mv "$old" "$target"','fi','open "$target"; exit 1',''].join('\n'),{mode:0o700});
    const child=this.spawn('/bin/sh',[script,String(this.pid),staging.target,staging.staged,old],{detached:true,stdio:'ignore'});child.unref?.();
    return {old,script};
  }
  async discard(version){await fsp.rm(this.file(version),{force:true});await fsp.rm(this.file(version)+'.part',{force:true});}
}
module.exports={Updater,bundleOf,APP_NAME};
