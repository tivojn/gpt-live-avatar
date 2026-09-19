'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const {findRuntime}=require('./acp-client.cjs');
const validAgent=id=>typeof id==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id); // EnConvo custom agents have mixed-case ids
function hermesRoot(){const configured=process.env.HERMES_HOME;const root=configured&&path.isAbsolute(configured)?configured:path.join(os.homedir(),'.hermes');return path.basename(path.dirname(root))==='profiles'?path.dirname(path.dirname(root)):root;}
function hermesProfiles(root=hermesRoot()){
 if(!fs.existsSync(root))return [];
 const result=[{id:'default',name:'Default profile',isDefault:true}],folder=path.join(root,'profiles');
 if(fs.existsSync(folder))for(const entry of fs.readdirSync(folder,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)))if(entry.isDirectory()&&validAgent(entry.name)&&entry.name!=='default'&&!fs.existsSync(path.join(folder,'.deleted',entry.name)))result.push({id:entry.name,name:entry.name});
 let active='default';try{const value=fs.readFileSync(path.join(root,'active_profile'),'utf8').trim();if(validAgent(value)&&result.some(a=>a.id===value))active=value;}catch{}
 for(const entry of result)entry.isDefault=entry.id===active;
 return result;
}
async function discoverAgents(engine,config={},exec=promisify(execFile),fetchImpl=fetch){
 if(engine==='enconvo')return require('./enconvo-agent.cjs').discoverEnconvoAgents(config,fetchImpl);
 let command;try{command=findRuntime(engine,config.agentRuntimePaths?.[engine]||'');}catch(error){return {installed:false,agents:[],error:error.message};}
 try{
  if(engine==='grok')return {installed:true,agents:[{id:'default',name:'Grok Build',isDefault:true}],kind:'runtime'};
  if(engine==='hermes')return {installed:true,agents:hermesProfiles(),kind:'profile'};
  const env=require('./child-env.cjs').childEnv(path.dirname(command.file));
  const {stdout}=await exec(command.file,[...command.prefix,'agents','list','--json'],{env,timeout:20000,maxBuffer:4*1024*1024,windowsHide:true});
  // Some releases prepend diagnostics; accept only the final JSON array.
  const start=stdout.indexOf('[');const data=JSON.parse(stdout.slice(start));if(!Array.isArray(data))throw Error('Invalid inventory');
  return {installed:true,kind:'agent',agents:data.filter(a=>validAgent(a.id)).map(a=>({id:a.id,name:String(a.identityName||a.name||a.id).slice(0,80),isDefault:a.isDefault===true,model:typeof a.model==='string'?a.model.slice(0,200):''}))};
 }catch{return {installed:true,agents:[],error:'Could not list agents. Check the runtime configuration and refresh.'};}
}
function characterSlug(character,config){const normalized=String(character||'').toLowerCase().replace(/[^a-z0-9]/g,'');const ids=['tia','sarah','iselda','ming-mei','seraphim',...Object.keys(config.avatarAgentBindings||{})];return ids.find(id=>id.replace(/[^a-z0-9]/g,'')===normalized)||(character===config.personaName?config.avatar:null)||null;}
function assignedAgent(engine,config,character){return config.avatarAgentBindings?.[characterSlug(character,config)]?.[engine]||'';}
module.exports={validAgent,hermesRoot,hermesProfiles,discoverAgents,characterSlug,assignedAgent};
