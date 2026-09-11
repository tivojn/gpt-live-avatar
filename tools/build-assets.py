"""Build the distributable avatar assets.

  bundle/<slug>/            resource-friendly package shipped inside the apps
                            (512/1024 textures, meshes, rig, deflated motions)
  tiers/<slug>-balanced.zip 2K textures     } downloaded on demand from the
  tiers/<slug>-best.zip     4K textures     } GitHub release
  ios/<slug>-1k.glb         bundled in the iOS app
  ios/<slug>-2k.glb, -4k.glb                downloaded on demand
  index.json                catalogue with sizes and checksums

Run: uv run --with pillow tools/build-assets.py <openclam avatar dir> [slug]
"""
import hashlib, io, json, os, shutil, struct, sys, zipfile, zlib
from pathlib import Path
from PIL import Image

SRC = Path(sys.argv[1]).expanduser()
SLUG = sys.argv[2] if len(sys.argv) > 2 else "tia"
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "build" / "assets"
BUNDLE = OUT / "bundle" / SLUG
TIERS = OUT / "tiers"; IOS = OUT / "ios"
for d in (BUNDLE, TIERS, IOS): d.mkdir(parents=True, exist_ok=True)

def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""): h.update(chunk)
    return h.hexdigest()

def size_of(name):  # image-<index>-<size>.<ext> -> size
    parts = name.split("-")
    return int(parts[2].split(".")[0]) if name.startswith("image-") and len(parts) >= 3 else None

# ---- manifest (only what the apps read)
manifest = json.loads((SRC / "manifest.json").read_text())
keep = {k: manifest[k] for k in ("slug", "name", "renderer", "model", "pose", "yaw", "visemes", "layout", "joint_count", "target_count") if k in manifest}
keep["slug"] = SLUG; keep["tiers"] = {"bundled": [512, 1024], "balanced": [2048], "best": [4096]}
(BUNDLE / "manifest.json").write_text(json.dumps(keep, indent=1))
if (SRC / "keyframe.png").exists(): shutil.copy2(SRC / "keyframe.png", BUNDLE / "keyframe.png")

# ---- resident model: meshes, rig, gltf, small textures
resident = SRC / "runtime" / "resident"; dst = BUNDLE / "runtime" / "resident"; dst.mkdir(parents=True, exist_ok=True)
for f in resident.iterdir():
    s = size_of(f.name)
    if s is None or s <= 1024: shutil.copy2(f, dst / f.name)

# ---- motions: raw-deflate every clip (the apps inflate on the fly)
motions = SRC / "runtime" / "motions"; mdst = BUNDLE / "runtime" / "motions"; mdst.mkdir(parents=True, exist_ok=True)
shutil.copy2(motions / "library.json", mdst / "library.json")
for f in motions.glob("*.json"):
    if f.name == "library.json": continue
    raw = f.read_bytes()
    comp = zlib.compressobj(9, zlib.DEFLATED, -15); data = comp.compress(raw) + comp.flush()
    (mdst / (f.name + ".deflate")).write_bytes(data)

# ---- download tiers
def build_tier(name, sizes):
    path = TIERS / f"{SLUG}-{name}.zip"
    with zipfile.ZipFile(path, "w", zipfile.ZIP_STORED) as z:
        for f in sorted(resident.iterdir()):
            if size_of(f.name) in sizes: z.write(f, f"runtime/resident/{f.name}")
    return path
tier_paths = {"balanced": build_tier("balanced", {2048}), "best": build_tier("best", {4096})}
BUNDLED_SLUGS = {"tia"}
if SLUG not in BUNDLED_SLUGS:
    # Non-bundled avatars: the friendly package itself is the "base" download.
    base = TIERS / f"{SLUG}-base.zip"
    with zipfile.ZipFile(base, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(BUNDLE.rglob("*")):
            if f.is_file(): z.write(f, str(f.relative_to(BUNDLE)))
    tier_paths = {"base": base, **tier_paths}

# ---- iOS GLBs
def shrink_glb(src, dst, limit):
    data = src.read_bytes()
    magic, version, length, jlen, jtype = struct.unpack_from("<IIIII", data, 0)
    doc = json.loads(data[20:20 + jlen]); blen, btype = struct.unpack_from("<II", data, 20 + jlen)
    bin_data = data[28 + jlen:28 + jlen + blen]; views = doc["bufferViews"]
    image_views = {img["bufferView"]: i for i, img in enumerate(doc.get("images", [])) if "bufferView" in img}
    new_bin = bytearray()
    for vi, view in enumerate(views):
        off = view.get("byteOffset", 0); n = view["byteLength"]; chunk = bin_data[off:off + n]
        if vi in image_views:
            img = Image.open(io.BytesIO(chunk)); w, h = img.size
            if max(w, h) > limit:
                scale = limit / max(w, h)
                resized = img.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
                out = io.BytesIO(); mime = doc["images"][image_views[vi]].get("mimeType", "image/png")
                if mime == "image/jpeg" and resized.mode in ("RGB", "L"): resized.save(out, "JPEG", quality=92)
                elif mime == "image/webp": resized.save(out, "WEBP", quality=92)
                else: doc["images"][image_views[vi]]["mimeType"] = "image/png"; resized.save(out, "PNG")
                chunk = out.getvalue()
        while len(new_bin) % 4: new_bin.append(0)
        view["byteOffset"] = len(new_bin); view["byteLength"] = len(chunk); new_bin += chunk
    while len(new_bin) % 4: new_bin.append(0)
    doc["buffers"][0]["byteLength"] = len(new_bin)
    jbytes = json.dumps(doc, separators=(",", ":")).encode()
    while len(jbytes) % 4: jbytes += b" "
    total = 12 + 8 + len(jbytes) + 8 + len(new_bin)
    with open(dst, "wb") as f:
        f.write(struct.pack("<III", magic, version, total)); f.write(struct.pack("<II", len(jbytes), jtype)); f.write(jbytes)
        f.write(struct.pack("<II", len(new_bin), 0x004E4942)); f.write(new_bin)

source_glb = SRC / manifest["model"]
ios_paths = {}
for tier, limit in (("1k", 1024), ("2k", 2048)):
    p = IOS / f"{SLUG}-{tier}.glb"
    if not p.exists(): shrink_glb(source_glb, p, limit)
    ios_paths[tier] = p
p4 = IOS / f"{SLUG}-4k.glb"
if not p4.exists(): shutil.copy2(source_glb, p4)
ios_paths["4k"] = p4

# ---- catalogue
index_path = OUT / "index.json"
index = json.loads(index_path.read_text()) if index_path.exists() else {"version": 1, "avatars": {}}
entry = {"name": keep.get("name", SLUG), "bundledMac": SLUG in BUNDLED_SLUGS, "bundledIOS": SLUG in BUNDLED_SLUGS,
         "mac": {t: {"file": p.name, "bytes": p.stat().st_size, "sha256": sha256(p)} for t, p in tier_paths.items()},
         "ios": {t: {"file": p.name, "bytes": p.stat().st_size, "sha256": sha256(p)} for t, p in ios_paths.items()}}
index["avatars"][SLUG] = entry
index_path.write_text(json.dumps(index, indent=1))
def du(p): return sum(f.stat().st_size for f in Path(p).rglob("*") if f.is_file()) / 1e6
print(f"bundle {SLUG}: {du(BUNDLE):.0f} MB; tiers:", {t: round(p.stat().st_size / 1e6) for t, p in tier_paths.items()}, "ios:", {t: round(p.stat().st_size / 1e6) for t, p in ios_paths.items()})
