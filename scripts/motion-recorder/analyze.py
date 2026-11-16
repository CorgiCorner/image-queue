# analyze.py <rundir>: frame-by-frame check for dropped elements and flicker.
#  1. pixel transients: frames i..i+L-1 (L<=3) differ from both neighbours a=i-1 and b=i+L while a≈b
#     (an element vanishes or appears for 1-3 frames and comes back) -> FLICKER candidate
#  2. tile-level transients on a 16x10 grid, same rule per cell (catches small elements)
#  3. probe opacity reversals: an element's effective opacity changes direction within 6 frames
import sys, json, os
import numpy as np
from PIL import Image
d = sys.argv[1]
fr = sorted(f for f in os.listdir(os.path.join(d, 'frames')) if f.endswith('.png'))
arr = np.stack([np.asarray(Image.open(os.path.join(d, 'frames', f)).convert('L').resize((480, 300), Image.BILINEAR), dtype=np.float32) for f in fr])
n = len(arr)
def cells(x): return x.reshape(10, 30, 16, 30).mean(axis=(1, 3))
C = np.stack([cells(a) for a in arr])
issues = []
for L in (1, 2, 3):
    for i in range(1, n - L):
        a, b = i - 1, i + L
        base = np.abs(C[a] - C[b])
        mid = np.max(np.stack([np.abs(C[k] - C[a]) for k in range(i, i + L)]), axis=0)
        midb = np.max(np.stack([np.abs(C[k] - C[b]) for k in range(i, i + L)]), axis=0)
        hit = (base < 0.5) & (mid > 4) & (midb > 4)
        if hit.any():
            ys, xs = np.nonzero(hit)
            issues.append({'kind': 'transient', 'frames': [i, i + L - 1], 'L': L, 'cells': len(ys), 'maxDelta': round(float(mid[hit].max()), 1), 'where': [int(xs.min()) * 90, int(ys.min()) * 90, int(xs.max() + 1) * 90, int(ys.max() + 1) * 90]})
# probe opacity reversals
probes = json.load(open(os.path.join(d, 'probes.json')))
series = {}
for p in probes:
    for k, v in p['items'].items():
        if k.startswith('__'): continue
        series.setdefault(k, {})[p['frame']] = v[0]
for k, s in series.items():
    fs = sorted(s); prev_dir = 0; last_turn = -99; seq = [(f, s[f]) for f in fs]
    for j in range(1, len(seq)):
        if seq[j][0] != seq[j - 1][0] + 1: prev_dir = 0; continue
        dv = seq[j][1] - seq[j - 1][1]
        if abs(dv) < 0.01: continue
        dr = 1 if dv > 0 else -1
        if prev_dir and dr != prev_dir:
            if seq[j][0] - last_turn <= 6: issues.append({'kind': 'opacity-reversal', 'element': k[:60], 'frame': seq[j][0]})
            last_turn = seq[j][0]
        prev_dir = dr
    # appear/disappear blips in the probe list
    present = set(fs)
    for f in fs:
        if f + 1 not in present and any(g in present for g in range(f + 2, f + 5)): issues.append({'kind': 'probe-gap', 'element': k[:60], 'after': f})
diffs = [float(np.abs(arr[i] - arr[i - 1]).mean()) for i in range(1, n)]
moving = sum(1 for x in diffs if x > 0.05)
run = json.load(open(os.path.join(d, 'run.json')))
res = {'run': os.path.basename(d), 'frames': n, 'movingFrames': moving, 'error': run.get('error'), 'issues': issues}
json.dump(res, open(os.path.join(d, 'analysis.json'), 'w'), indent=1)
print(json.dumps({k: v for k, v in res.items() if k != 'issues'}), 'issues:', len(issues))
for x in issues[:40]: print('  ', x)
