'use strict';
// The environment an agent runtime is started with: the runtime's own folder first, then the usual
// places its helpers live, then the user's path. Never ELECTRON_RUN_AS_NODE.
// A copy of process.env is an ordinary, case-sensitive object, and Windows calls the variable "Path".
// Writing env.PATH there adds a second variable; Node then hands the child the one that sorts first,
// "PATH", and the system's folders are gone. So the variable that exists is the one that is extended.
const UNIX=['/opt/homebrew/bin','/usr/local/bin','/usr/bin','/bin'];
function childEnv(folder,base=process.env,platform=process.platform){
 const env={...base};delete env.ELECTRON_RUN_AS_NODE;
 const win=platform==='win32',key=win?Object.keys(env).find(k=>k.toUpperCase()==='PATH')||'Path':'PATH';
 env[key]=[folder,...(win?[]:UNIX),env[key]||''].join(win?';':':');
 return env;
}
module.exports={childEnv};
