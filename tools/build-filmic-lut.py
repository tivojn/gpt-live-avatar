"""Bake a Blender display transform for the portrait renderer.

Usage: python build-filmic-lut.py /path/to/Blender/config.ocio output.rgba16f [Filmic|AgX] [size]
Requires numpy and PyOpenColorIO at build time only. The runtime LUT contains
linear RGB input sampled uniformly in log2 space, and sRGB display output.
"""
import sys,json
from pathlib import Path
import numpy as np
import PyOpenColorIO as ocio

size=int(sys.argv[4]) if len(sys.argv)>4 else 65
if not 17<=size<=129:raise ValueError('Unsupported portrait LUT resolution')
low,high=-12.473931188,4.026068812
config=ocio.Config.CreateFromFile(sys.argv[1])
view=sys.argv[3] if len(sys.argv)>3 else 'Filmic'
if view not in ['Filmic','AgX']:raise ValueError('Unsupported portrait display transform')
cpu=config.getProcessor(ocio.DisplayViewTransform(src='Linear Rec.709',display='sRGB',view=view)).getDefaultCPUProcessor()
axis=np.exp2(np.linspace(low,high,size,dtype=np.float32))
b,g,r=np.meshgrid(axis,axis,axis,indexing='ij')
rgb=np.ascontiguousarray(np.stack([r,g,b],axis=-1).reshape(-1,3))
cpu.applyRGB(rgb)
rgba=np.ones((len(rgb),4),dtype=np.float16);rgba[:,:3]=rgb
out=Path(sys.argv[2]);out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(rgba.astype('<f2').tobytes())
out.with_suffix('.json').write_text(json.dumps({'size':size,'log2Domain':[low,high],'input':'Linear Rec.709','display':'sRGB','view':view,'look':'None','ocioVersion':ocio.__version__},indent=2))
print('Baked',view,'display transform',out,len(rgba),'samples')
