#!/usr/bin/env python3
"""Read-only relocation preflight. Never rewrites queues, claims or project records."""
import argparse,json
from pathlib import Path

def audit(root:Path):
 root=root.resolve()
 if not (root/'store').is_dir() or not (root/'queue').is_dir():raise ValueError('Expected store and queue directories')
 claims=[];external=[];links=[]
 for p in root.rglob('*'):
  if p.is_symlink():links.append(str(p.relative_to(root)))
 for p in (root/'queue/out/.claims').glob('*.json'):
  data=json.loads(p.read_text())
  if data.get('state')=='reserved':claims.append(data.get('id',p.stem))
 for p in (root/'store/projects').glob('*.json'):
  data=json.loads(p.read_text());directory=data.get('directory')
  if directory:
   target=Path(directory).resolve()
   if root!=target and root not in target.parents:external.append(data.get('id',p.stem))
 return {'reservedJobIds':claims,'externalProjectIds':external,'symlinks':links,'noDetectedBlockers':not(claims or external or links),'protocolMigrationRequired':True,'queueProtocolMustBePreserved':True,'modifiedFiles':0}
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('root',type=Path);a=p.parse_args();print(json.dumps(audit(a.root),indent=2))
