'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const context=vm.createContext({performance,crypto:require('node:crypto').webcrypto});
for(const file of ['agent-progress.js','path-display.js','agent-client.js'])vm.runInContext(fs.readFileSync(require.resolve('../web/'+file),'utf8').replace(/^import .*$/mg,'').replace(/export /g,''),context);
vm.runInContext('globalThis.install=installAgentUI',context);
(async()=>{
 const listeners={},jobs=[],updates=[],cancels=[],opens=[];
 const api={onAction:f=>listeners.action=f,onCancel:f=>listeners.cancel=f,onProgress:f=>listeners.progress=f,onQuestion:f=>listeners.question=f,onQuestionClose:f=>listeners.questionClose=f,actionResult(){},cancel:id=>cancels.push(id),run:request=>new Promise(resolve=>jobs.push({request,resolve}))};
 const ui=context.install({api,execute:async()=>({ok:true}),name:()=> 'Tia',settings:()=>({userHome:'/Users/test-person'}),onStatus:(_,p)=>updates.push(p),onOpen:name=>opens.push(name)});
 ui.open('Sarah');assert.equal(opens[0],'Sarah');
 const tia=ui.run('Create first.txt','Tia'),sarah=ui.run('Read that file','Sarah');
 assert(ui.isBusy('Tia')&&ui.isBusy('Sarah'));
 assert.equal(jobs.length,2);assert.equal(jobs[0].request.character,'Tia');assert.equal(jobs[1].request.character,'Sarah');
 listeners.progress({id:jobs[0].request.id,character:'Tia',state:'update',text:'Saving /Users/test-person/Downloads/first.txt'});
 listeners.progress({id:jobs[1].request.id,character:'Sarah',state:'update',text:'Reading the shared context.'});
 assert.equal(updates.at(-2).detail,'Saving ~/Downloads/first.txt');assert.equal(updates.at(-1).character,'Sarah');
 const rejected=await ui.run('A duplicate','Tia');assert.equal(rejected.ok,false);assert.equal(jobs.length,2);
 ui.stop('Tia');assert.equal(cancels.length,1);assert.equal(cancels[0],jobs[0].request.id);assert(!ui.isBusy('Tia'));assert(ui.isBusy('Sarah'));
 const count=updates.length;listeners.progress({id:jobs[0].request.id,character:'Tia',state:'complete',text:'stale success'});assert.equal(updates.length,count);
 jobs[0].resolve({ok:true,text:'stale success'});assert.equal((await tia).error,'Stopped.');
 jobs[1].resolve({ok:true,text:'Found the shared file.'});assert((await sarah).ok);assert(!ui.isBusy('Sarah'));
 const again=ui.run('What was inside?','Sarah');assert.equal(jobs[2].request.history.length,3);assert.equal(jobs[2].request.history[1].text,'Found the shared file.');assert(!JSON.stringify(jobs[2].request.history).includes('Create first'));
 jobs[2].resolve({ok:false,error:'Cannot read /Users/test-person/Downloads/first.txt'});await again;assert.equal(updates.at(-1).detail,'Cannot read ~/Downloads/first.txt');assert(!ui.isBusy('Sarah'));
 // Task progress can originate from speech as well as this composer.
 listeners.progress({id:'voice-task',character:'Sarah',state:'thinking'});assert(ui.isBusy('Sarah'));ui.stop('Sarah');assert.equal(cancels.at(-1),'voice-task');
 console.log('Bubble tasks: named concurrent owners, shared-controller cancellation, late result rejection, isolated follow-up history, error display and home-path privacy passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
