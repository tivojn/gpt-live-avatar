// Node regression: cloning a material must preserve its existing decorators.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../web/avatar3d-body-brief.js'),'utf8');
 const {bindSarahBodyBrief}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 class Material{constructor(tag){this.tag=tag;this.onBeforeCompile=()=>{};this.customProgramCacheKey=function(){return this.onBeforeCompile.toString();};}clone(){return new Material(this.tag);}}
 let calls=[];const material=tag=>{const m=new Material(tag);m.onBeforeCompile=function(s){calls.push([tag,this]);s.vertexShader+='\n// existing '+tag;};m.customProgramCacheKey=()=>tag;return m;};
 const node={isSkinnedMesh:true,userData:{avatarBodyFittedUnderlayer:true},material:material('appearance')};
 bindSarahBodyBrief(node);const first=node.material;
 const shader={vertexShader:'#include <begin_vertex>\n#include <skinning_vertex>',fragmentShader:'#include <clipping_planes_fragment>'};first.onBeforeCompile(shader,{});
 assert.equal(calls.length,1);assert.equal(calls[0][1],first);assert(shader.vertexShader.includes('existing appearance'));assert(shader.vertexShader.includes('avatarBriefRest=position'));assert(shader.fragmentShader.includes('briefWaist'));
 assert(first.customProgramCacheKey().startsWith('appearance'));bindSarahBodyBrief(node);assert.equal(node.material,first);
 node.material=material('replacement');bindSarahBodyBrief(node);node.material.onBeforeCompile({...shader},{});assert.equal(calls.at(-1)[0],'replacement');assert.notEqual(node.material,first);
 node.material=[material('one'),material('two')];bindSarahBodyBrief(node);assert(Array.isArray(node.material));for(const m of node.material)m.onBeforeCompile({...shader},{});assert.equal(calls.at(-2)[0],'one');assert.equal(calls.at(-1)[0],'two');
 const plain={isSkinnedMesh:true,userData:{},material:material('other')},before=plain.material;bindSarahBodyBrief(plain);assert.equal(plain.material,before);
 const a=new Material('default-A'),b=new Material('default-B');a.onBeforeCompile=function(s){s.vertexShader+='// A';};b.onBeforeCompile=function(s){s.vertexShader+='// B';};assert.notEqual(a.customProgramCacheKey(),b.customProgramCacheKey());const na={isSkinnedMesh:true,userData:{avatarBodyFittedUnderlayer:true},material:a},nb={isSkinnedMesh:true,userData:{avatarBodyFittedUnderlayer:true},material:b};bindSarahBodyBrief(na);bindSarahBodyBrief(nb);assert.notEqual(na.material.customProgramCacheKey(),nb.material.customProgramCacheKey());
 console.log('Material hook preservation, idempotence, replacement and array handling passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
