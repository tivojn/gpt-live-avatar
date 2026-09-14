"""Blender: --background --factory-startup --python this.py -- original.exr output.rgba16f"""
import bpy, numpy as np, sys
from pathlib import Path

source, output = sys.argv[sys.argv.index('--') + 1:]
image = bpy.data.images.load(str(Path(source).resolve()))
image.scale(512, 256)
pixels = np.empty(512 * 256 * 4, dtype=np.float32)
image.pixels.foreach_get(pixels)
pixels = np.nan_to_num(pixels, nan=0, posinf=65504, neginf=0).clip(0, 65504)
Path(output).write_bytes(pixels.astype('<f2').tobytes())
