import { AgentProgress } from './agent-progress.js';
import { shortenHomePaths } from './path-display.js';

// Tasks stay owned by the avatar renderer. The existing overhead bubbles own
// their composers; this controller never opens a modal or another window.
export function installAgentUI({api,execute,onStatus=()=>{},name=()=> 'Avatar',settings=()=>({}),onOpen=()=>{},questionHost=()=>null,onQuestionChange=()=>{}}){
 const cancelledActions=new Set(),cancelledRequests=new Set(),histories=new Map(),progress=new Map(),requests=new Map(),questions=new Map();
 const character=value=>typeof value==='string'&&value?value:name();
 const display=value=>shortenHomePaths(value,settings()?.userHome);
 function update(p){
  if(!p?.id||(cancelledRequests.has(p.id)&&p.state!=='cancelled'))return;
  const key=character(p.character);let stream=progress.get(key);
  if(!stream){stream=new AgentProgress();progress.set(key,stream);}
  const current=stream.accept({...p,character:key});
  if(current)onStatus(display(current.label),{...current,label:display(current.label),detail:display(current.detail)});
 }
 api.onAction(async({id,action,args})=>{try{const result=await execute(action,args,()=>cancelledActions.has(id));if(!cancelledActions.has(id))api.actionResult(id,result||{ok:true});}catch(e){if(!cancelledActions.has(id))api.actionResult(id,{ok:false,error:e.message});}finally{cancelledActions.delete(id);}});
 api.onCancel(({id})=>{cancelledActions.add(id);if(cancelledActions.size>64)cancelledActions.delete(cancelledActions.values().next().value);});
 api.onProgress(update);
 const isBusy=value=>{const key=character(value);return requests.has(key)||Boolean(progress.get(key)?.current?.active);};
 async function run(text,value){
  const key=character(value);text=String(text||'').trim();
  if(!text)return {ok:false,error:'Enter a request first.'};
  if(isBusy(key))return {ok:false,error:key+' is already working. Stop the current task before sending another.'};
  const id='agent-'+crypto.randomUUID(),history=[...(histories.get(key)||[]),{role:'user',text}].slice(-12);
  requests.set(key,id);histories.set(key,history);update({id,character:key,state:'thinking'});
  let result;
  try{result=await api.run({id,turnId:id,history,character:key});}catch(e){result={ok:false,error:e.message};}
  if(cancelledRequests.has(id))result={ok:false,error:'Stopped.'};
  else if(result?.ok){histories.set(key,[...history,{role:'assistant',text:result.text}].slice(-12));update({id,character:key,state:'complete',text:result.text,receipts:result.receipts});}
  else {result={ok:false,error:result?.error||'The agent did not return a result.'};update({id,character:key,state:'error',error:result.error});}
  if(requests.get(key)===id)requests.delete(key);
  return {...result,requestId:id};
 }
 function closeQuestion(id,answer){
  const item=questions.get(id);if(!item)return;
  questions.delete(id);item.el.remove();
  onQuestionChange(item.character,[...questions.values()].some(q=>q.character===item.character));
  if(answer!==undefined)void api.answerQuestion(id,answer);
 }
 const stop=value=>{
  const key=character(value),id=requests.get(key)||progress.get(key)?.current?.id;
  if(!id)return;
  cancelledRequests.add(id);if(cancelledRequests.size>64)cancelledRequests.delete(cancelledRequests.values().next().value);
  requests.delete(key);void api.cancel(id);update({id,character:key,state:'cancelled'});
  for(const [qid,item] of questions)if(item.character===key)closeQuestion(qid,{});
 };
 api.onQuestion?.(request=>{
  const key=character(request.character),host=questionHost(key);
  if(!host){void api.answerQuestion(request.id,{});return;}
  for(const [id,item] of questions)if(item.character===key)closeQuestion(id,{});
  const panel=document.createElement('form');panel.className='agent-question';panel.setAttribute('aria-label',key+' has a question');
  const title=document.createElement('strong');title.textContent=key+' has a question';panel.append(title);const fields=[];
  for(const q of request.questions||[]){
   const label=document.createElement('label');label.textContent=display(q.question);
   const input=document.createElement('input');input.type='text';input.placeholder='Type your answer…';input.setAttribute('aria-label',display(q.question));
   const field={q,input,selected:null};input.addEventListener('input',()=>{field.selected=null;});
   if(q.options?.length){const choices=document.createElement('div');choices.className='agent-choices';for(const option of q.options){const b=document.createElement('button');b.type='button';b.textContent=display(option.label);b.title=display(option.description||'');b.onclick=()=>{input.value=display(option.label);field.selected=option.label;input.focus();};choices.append(b);}panel.append(label,choices,input);}else panel.append(label,input);
   fields.push(field);
  }
  const row=document.createElement('div');row.className='agent-question-actions';const send=document.createElement('button');send.type='submit';send.textContent='Send answer';const dismiss=document.createElement('button');dismiss.type='button';dismiss.textContent='Dismiss';dismiss.onclick=()=>closeQuestion(request.id,{});row.append(send,dismiss);panel.append(row);
  panel.onsubmit=e=>{e.preventDefault();const answers=Object.fromEntries(fields.map(({q,input,selected})=>[q.id,{answers:[selected??input.value.trim()]}]));closeQuestion(request.id,answers);};
  questions.set(request.id,{character:key,el:panel});host.append(panel);onQuestionChange(key,true);onOpen(key);fields[0]?.input.focus();
 });
 api.onQuestionClose?.(({id})=>closeQuestion(id));
 return {open(value){onOpen(character(value));},run,stop,isBusy};
}
