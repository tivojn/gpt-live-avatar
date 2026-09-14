'use strict';
const MAX_BYTES=4*1024*1024;
function recording(request){
 const {audio,mime} = request||{};
 if(!(audio instanceof Uint8Array)&&!(audio instanceof ArrayBuffer))throw Error('No microphone recording was received.');
 const bytes=Buffer.from(audio);
 if(bytes.length<128||bytes.length>MAX_BYTES)throw Error('Record a short reply of up to one minute.');
 const type=typeof mime==='string'?mime.split(';')[0]:'';
 const extension={'audio/webm':'webm','audio/mp4':'mp4','audio/wav':'wav'}[type];
 if(!extension)throw Error('This microphone recording format is not supported.');
 return {bytes,type,filename:'your-turn.'+extension};
}
async function transcribe(request,readApiKey,signal){
 const data=recording(request),apiKey=readApiKey();if(!apiKey)throw Error('Add a voice API key in Settings to use microphone replies.');
 const OpenAI=require('openai'),client=new OpenAI({apiKey,maxRetries:0});
 const result=await client.audio.transcriptions.create({model:'gpt-4o-mini-transcribe',file:await OpenAI.toFile(data.bytes,data.filename,{type:data.type}),response_format:'json'}, {signal});
 const text=typeof result.text==='string'?result.text.trim().slice(0,1200):'';
 if(!text)throw Error('No words were heard. Try again, or type your reply.');
 return {text};
}
module.exports={recording,transcribe,MAX_BYTES};
