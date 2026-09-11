"""Embed the `openclamAvatar` options library the renderer requires into a GLB.

The library lists every skin joint (so the motion clips and pose system can
bind to the rig) and carries empty pose/outfit/prop catalogues. Usage:
  python3 tools/inject-library.py in.glb out.glb
"""
import json, math, struct, sys

def wardrobe_nodes(wardrobe, key, oid):
    return next((o.get("nodes", []) for o in wardrobe.get(key, []) if o.get("id") == oid), [])

def trs_matrix(node):
    t = node.get("translation", [0, 0, 0]); q = node.get("rotation", [0, 0, 0, 1]); s = node.get("scale", [1, 1, 1])
    x, y, z, w = q
    r = [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
         [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
         [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]
    m = [[r[i][j] * s[j] for j in range(3)] + [t[i]] for i in range(3)] + [[0, 0, 0, 1]]
    if "matrix" in node:  # column-major glTF matrix -> rows
        c = node["matrix"]; m = [[c[j * 4 + i] for j in range(4)] for i in range(4)]
    return m

import argparse
ap = argparse.ArgumentParser()
ap.add_argument("src"); ap.add_argument("dst")
ap.add_argument("clip", nargs="?", help="motion clip JSON whose bone list defines the driven rig subset")
ap.add_argument("--poses-from", help="GLB whose openclamAvatar poses are copied (same rig family)")
ap.add_argument("--outfits", help="JSON file: {defaultOutfit, outfits:[{id,label,nodes}], props:[...]}")
args = ap.parse_args()
src, dst = args.src, args.dst
# The motion runtime requires the library's bone set to equal the clip's.
driven = set(json.load(open(args.clip))["bones"]) if args.clip else None
data = open(src, "rb").read()
magic, version, length, jlen, jtype = struct.unpack_from("<IIIII", data, 0)
doc = json.loads(data[20:20 + jlen]); rest = data[20 + jlen:]
joints = set()
for skin in doc.get("skins", []): joints.update(skin.get("joints", []))
library = {"version": 1, "rest": {}, "poses": [], "outfits": [], "props": []}
names = set()
for index in sorted(joints):
    node = doc["nodes"][index]; name = node.get("name", f"joint{index}")
    names.add(name)
    if driven is None or name in driven: library["rest"][name] = trs_matrix(node)
if driven is not None and driven - names:
    raise SystemExit(f"rig is missing driven bones: {sorted(driven - names)[:10]}")
if args.poses_from:
    # Authored poses are bone rotation deltas; a rig with the same bone names
    # (Tia's Auto-Rig Pro family) can wear them directly.
    other = open(args.poses_from, "rb").read(); ojlen = struct.unpack_from("<I", other, 12)[0]
    olib = json.loads(other[20:20 + ojlen]).get("extras", {}).get("openclamAvatar", {})
    have = set(library["rest"])
    library["poses"] = [p for p in olib.get("poses", []) if set(p.get("deltas", {})).issubset(have)]
    if olib.get("playback"): library["playback"] = olib["playback"]
    print(f"poses copied: {len(library['poses'])} of {len(olib.get('poses', []))}")
if args.outfits:
    wardrobe = json.load(open(args.outfits))
    names = {n.get("name") for n in doc["nodes"]}
    for key in ("outfits", "props"):
        library[key] = [{**o, "nodes": [n for n in o.get("nodes", []) if n in names]} for o in wardrobe.get(key, [])]
        for o in library[key]:
            missing = [n for n in wardrobe_nodes(wardrobe, key, o["id"]) if n not in names]
            if missing: print(f"warning: {key} {o['id']} missing nodes {missing}")
    if wardrobe.get("defaultOutfit"): library["defaultOutfit"] = wardrobe["defaultOutfit"]
doc.setdefault("extras", {})["openclamAvatar"] = library
# Material fix-ups the Blender exporter cannot express: the cornea shell is a
# clear, slightly glossy layer over the iris, not an opaque white cap.
for material in doc.get("materials", []):
    if material.get("name", "").startswith("Hed_clr"):
        material["alphaMode"] = "BLEND"
        material["doubleSided"] = False
        pbr = material.setdefault("pbrMetallicRoughness", {})
        pbr["baseColorFactor"] = [1, 1, 1, 0.06]; pbr["metallicFactor"] = 0; pbr["roughnessFactor"] = 0.05
        pbr.pop("baseColorTexture", None)
jbytes = json.dumps(doc, separators=(",", ":")).encode()
while len(jbytes) % 4: jbytes += b" "
with open(dst, "wb") as f:
    f.write(struct.pack("<III", magic, version, 12 + 8 + len(jbytes) + len(rest)))
    f.write(struct.pack("<II", len(jbytes), jtype)); f.write(jbytes); f.write(rest)
print(f"{dst}: {len(joints)} joints in library")

# ---- unweighted vertices: the exporter binds them to a "neutral_bone" that the
# motion clips never move, which stretches them into spikes during root motion.
# Rebind those entries to the rig root so they travel with the body.
try:
    import numpy as np
    data = bytearray(open(dst, "rb").read())
    jlen = struct.unpack_from("<I", data, 12)[0]; doc = json.loads(data[20:20 + jlen]); bstart = 28 + jlen
    nodes = doc["nodes"]; fixed = 0
    for node in nodes:
        if "mesh" not in node or "skin" not in node: continue
        joints = doc["skins"][node["skin"]]["joints"]; names = [nodes[j].get("name", "") for j in joints]
        if "neutral_bone" not in names or "root.x" not in names: continue
        neutral, root = names.index("neutral_bone"), names.index("root.x")
        for prim in doc["meshes"][node["mesh"]]["primitives"]:
            if "JOINTS_0" not in prim["attributes"]: continue
            a = doc["accessors"][prim["attributes"]["JOINTS_0"]]; v = doc["bufferViews"][a["bufferView"]]
            off = bstart + v.get("byteOffset", 0) + a.get("byteOffset", 0)
            ctype = {5121: np.uint8, 5123: np.uint16}[a["componentType"]]
            J = np.frombuffer(data, dtype=ctype, count=a["count"] * 4, offset=off).copy()
            hits = J == neutral
            if hits.any(): J[hits] = root; data[off:off + J.nbytes] = J.tobytes(); fixed += int(hits.sum())
    open(dst, "wb").write(data)
    print(f"{dst}: rebound {fixed} joint entries from neutral_bone to root.x")
except ImportError:
    print("numpy unavailable: unweighted vertices left on neutral_bone")
