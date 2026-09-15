// HeadAudio's learned MFCC/Gaussian phoneme prototypes (MIT, see vendor notice).
export const VISEME_NAMES = ['aa','E','ih','oh','ou','PP','SS','TH','DD','FF','kk','nn','RR','CH','sil'];
export function decodeVisemeModel(buffer) {
  const stride=368, model=[];
  if(!buffer.byteLength || buffer.byteLength%stride)throw Error('Invalid lip-sync model.');
  for(let offset=0;offset<buffer.byteLength;offset+=stride){
    const header=new DataView(buffer,offset,8),viseme=header.getUint8(7);
    if(viseme>=VISEME_NAMES.length)throw Error('Invalid lip-sync class.');
    const mu=new Float32Array(buffer,offset+8,12),sigmaInvLower=new Float32Array(buffer,offset+56,78);
    if(!mu.every(Number.isFinite)||!sigmaInvLower.every(Number.isFinite))throw Error('Invalid lip-sync prototype.');
    model.push({group:header.getUint8(5),viseme,mu,sigmaInvLower});
  }
  return model;
}
