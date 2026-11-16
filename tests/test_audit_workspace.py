import importlib.util,json,tempfile,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('audit',Path(__file__).parents[1]/'scripts/audit-workspace.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class AuditTests(unittest.TestCase):
 def test_reserved_claim_blocks_relocation_without_modifying_it(self):
  with tempfile.TemporaryDirectory() as t:
   r=Path(t);(r/'store').mkdir();d=r/'queue/out/.claims';d.mkdir(parents=True);p=d/'IMG-one.json';raw=json.dumps({'id':'IMG-one','state':'reserved'});p.write_text(raw)
   result=module.audit(r);self.assertFalse(result['noDetectedBlockers']);self.assertEqual(result['reservedJobIds'],['IMG-one']);self.assertEqual(p.read_text(),raw);self.assertEqual(result['modifiedFiles'],0)
 def test_empty_workspace_preflight(self):
  with tempfile.TemporaryDirectory() as t:
   r=Path(t);(r/'store').mkdir();(r/'queue').mkdir();self.assertTrue(module.audit(r)['noDetectedBlockers'])
if __name__=='__main__':unittest.main()
