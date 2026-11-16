import {mkdtemp,writeFile,chmod,rm} from 'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';import{expect,it}from'vitest';import{readCodexUsage}from'../src/storage/codex-usage';
it('reads official usage response and removes account fields',async()=>{
 const root=await mkdtemp(join(tmpdir(),'iq-usage-'));try{const executable=join(root,'server');await writeFile(executable,`#!/usr/bin/env python3
import sys,json
for line in sys.stdin:
 d=json.loads(line)
 if d.get('id')==1: print(json.dumps({'id':1,'result':{}}),flush=True)
 if d.get('id')==2: print(json.dumps({'id':2,'result':{'accountId':'private','ordinaryUsageAllowed':False,'rateLimits':{'primary':{'usedPercent':100,'resetsAt':2000000000}}}}),flush=True)
`);await chmod(executable,0o700);const usage=await readCodexUsage(executable,5000);expect(usage.state).toBe('exhausted');expect(JSON.stringify(usage)).not.toContain('private');}finally{await rm(root,{recursive:true,force:true});}
},10000);
it('returns unknown when the executable is unavailable',async()=>{expect((await readCodexUsage('/missing/codex',50)).state).toBe('unknown');});

it('bounds a silent usage process by timeout',async()=>{
 const root=await mkdtemp(join(tmpdir(),'iq-usage-timeout-'));try{const executable=join(root,'server');await writeFile(executable,'#!/bin/sh\nsleep 30\n');await chmod(executable,0o700);const started=Date.now();expect((await readCodexUsage(executable,30)).state).toBe('unknown');expect(Date.now()-started).toBeLessThan(2000);}finally{await rm(root,{recursive:true,force:true});}
});
