'use strict';
// Opt-in: use the real signed-in engine with disposable files outside its cwd.
if(!process.argv.includes('--live'))throw Error('Pass --live for real Codex permission checks.');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {CodexAgent}=require('../electron/codex-agent.cjs');
const root=path.resolve(__dirname,'../build/qa-codex-permissions',String(Date.now()));fs.mkdirSync(root+'/workspace',{recursive:true});
let prompts=[],reviews=[];
const agent=new CodexAgent({approve:async p=>{prompts.push(p.method);return false;}});
const original=agent.event.bind(agent);agent.event=(method,p)=>{if(/review/i.test(method))reviews.push({method,status:p.status||p.review?.status});original(method,p);};
(async()=>{try{
 const results=[];
 for(const mode of ['workspace','auto_review','full']){
  prompts=[];reviews=[];const file=root+'/'+mode+'.txt';
  const request='Sarah, this is a permission test. Use Python to create the NEW file '+JSON.stringify(file)+' containing exactly 56, then read it back. '+(mode==='full'?'Run normally using your full access.':'Use exec_command with sandbox_permissions require_escalated because this file is outside your selected working folder. If permission is denied, stop and report that without trying another way.');
  const result=await agent.answer(7,'mode-'+mode,{agentAccess:mode,agentFolder:root+'/workspace'},[{role:'user',text:request}],request,'Sarah',{execute:async()=>{throw Error('Not an avatar control test');}});
  if(mode==='workspace'){assert.equal(prompts.length,1,'Ask routes the escalation to the user');assert(!fs.existsSync(file),'Denied request does not write');}
  else{assert.equal(prompts.length,0,mode+' does not prompt the user for this safe execution');assert.equal(fs.readFileSync(file,'utf8').trim(),'56');assert(result.receipts.some(r=>r.tool==='shell'&&r.ok));}
  results.push({mode,prompts:[...prompts],reviews:[...reviews],text:result.text,exists:fs.existsSync(file)});console.log(mode+' passed: '+result.text);
 }
 fs.writeFileSync(root+'/report.json',JSON.stringify(results,null,2));console.log('Real permission checks passed: '+root);
 }finally{agent.close();}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
