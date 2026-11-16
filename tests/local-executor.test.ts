import {expect,it,vi} from 'vitest';
import {createLocalExecutor} from '../src/core/local-executor';
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
const result={blobKey:'a'.repeat(64),width:1024,height:1024,mime:'image/png' as const};
it('connects claim, durable prepare, generation and completion without model polling',async()=>{
 const events:string[]=[];const source={claim:vi.fn().mockResolvedValueOnce({job:{id:'one'},leaseId:'lease',expiresAt:''}).mockResolvedValue(null),heartbeat:vi.fn(async()=>{}),complete:vi.fn(async()=>{events.push('complete')}),fail:vi.fn(async()=>{})};
 const pool=createLocalExecutor({source,runnerId:'runner',capabilities:['codex-image'],generation:{prepare:async()=>{events.push('prepare')},generate:async()=>{events.push('generate');return result}},report:vi.fn()});
 pool.configure(1);await flush();expect(events).toEqual(['prepare','generate','complete']);expect(source.complete).toHaveBeenCalledWith('one','lease',result);expect(source.claim).toHaveBeenCalledTimes(2);pool.stop();
});
it('aborts generation after heartbeat failure and cannot publish a stale result',async()=>{
 const source={claim:vi.fn().mockResolvedValueOnce({job:{id:'one'},leaseId:'lease',expiresAt:''}).mockResolvedValue(null),heartbeat:vi.fn(async()=>{throw Error('expired')}),complete:vi.fn(async()=>{}),fail:vi.fn(async()=>{})};
 const pool=createLocalExecutor({source,runnerId:'runner',capabilities:['codex-image'],heartbeatMs:1,generation:{prepare:async()=>{},generate:async(_job,signal)=>{await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));return result;}},report:vi.fn()});
 pool.configure(1);await new Promise(resolve=>setTimeout(resolve,20));expect(source.fail).toHaveBeenCalledWith('one','lease',expect.objectContaining({uncertain:true}));expect(source.complete).not.toHaveBeenCalled();pool.stop();
});
it('does not claim a job when admission rejects generation',async()=>{
 const source={claim:vi.fn(),heartbeat:vi.fn(),complete:vi.fn(),fail:vi.fn()};
 const pool=createLocalExecutor({source,runnerId:'runner',capabilities:['codex-image'],beforeClaim:async()=>{throw Error('limit')},generation:{prepare:vi.fn(),generate:vi.fn()},report:vi.fn()});
 pool.configure(1);await flush();expect(source.claim).not.toHaveBeenCalled();expect(pool.blockedReason).toBeTruthy();pool.stop();
});

it('does not start usage inspection or claim when no pending work exists',async()=>{
 const source={claim:vi.fn(),heartbeat:vi.fn(),complete:vi.fn(),fail:vi.fn()};const beforeClaim=vi.fn();
 const pool=createLocalExecutor({source,runnerId:'runner',capabilities:['codex-image'],hasPending:async()=>false,beforeClaim,generation:{prepare:vi.fn(),generate:vi.fn()},report:vi.fn()});pool.configure(1);await flush();expect(beforeClaim).not.toHaveBeenCalled();expect(source.claim).not.toHaveBeenCalled();pool.stop();
});

it('honors pause while the usage preflight is still pending',async()=>{
 let release!:()=>void;const source={claim:vi.fn(),heartbeat:vi.fn(),complete:vi.fn(),fail:vi.fn()};
 const pool=createLocalExecutor({source,runnerId:'runner',capabilities:['codex-image'],beforeClaim:()=>new Promise<void>(r=>{release=r}),generation:{prepare:vi.fn(),generate:vi.fn()},report:vi.fn()});pool.configure(1);await flush();pool.configure(0);release();await flush();expect(source.claim).not.toHaveBeenCalled();pool.stop();
});

it('preserves safe generation failure details in the job and identifies the stopped job',async()=>{
 const {UserFacingError}=await import('../src/core/user-facing-error');
 const source={claim:vi.fn().mockResolvedValueOnce({job:{id:'one'},leaseId:'lease',expiresAt:''}).mockResolvedValue(null),heartbeat:vi.fn(),complete:vi.fn(),fail:vi.fn()};
 const blocked=vi.fn();
 const pool=createLocalExecutor({source,runnerId:'local',capabilities:['codex-image'],generation:{prepare:vi.fn(),generate:async()=>{throw new UserFacingError('Codex is not signed in.')}},report:vi.fn(),blocked});
 pool.configure(1);await flush();
 expect(source.fail).toHaveBeenCalledWith('one','lease',expect.objectContaining({message:'Codex is not signed in.',uncertain:true}));
 expect(blocked).toHaveBeenCalledWith('Codex is not signed in.','generation','one');pool.stop();
});
