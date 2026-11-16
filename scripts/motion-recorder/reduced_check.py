# reduced_check.py <rundir>: in reduced motion nothing may move or resize smoothly; fades at most 80 ms.
import sys, json, os, collections
p = json.load(open(os.path.join(sys.argv[1], 'probes.json')))
flight = max(f['items'].get('__flight', 0) for f in p)
moving = max(f['items'].get('__cardsMoving', 0) for f in p)
kinds = collections.Counter(); longfades = collections.Counter(); spatial = collections.Counter()
for f in p:
    for t, cls, props, dur, ct in f['items'].get('__animInfo', []):
        kinds[(t, cls, props, dur)] += 1
        if dur > 80 and 'spin' not in props: longfades[(t, cls, props, dur)] += 1
        if any(k in props for k in ('transform', 'height', 'width', 'grid-template-rows', 'translate', 'scale')) and dur > 0: spatial[(t, cls, props, dur)] += 1
print(os.path.basename(sys.argv[1]), 'flightMax', flight, 'cardsMovingMax', moving)
print('  >80ms:', dict(longfades))
print('  spatial:', dict(spatial))
# surfaces whose box or transform changes over consecutive frames (smooth motion) in reduced mode
series = collections.defaultdict(list)
for f in p:
    for k, v in f['items'].items():
        if k.startswith('__'): continue
        series[k].append((f['frame'], tuple(v[1:5]), v[5]))
smooth = {}
for k, s in series.items():
    runs = 0; best = 0
    for (f0, b0, t0), (f1, b1, t1) in zip(s, s[1:]):
        if f1 == f0 + 1 and (b0 != b1 or t0 != t1): runs += 1; best = max(best, runs)
        else: runs = 0
    if best >= 2: smooth[k[:50]] = best
print('  surfaces changing box/transform on 3+ consecutive frames:', smooth)
