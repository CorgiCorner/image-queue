import {expect,it} from 'vitest';import{codexUsage}from'../src/core/codex-usage';
it('strips account details and reports available usage',()=>{const result=codexUsage({ordinaryUsageAllowed:true,accountId:'private',rateLimits:{primary:{usedPercent:56,resetsAt:200}}},0);expect(result.state).toBe('available');expect(JSON.stringify(result)).not.toContain('private');});
it('blocks exhausted windows until all relevant windows reset',()=>{expect(codexUsage({rateLimits:{primary:{usedPercent:100,resetsAt:200},secondary:{usedPercent:100,resetsAt:300}}},0)).toMatchObject({state:'exhausted',resetAt:new Date(300000).toISOString()});});
it('does not invent quota when the interface is unavailable',()=>{expect(codexUsage({error:'unsupported'},0).state).toBe('unknown');expect(codexUsage({ordinaryUsageAllowed:false,rateLimits:{}},0).state).toBe('exhausted');});

it('does not treat an empty successful response as available capacity',()=>{expect(codexUsage({rateLimits:{}},0).state).toBe('unknown');});
