const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const moduleFrom=async f=>import('data:text/javascript;base64,'+fs.readFileSync(path.join(__dirname,'..',f)).toString('base64'));
(async()=>{
 const {frameDue,surfaceSize,renderPixelBudget,textureBudget}=await moduleFrom('web/avatar-render-budget.js');
 for(const hz of [60,90,120])for(const fps of [12,15,30]){let last=0,painted=[];for(let i=1;i<=hz*10;i++){const now=i*1000/hz+Math.sin(i)*.13,due=frameDue(now,last,fps);if(due!==null){last=due;painted.push(now);}}assert(Math.abs(painted.length-fps*10)<=1,`${fps} fps on ${hz}Hz`);assert(Math.max(...painted.slice(1).map((t,i)=>t-painted[i]))<1000/fps+1000/hz+1);}
 const cap=renderPixelBudget('best',5,16);assert(cap<=360000);assert.equal(textureBudget(5,16),1024);
 let surface=null,allocations=0;for(let i=0;i<200;i++){const next=surfaceSize(510+i%4,750+i%5,1200000,surface,i*16);if(next!==surface)allocations++;surface=next;}assert(allocations<=2,'Breathing must not reallocate framebuffers');
 const small=surfaceSize(200,200,cap,surface,10000);assert(small.w<surface.w&&small.h<surface.h,'Shrinking releases the larger buffer');
 const {activeMorphLayers,copyMorphLayer}=await moduleFrom('web/vendor/three/avatar-morph-stream.js');
 const values=Float32Array.from({length:145},(_,i)=>i%19===0?(i%2?-.32:.63):0),active=activeMorphLayers(values);
 assert.equal(active.length,8);const vertices=9,source=Array.from(values,(_,m)=>Float32Array.from({length:vertices*3},(_,i)=>Math.sin(i+m)*.01));
 const attr=data=>({count:vertices,getX:i=>data[i*3],getY:i=>data[i*3+1],getZ:i=>data[i*3+2]});const packed=new Float32Array(active.length*vertices*4);
 active.forEach((index,slot)=>copyMorphLayer(packed,slot*vertices*4,4,attr(source[index])));
 for(let v=0;v<vertices;v++)for(let c=0;c<3;c++){const expected=source.reduce((sum,m,i)=>sum+m[v*3+c]*values[i],0);const streamed=active.reduce((sum,index,slot)=>sum+packed[slot*vertices*4+v*4+c]*values[index],0);assert(Math.abs(expected-streamed)<1e-9,'Streaming preserves positive and negative authored shapes');}
 console.log('Frame pacing, bounded surfaces, 16 GB budgets and exact morph layer deformation passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
