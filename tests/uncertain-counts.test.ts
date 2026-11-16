import{expect,it}from'vitest';import{jobCounts}from'../src/core/workspace-state';import type{Job}from'../src/core/schema';
it('counts an old uncertain reservation as attention, not in progress',()=>{const j={status:'uncertain',source:'queue',claim:{owner:'old',reserved:true}} as Job;expect(jobCounts([j])).toMatchObject({active:0,attention:1,total:1});});
