"""Normal-map filtering must not turn unused atlas texels into inverted normals."""
import importlib.util
from pathlib import Path
import unittest
import numpy as np
from PIL import Image

spec=importlib.util.spec_from_file_location('materials',Path(__file__).resolve().parents[1]/'tools/character-materials.py')
materials=importlib.util.module_from_spec(spec);spec.loader.exec_module(materials)

class NormalTextures(unittest.TestCase):
 def test_thin_strand_survives_minification(self):
  pixels=np.zeros((32,32,4),dtype=np.uint8)
  pixels[:,14:16]=[140,120,245,255]
  source=Image.fromarray(pixels)
  fixed=materials.pad_normal_texture(source)
  # The same downsampling footprint includes both the strand and its padding.
  raw=np.array(source.convert('RGB').resize((4,4),Image.Resampling.BILINEAR))
  padded=np.array(fixed.resize((4,4),Image.Resampling.BILINEAR))
  visible=np.array(source.getchannel('A').resize((4,4),Image.Resampling.BILINEAR))>0
  self.assertTrue(np.any(raw[:,:,2][visible]<128))
  self.assertTrue(np.all(padded[:,:,2][visible]>=128))
  self.assertTrue(np.array_equal(np.array(fixed)[:,14:16],pixels[:,14:16,:3]))

 def test_preserves_stored_vectors_even_without_alpha(self):
  pixels=np.zeros((4,4,4),dtype=np.uint8)
  pixels[1,1]=[140,120,245,0]
  pixels[2,2]=[130,128,253,50]
  fixed=np.array(materials.pad_normal_texture(Image.fromarray(pixels)))
  self.assertTrue(np.array_equal(fixed[1,1],pixels[1,1,:3]))
  self.assertTrue(np.array_equal(fixed[2,2],pixels[2,2,:3]))

 def test_opaque_maps_are_not_rewritten(self):
  source=Image.new('RGB',(8,8),(128,128,255))
  self.assertIs(materials.pad_normal_texture(source),source)

if __name__=='__main__':unittest.main()
