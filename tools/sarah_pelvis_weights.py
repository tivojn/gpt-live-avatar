"""Preserve Sarah's authored pelvis support in deform-only exports."""
import json
import struct
from pathlib import Path

MARKER = {
    'version': 1,
    'source': 'Authored c_root_bend.x restored to deform root.x',
    'preserveGusset': False,
    'bodyRestGeometryChanged': False,
}

def mark_glb(path):
    """Set provenance after Blender export without modifying its binary chunk."""
    path = Path(path)
    raw = path.read_bytes()
    magic, version, length = struct.unpack_from('<III', raw)
    assert magic == 0x46546C67 and version == 2 and length == len(raw)
    json_length, json_type = struct.unpack_from('<II', raw, 12)
    assert json_type == 0x4E4F534A
    document = json.loads(raw[20:20 + json_length])
    document.setdefault('extras', {})['avatarSarahPelvisWeights'] = dict(MARKER)
    encoded = json.dumps(document, separators=(',', ':')).encode()
    encoded += b' ' * (-len(encoded) % 4)
    tail = raw[20 + json_length:]
    path.write_bytes(struct.pack('<III', magic, version, 20 + len(encoded) + len(tail))
                    + struct.pack('<II', len(encoded), json_type) + encoded + tail)
