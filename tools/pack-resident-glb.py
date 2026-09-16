"""Pack a reviewed resident glTF into a standalone GLB without re-exporting meshes.

--fallback supplies unmodified resources when --source is a sparse staging overlay.
Texture variants stay in the resident package; the GLB embeds each full-size image.
"""
import argparse
import copy
import hashlib
import json
import mimetypes
import struct
from pathlib import Path


def pack(source, output, fallback=None):
    source, output = Path(source).resolve(), Path(output).resolve()
    if source.is_dir():
        source /= 'model.gltf'
    assert output != source
    roots = [source.parent]
    if fallback:
        roots.append(Path(fallback).resolve())
    document = copy.deepcopy(json.loads(source.read_text()))

    def resource(uri):
        path = Path(uri)
        if path.is_absolute() or '..' in path.parts or ':' in uri:
            raise ValueError('Expected a package-local resource: ' + uri)
        for root in roots:
            candidate = root / path
            if candidate.is_file():
                return candidate.read_bytes()
        raise FileNotFoundError(uri)

    # Only referenced accessors are packed. Old revisions can leave superseded
    # skin buffers and meshes in a resident overlay; they are not runtime data.
    mesh_ids = sorted({node['mesh'] for node in document['nodes'] if 'mesh' in node})
    mesh_remap = {old: new for new, old in enumerate(mesh_ids)}
    for node in document['nodes']:
        if 'mesh' in node:
            node['mesh'] = mesh_remap[node['mesh']]
    document['meshes'] = [document['meshes'][i] for i in mesh_ids]
    references = []
    for mesh in document['meshes']:
        mesh.get('extras', {}).pop('openclamDeferred', None)
        for primitive in mesh['primitives']:
            references.extend((primitive['attributes'], k) for k in primitive['attributes'])
            if 'indices' in primitive:
                references.append((primitive, 'indices'))
            for target in primitive.get('targets', []):
                references.extend((target, k) for k in target)
    for skin in document.get('skins', []):
        if 'inverseBindMatrices' in skin:
            references.append((skin, 'inverseBindMatrices'))
    for animation in document.get('animations', []):
        for sampler in animation['samplers']:
            references.extend([(sampler, 'input'), (sampler, 'output')])
    accessor_ids = sorted({container[key] for container, key in references})
    accessor_remap = {old: new for new, old in enumerate(accessor_ids)}
    for container, key in references:
        container[key] = accessor_remap[container[key]]
    document['accessors'] = [document['accessors'][i] for i in accessor_ids]

    view_containers = []
    for accessor in document['accessors']:
        if 'bufferView' in accessor:
            view_containers.append(accessor)
        view_containers.extend(value for value in accessor.get('sparse', {}).values()
                               if isinstance(value, dict) and 'bufferView' in value)
    for image in document.get('images', []):
        if 'bufferView' in image:
            view_containers.append(image)
    view_ids = sorted({container['bufferView'] for container in view_containers})
    view_remap = {old: new for new, old in enumerate(view_ids)}
    payload = bytearray()
    cache, views = {}, []
    for index in view_ids:
        view = copy.deepcopy(document['bufferViews'][index])
        source_buffer = view['buffer']
        if source_buffer not in cache:
            cache[source_buffer] = resource(document['buffers'][source_buffer]['uri'])
        start, size = view.get('byteOffset', 0), view['byteLength']
        block = cache[source_buffer][start:start + size]
        assert len(block) == size
        payload.extend(b'\0' * (-len(payload) % 4))
        view.update(buffer=0, byteOffset=len(payload))
        payload.extend(block)
        views.append(view)
    for container in view_containers:
        container['bufferView'] = view_remap[container['bufferView']]
    for image in document.get('images', []):
        image.get('extras', {}).pop('openclamVariants', None)
        if 'uri' not in image:
            continue
        uri = image.pop('uri')
        block = resource(uri)
        payload.extend(b'\0' * (-len(payload) % 4))
        image['bufferView'] = len(views)
        image['mimeType'] = mimetypes.guess_type(uri)[0] or 'application/octet-stream'
        views.append({'buffer': 0, 'byteOffset': len(payload), 'byteLength': len(block)})
        payload.extend(block)
    payload.extend(b'\0' * (-len(payload) % 4))
    document['bufferViews'] = views
    document['buffers'] = [{'byteLength': len(payload)}]
    document.get('extras', {}).pop('openclamResources', None)
    encoded = json.dumps(document, separators=(',', ':')).encode()
    encoded += b' ' * (-len(encoded) % 4)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open('wb') as stream:
        stream.write(struct.pack('<III', 0x46546C67, 2, 28 + len(encoded) + len(payload)))
        stream.write(struct.pack('<II', len(encoded), 0x4E4F534A))
        stream.write(encoded)
        stream.write(struct.pack('<II', len(payload), 0x004E4942))
        stream.write(payload)
    print(json.dumps({'output': str(output), 'bytes': output.stat().st_size,
                      'sourceSHA256': hashlib.sha256(source.read_bytes()).hexdigest(),
                      'accessors': len(document['accessors']), 'bufferViews': len(views),
                      'images': len(document.get('images', []))}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--fallback', type=Path)
    options = parser.parse_args()
    pack(options.source, options.output, options.fallback)
