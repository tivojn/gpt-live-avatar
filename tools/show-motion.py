#!/usr/bin/env python3
"""Avatar Show motion pipeline: one custom motion from a text prompt to every
character's installed library. Driven by electron/show-motions.cjs; each
subcommand prints one JSON result line (prefixed with RESULT) and progress
lines (prefixed with PROGRESS) on stdout.

  generate  --id ID --prompt TEXT --duration SEC --out DIR
            Meshy text-to-motion -> animation retarget onto the preset rig ->
            download glb/fbx. Needs MESHY_API_KEY and MESHY_RIG_TASK_ID.
  facing    --glb FILE --blender PATH
            Hip-yaw gate: desk avatars perform toward the user, so a clip that
            turns more than 60 degrees is rejected before any retargeting.
  retarget  --id ID --fbx FILE --out DIR --blender PATH --blend FILE --model FILE
            tools/retarget-meshy-motion.py --preset, headless Blender.
  integrate --clip FILE --label TEXT --characters DIR --slugs a,b [--aliases ..]
            [--expression JSON] [--reactions ..] [--free-hands] [--revision TAG]
            Writes ID.json.deflate and the library entry for every slug
            (other characters are retargeted from the donor's resident model).
            Run under uv with numpy and pillow; needs tools/prepare-character.py.
"""
import argparse, hashlib, importlib.util, json, os, pathlib, shutil, subprocess, sys, tempfile, time, urllib.error, urllib.request, zlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
FAIL_DEG = 60


def progress(**fields):
    print('PROGRESS ' + json.dumps(fields), flush=True)


def result(**fields):
    print('RESULT ' + json.dumps(fields), flush=True)


def fail(message, **fields):
    result(ok=False, error=str(message)[:600], **fields)
    sys.exit(1)


# ------------------------------------------------------------------ Meshy
def meshy(route, body=None, key=''):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request('https://api.meshy.ai/openapi/v1/' + route, data=data,
                                 headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        raise RuntimeError('Meshy HTTP %s %s' % (e.code, e.read().decode(errors='replace')[:300])) from None


def wait_task(route, key, label, timeout=900):
    started = time.monotonic()
    while True:
        d = meshy(route, key=key)
        status = d.get('status')
        progress(step=label, status=status, percent=d.get('progress'))
        if status == 'SUCCEEDED':
            return d
        if status in ('FAILED', 'CANCELED'):
            raise RuntimeError('%s %s: %s' % (label, status.lower(), d.get('task_error')))
        if time.monotonic() - started > timeout:
            raise RuntimeError(label + ' timed out')
        time.sleep(5)


def cmd_generate(a):
    key = os.environ.get('MESHY_API_KEY', '').strip()
    rig = os.environ.get('MESHY_RIG_TASK_ID', '').strip()
    if not key or not rig:
        fail('Meshy is not configured (MESHY_API_KEY and MESHY_RIG_TASK_ID).')
    out = pathlib.Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    try:
        motion = meshy('text-to-motion', {'prompt': a.prompt, 'duration': float(a.duration), 'mode': 'prime'}, key)['result']
        progress(step='motion', status='submitted', task=motion)
        wait_task('text-to-motion/' + motion, key, 'motion')
        anim = meshy('animations', {'rig_task_id': rig, 'motion_task_id': motion}, key)['result']
        progress(step='animation', status='submitted', task=anim)
        done = wait_task('animations/' + anim, key, 'animation')
        files = {}
        for ext, field in (('glb', 'animation_glb_url'), ('fbx', 'animation_fbx_url')):
            url = done['result'].get(field, '')
            if url:
                dest = out / (a.id + '.' + ext)
                urllib.request.urlretrieve(url, dest)
                files[ext] = str(dest)
                progress(step='download', status=ext, bytes=dest.stat().st_size)
        if 'fbx' not in files or 'glb' not in files:
            raise RuntimeError('Meshy returned no animation files.')
        result(ok=True, id=a.id, motionTask=motion, animationTask=anim, **files)
    except Exception as e:  # noqa: BLE001 - reported to the app
        fail(e)


# ------------------------------------------------------------ Blender steps
def blender(a, script, args, log):
    cmd = [a.blender, '--factory-startup', '--python-exit-code', '1', '-b', '--python', str(script), '--', *args]
    with open(log, 'w') as handle:
        code = subprocess.run(cmd, stdout=handle, stderr=subprocess.STDOUT).returncode
    return code


def cmd_facing(a):
    report = pathlib.Path(tempfile.mkdtemp()) / 'facing.json'
    log = pathlib.Path(a.glb).with_suffix('.facing.log')
    code = blender(a, ROOT / 'tools' / 'show-motion-facing.py', ['--glb', a.glb, '--report', str(report)], log)
    if code or not report.exists():
        fail('The facing check did not run (Blender exit %s). See %s' % (code, log))
    d = json.loads(report.read_text())
    if d.get('error'):
        fail(d['error'])
    result(ok=True, maxDeg=d['maxDeg'], overLimit=d['overLimit'], samples=d['samples'], passed=d['maxDeg'] <= FAIL_DEG, limit=FAIL_DEG)


def cmd_retarget(a):
    out = pathlib.Path(a.out)
    (out / 'qa').mkdir(parents=True, exist_ok=True)
    (out / 'logs').mkdir(exist_ok=True)
    dest = out / (a.id + '.json')
    if dest.exists():
        dest.unlink()
    args = ['--blend', a.blend, '--model', a.model, '--motion', a.fbx, '--output', str(dest), '--qa-output', str(out / 'qa' / (a.id + '.json')), '--name', a.id, '--preset']
    if a.frame_start is not None:
        args += ['--frame-start', str(a.frame_start)]
    if a.frame_end is not None:
        args += ['--frame-end', str(a.frame_end)]
    log = out / 'logs' / (a.id + '.log')
    started = time.monotonic()
    code = blender(a, ROOT / 'tools' / 'retarget-meshy-motion.py', args, log)
    if code or not dest.exists():
        fail('Retargeting failed (Blender exit %s). See %s' % (code, log))
    d = json.loads(dest.read_text())
    frames = len(d.get('frames', []))
    if frames < 2 or frames > 900:
        fail('The retargeted clip has %d frames; the runtime accepts 2 to 900.' % frames)
    result(ok=True, id=a.id, clip=str(dest), frames=frames, fps=d.get('fps'), seconds=round((frames - 1) / d.get('fps', 30), 2), retargetVersion=d.get('retargeting', {}).get('version'), elapsed=round(time.monotonic() - started, 1))


# ---------------------------------------------------------------- Library
def cmd_integrate(a):
    spec = importlib.util.spec_from_file_location('prepare', ROOT / 'tools' / 'prepare-character.py')
    prepare = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(prepare)
    clip = json.loads(pathlib.Path(a.clip).read_text())
    cid = clip['id']
    characters = pathlib.Path(a.characters)
    slugs = [s for s in a.slugs.split(',') if s]
    donor_slug = a.donor
    donor_dir = characters / donor_slug
    if not (donor_dir / 'runtime' / 'resident' / 'model.gltf').exists():
        fail('The donor character %s has no resident model.' % donor_slug)
    donor = json.loads((donor_dir / 'runtime' / 'resident' / 'model.gltf').read_text())
    expression = json.loads(a.expression) if a.expression else {}
    expression = {k: min(1.0, float(v)) for k, v in expression.items() if k in ('smile', 'sad', 'surprise', 'anger') and float(v) > 0}
    aliases = [x for x in (a.aliases or '').split('|') if x]
    reactions = [x for x in (a.reactions or '').split(',') if x]
    clip['label'] = a.label
    written = []
    for slug in slugs:
        source = characters / slug
        dest = source / 'runtime' / 'motions'
        library_path = dest / 'library.json'
        if not library_path.exists():
            fail('No motion library for %s.' % slug)
        lib = json.loads(library_path.read_text())
        entry = next((e for e in lib['clips'] if e['id'] == cid), None)
        if entry is None:
            if len(lib['clips']) >= 96:
                fail('%s already has 96 motions; remove one before adding %s.' % (slug, cid))
            entry = {'id': cid}
            lib['clips'].append(entry)
        backup = pathlib.Path(a.backup) / slug if a.backup else None
        if backup:
            backup.mkdir(parents=True, exist_ok=True)
            shutil.copy2(library_path, backup / ('library-%s.json' % time.strftime('%Y%m%d-%H%M%S')))
        before = hashlib.sha256((source / 'model.glb').read_bytes()).hexdigest()
        target = clip if slug == donor_slug else prepare.Retarget(donor, prepare.glb.read_glb(source / 'model.glb')[0]).clip(clip)
        raw = json.dumps(target, separators=(',', ':')).encode()
        packer = zlib.compressobj(9, zlib.DEFLATED, -15)
        (dest / (cid + '.json.deflate')).write_bytes(packer.compress(raw) + packer.flush())
        (dest / (cid + '.json')).unlink(missing_ok=True)
        entry.update(label=a.label, file=cid + '.json', category=a.category, aliases=aliases, reactions=reactions, requiresFreeHands=bool(a.free_hands),
                     source=a.source, duration=round((len(clip['frames']) - 1) / clip['fps'], 3), retargetVersion=clip.get('retargeting', {}).get('version'), textToMotion=True)
        if expression:
            entry['expression'] = expression
        else:
            entry.pop('expression', None)
        lib['motionRevision'] = a.revision
        library_path.write_text(json.dumps(lib, indent=2))
        assert hashlib.sha256((source / 'model.glb').read_bytes()).hexdigest() == before
        written.append({'slug': slug, 'clips': len(lib['clips'])})
        progress(step='integrate', status=slug, clips=len(lib['clips']))
    result(ok=True, id=cid, characters=written, revision=a.revision)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest='command', required=True)
    g = sub.add_parser('generate')
    g.add_argument('--id', required=True)
    g.add_argument('--prompt', required=True)
    g.add_argument('--duration', type=float, default=4.0)
    g.add_argument('--out', required=True)
    f = sub.add_parser('facing')
    f.add_argument('--glb', required=True)
    f.add_argument('--blender', required=True)
    r = sub.add_parser('retarget')
    for key in ('id', 'fbx', 'out', 'blender', 'blend', 'model'):
        r.add_argument('--' + key, required=True)
    r.add_argument('--frame-start', type=int)
    r.add_argument('--frame-end', type=int)
    i = sub.add_parser('integrate')
    for key in ('clip', 'label', 'characters', 'slugs'):
        i.add_argument('--' + key, required=True)
    i.add_argument('--donor', default='tia')
    i.add_argument('--aliases', default='')
    i.add_argument('--expression', default='')
    i.add_argument('--reactions', default='')
    i.add_argument('--free-hands', action='store_true')
    i.add_argument('--category', default='Show')
    i.add_argument('--revision', default='show-' + time.strftime('%Y%m%d-%H%M%S'))
    i.add_argument('--source', default='Meshy text-to-motion (Avatar Show Director), retargeted with anatomical pelvis alignment and original movement')
    i.add_argument('--backup', default='')
    a = p.parse_args()
    {'generate': cmd_generate, 'facing': cmd_facing, 'retarget': cmd_retarget, 'integrate': cmd_integrate}[a.command](a)


if __name__ == '__main__':
    main()
