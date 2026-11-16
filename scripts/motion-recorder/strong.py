# strong.py <rundir...>: strong transients (delta >= 30 of 255) and opacity reversals, grouped
import sys, json, os
for d in sys.argv[1:]:
    a = json.load(open(os.path.join(d, 'analysis.json')))
    groups = []
    for x in a['issues']:
        if x['kind'] == 'transient' and x['maxDelta'] >= 30:
            f = x['frames'][0]
            if groups and f - groups[-1][1] <= 4: groups[-1][1] = max(groups[-1][1], x['frames'][1]); groups[-1][2] = max(groups[-1][2], x['maxDelta'])
            else: groups.append([f, x['frames'][1], x['maxDelta']])
    rev = [x for x in a['issues'] if x['kind'] != 'transient']
    print(a['run'], 'frames', a['frames'], 'strong groups', [(g[0], g[1], round(g[2])) for g in groups], 'other', [(x['kind'], x.get('element', '')[:30], x.get('frame', x.get('after'))) for x in rev][:8])
