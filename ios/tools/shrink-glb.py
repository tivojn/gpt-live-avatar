"""Re-encode a GLB's embedded textures at a maximum edge length, rewriting
the binary chunk so the file stays a single self-contained .glb."""
import io, json, struct, sys
from PIL import Image
src, dst, limit = sys.argv[1], sys.argv[2], int(sys.argv[3])
data = open(src, 'rb').read()
magic, version, length, jlen, jtype = struct.unpack_from('<IIIII', data, 0)
assert magic == 0x46546C67 and jtype == 0x4E4F534A
doc = json.loads(data[20:20 + jlen])
blen, btype = struct.unpack_from('<II', data, 20 + jlen)
assert btype == 0x004E4942
bin_start = 28 + jlen
bin_data = data[bin_start:bin_start + blen]
views = doc['bufferViews']
image_views = {img['bufferView']: i for i, img in enumerate(doc.get('images', [])) if 'bufferView' in img}
new_bin = bytearray(); saved = 0
for vi, view in enumerate(views):
    off = view.get('byteOffset', 0); n = view['byteLength']
    chunk = bin_data[off:off + n]
    if vi in image_views:
        img = Image.open(io.BytesIO(chunk)); w, h = img.size
        if max(w, h) > limit:
            scale = limit / max(w, h)
            resized = img.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
            out = io.BytesIO()
            mime = doc['images'][image_views[vi]].get('mimeType', 'image/png')
            if mime == 'image/jpeg' and resized.mode in ('RGB', 'L'): resized.save(out, 'JPEG', quality=92)
            elif mime == 'image/webp': resized.save(out, 'WEBP', quality=92, lossless=False); 
            else:
                doc['images'][image_views[vi]]['mimeType'] = 'image/png'; resized.save(out, 'PNG', optimize=False)
            new_chunk = out.getvalue(); saved += len(chunk) - len(new_chunk); chunk = new_chunk
    while len(new_bin) % 4: new_bin.append(0)
    view['byteOffset'] = len(new_bin); view['byteLength'] = len(chunk)
    new_bin += chunk
while len(new_bin) % 4: new_bin.append(0)
doc['buffers'][0]['byteLength'] = len(new_bin)
jbytes = json.dumps(doc, separators=(',', ':')).encode()
while len(jbytes) % 4: jbytes += b' '
total = 12 + 8 + len(jbytes) + 8 + len(new_bin)
with open(dst, 'wb') as f:
    f.write(struct.pack('<III', magic, 2, total)); f.write(struct.pack('<II', len(jbytes), 0x4E4F534A)); f.write(jbytes)
    f.write(struct.pack('<II', len(new_bin), 0x004E4942)); f.write(new_bin)
print(f'{src}: {len(data)} -> {total} bytes (textures saved {saved})')
