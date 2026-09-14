"""Restore Tia's original color maps to an existing runtime package.

Usage: python tools/complete-tia-colors.py --textures <original textures> --package build/assets/bundle/tia
Restores colors and optionally the authored portrait maps and complete desktop texture tiers. Requires Pillow.
"""
import argparse, hashlib, json, re, shutil
from pathlib import Path
from PIL import Image

SPECS = [
    ('skin', 'Top_Tia01A_M', r'Top_(?:Pia01(?:D|E|E2|i1|M|N)|Ani01A_alb_(?:dark|med|nude))'),
    ('eyes', 'Hed_Eye_M', r'Hed_Eye_Alb_.*'),
    ('hair', 'Hed_Hair-21A_Ponytail02_M', r'(?:beach-blonde[35]|hair dark|Hed_Har01A_Alb_.*|Hed_Har02A_Alb_Pink02c)'),
    ('brows', 'Hed_Brow_M', r'Hed_Las01A_Alb_.*'),
    ('lashes', 'Hed_Las01_M', r'Hed_Las01A_Alb_.*'),
    ('coat', 'Top_Coat201_M', r'Coat_Collar_01_Alb_.*'),
    ('skirt', 'Bot_Pl-SkirtB07_M', r'Fem-A_Pl-Skirt(?:2_alb_.*|3-alb_.*)'),
    ('scarf', 'Top_Scarf01_Mi', r'Scarf_01_alb-.*'),
    ('dress', 'TnB_BDress01_M', r'belldress_alb_.*'),
    ('jeans', 'Jeans.001', r'(?:Jeans-.*|pants-woman-albedo3)'),
    ('top', 'Top_Tshi05_M', r'Tshi01_Alb_.*'),
    ('stockings', 'Bot_SokSho01_M', r'Sock_Pants_alb_.*'),
    ('bottoms', 'Bot_Pnty01_M', r'(?:Bot_pnty01_Alb_.*|Pant-2-diff-pink)'),
    ('boots', 'Fot_Ac_BootM01_M', r'Mid-boot-(?:07-.*|alb01)'),
    ('heels', 'Bot_StrpSho01_M', r'Heelstrap_alb_.*'),
    ('sneakers', 'Fot_Ac_Tshoe01_M', r'Sneakers01-alb-2(?:-.*)?'),
    ('pistol', 'Unica6', r'Unica6(?:_alb_(?:k2|light))?'),
]

def label(slot, stem):
    if slot == 'skin':
        return {'dark':'Dark', 'med':'Medium', 'nude':'Natural'}.get(stem.rsplit('_', 1)[-1], 'Original ' + stem.removeprefix('Top_Pia01'))
    if slot == 'hair':
        return {'beach-blonde3':'Beach blonde', 'beach-blonde5':'Golden blonde', 'hair dark':'Dark brown', 'Hed_Har01A_Alb_Brun02':'Brunette', 'Hed_Har01A_Alb_Orang01':'Copper', 'Hed_Har02A_Alb_Pink02c':'Pink'}[stem]
    tail = re.split(r'[-_]', stem)[-1]
    fixes = {'alb01':'Original brown', 'LACK':'Black', 'BROWN2':'Brown', 'albedo3':'Original blue', '2':'Original', 'Unica6':'Original', 'k2':'Dark', 'light':'Light', 'E':'E'}
    tail = fixes.get(tail, tail)
    for old, new in [('Brun','Brunette '), ('Blon','Blonde '), ('Hazl','Hazel '), ('Grey','Grey '), ('Blue','Blue '), ('Brn','Brown '), ('Drk','Dark '), ('Grn','Green '), ('Blk','Black '), ('Whi','White '), ('Wht','White '), ('blu','blue'), ('bur','burgundy'), ('grn','green'), ('blk','black'), ('bw','black & white')]:
        if tail.startswith(old): tail = new + tail[len(old):]; break
    return re.sub(r'(?<=[a-z])(?=\d)', ' ', tail).title()

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--textures', required=True, type=Path); p.add_argument('--package', required=True, type=Path)
    p.add_argument('--environment', type=Path, help='512 × 256 linear RGBA half-float environment converted from the original EXR')
    p.add_argument('--resident', type=Path, help='Matching original resident directory; include its 2K/4K tiers in the desktop package')
    a = p.parse_args(); resident = a.package / 'runtime/resident'
    doc = json.loads((resident / 'model.gltf').read_text())
    if a.resident:
        original = json.loads((a.resident / 'model.gltf').read_text())
        assert [i['uri'] for i in original['images']] == [i['uri'] for i in doc['images']], 'Texture indices belong to different model revisions'
        for image in doc['images']:
            for v in image.get('extras', {}).get('openclamVariants', []):
                if v['size'] <= 1024: continue
                for name in [v['uri'], v.get('compressed')]:
                    if name and (a.resident / name).exists(): shutil.copy2(a.resident / name, resident / name)
    packdir = a.package / 'appearance/tia-original'; packdir.mkdir(parents=True, exist_ok=True)
    items, files, sources = [], {}, []
    for slot, material, pattern in SPECS:
        mat = next(m for m in doc['materials'] if m['name'] == material)
        alpha = None
        ti = mat['pbrMetallicRoughness'].get('baseColorTexture', {}).get('index')
        if ti is not None and mat.get('alphaMode') in ['MASK', 'BLEND']:
            image = doc['images'][doc['textures'][ti]['source']]
            variants = [v['uri'] for v in image.get('extras', {}).get('openclamVariants', []) if (resident / v['uri']).exists()]
            base = Image.open(resident / (variants[-1] if variants else image['uri'])).convert('RGBA')
            alpha = base.getchannel('A')
        if slot == 'hair': alpha = Image.open(a.textures / 'Hed_Har01A_Alp_01.png').getchannel('A')
        matches = [x for x in sorted(a.textures.iterdir()) if x.suffix.lower() in ['.png', '.jpg', '.jpeg'] and re.fullmatch(pattern, x.stem, re.I)]
        assert matches, f'No source textures for {slot}'
        for source in matches:
            original = Image.open(source).convert('RGBA')
            im = original.copy(); im.thumbnail((2048, 2048), Image.Resampling.LANCZOS)
            if alpha is not None: im.putalpha(alpha.resize(im.size, Image.Resampling.LANCZOS))
            name = f'{slot}-{len(items):03}.png'; output = packdir / name; im.save(output, optimize=True)
            raw = output.read_bytes(); files[name] = {'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}
            items.append({'id': Path(name).stem, 'kind': 'texture', 'slot': slot, 'label': label(slot, source.stem), 'material': material, 'file': name})
            if max(original.size) > 2048:
                original.thumbnail((4096, 4096), Image.Resampling.LANCZOS)
                if alpha is not None:
                    # Use the authored full-resolution coverage mask, rather
                    # than enlarging the old 1K runtime mask for fine strands.
                    mask = Image.open(a.textures / 'Hed_Har01A_Alp_01.png').getchannel('A') if slot == 'hair' else alpha
                    original.putalpha(mask.resize(original.size, Image.Resampling.LANCZOS))
                high = f'{Path(name).stem}-4k.png'; original.save(packdir / high, optimize=True)
                raw = (packdir / high).read_bytes(); files[high] = {'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}
                items[-1]['originalFile'] = high
            sources.append({'file': name, 'source': source.name, 'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'material': material, 'alphaPreserved': alpha is not None})
    pack = {'id': 'tia-original', 'directory': 'tia-original', 'label': 'Tia · original colors', 'files': files, 'items': items}
    if a.environment:
        data = a.environment.read_bytes(); assert len(data) == 512 * 256 * 8
        (packdir / 'studio.rgba16f').write_bytes(data)
        files['studio.rgba16f'] = {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
        pack['environment'] = {'file': 'studio.rgba16f', 'width': 512, 'height': 256, 'rotation': -2.8938}
        # These maps use the same authored UVs as Tia's body material.
        for name, source in [('skin-ao.png', 'Top_Ani01A_AO_01.png'), ('skin-scatter.png', 'Top_Ani01A_sss_01.png')]:
            im = Image.open(a.textures / source).convert('RGB'); im.thumbnail((2048, 2048), Image.Resampling.LANCZOS)
            im.save(packdir / name, optimize=True); data = (packdir / name).read_bytes()
            files[name] = {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
        pack['portrait'] = {'skinAO': 'skin-ao.png', 'skinScatter': 'skin-scatter.png'}
    (a.package / 'appearance/index.json').write_text(json.dumps({'version': 1, 'packs': [pack]}, indent=1))
    (a.package / 'appearance/source-audit.json').write_text(json.dumps({'source': 'Tia-001.1_Blender.zip', 'items': sources}, indent=2))
    manifest = json.loads((a.package / 'manifest.json').read_text()); manifest['appearance'] = 'appearance/index.json'
    (a.package / 'manifest.json').write_text(json.dumps(manifest, indent=1))
    print(json.dumps({'colors': len(items), 'slots': len(SPECS), 'package': str(a.package)}))

if __name__ == '__main__': main()
