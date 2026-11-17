import {expect,it,vi} from 'vitest';
import {LocalWorkerPool} from '../src/core/local-worker-pool';
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
function setup() {
 const queued=[{id:'a'},{id:'b'},{id:'c'}];const release=new Map<string,()=>void>();const events:string[]=[];
 const ports={claim:vi.fn(async()=>queued.shift()),begin:vi.fn(async(j:{id:string})=>{events.push('begin:'+j.id)}),execute:vi.fn(async(j:{id:string},s:AbortSignal)=>{events.push('execute:'+j.id);await new Promise<void>((resolve,reject)=>{release.set(j.id,resolve);s.addEventListener('abort',()=>reject(Error('cancelled')),{once:true})})}),complete:vi.fn(async()=>{}),uncertain:vi.fn(async()=>{}),report:vi.fn()};
 return {pool:new LocalWorkerPool(ports),ports,queued,release,events};
}
it('bounds concurrency and records attempts before executing; pause drains',async()=>{
 const x=setup();x.pool.configure(2);await flush();expect(x.pool.running).toBe(2);expect(x.events).toEqual(['begin:a','execute:a','begin:b','execute:b']);
 x.pool.configure(0);x.release.get('a')!();x.release.get('b')!();await flush();expect(x.pool.running).toBe(0);expect(x.queued).toEqual([{id:'c'}]);expect(x.ports.complete).toHaveBeenCalledTimes(2);x.pool.stop();
});
it('does no work while paused and wakes on enqueue without polling the model',async()=>{
 const x=setup();x.queued.length=0;x.pool.wake();await flush();expect(x.ports.claim).not.toHaveBeenCalled();x.pool.configure(1);await flush();expect(x.ports.execute).not.toHaveBeenCalled();x.queued.push({id:'d'});x.pool.wake();await flush();expect(x.events).toEqual(['begin:d','execute:d']);x.pool.stop();x.release.get('d')!();await flush();
});
it('cancellation records uncertainty once and never requeues',async()=>{
 const x=setup();x.pool.configure(1);await flush();x.pool.stop(true);await flush();expect(x.ports.uncertain).toHaveBeenCalledTimes(1);expect(x.ports.complete).not.toHaveBeenCalled();expect(x.ports.claim).toHaveBeenCalledTimes(1);expect(x.pool.running).toBe(0);
});
it('failed durable attempt never launches generation',async()=>{
 const x=setup();x.ports.begin.mockRejectedValueOnce(Error('disk full'));x.pool.configure(1);await flush();expect(x.ports.execute.mock.calls.some(([job])=>job.id==='a')).toBe(false);expect(x.ports.uncertain).toHaveBeenCalled();x.pool.stop(true);await flush();
});

it('keeps ownership until an in-flight claim settles during shutdown',async()=>{
 let releaseClaim!:(value:{id:string})=>void;const x=setup();x.ports.claim.mockImplementationOnce(()=>new Promise(resolve=>{releaseClaim=resolve}));x.pool.configure(1);x.pool.stop();expect(x.pool.settling).toBe(true);releaseClaim({id:'late'});await flush();expect(x.pool.settling).toBe(true);x.release.get('late')!();await flush();expect(x.pool.settling).toBe(false);
});

it('does not publish when a cancelled generator still resolves a result',async()=>{
 const x=setup();x.ports.execute.mockImplementationOnce(async()=>{await new Promise<void>(resolve=>x.release.set('late',resolve));});
 x.pool.configure(1);await flush();x.pool.stop(true);x.release.get('late')!();await flush();expect(x.ports.complete).not.toHaveBeenCalled();expect(x.ports.uncertain).toHaveBeenCalledOnce();
});

it('continues independent jobs after a failed generation',async()=>{
 const x=setup();x.ports.execute.mockRejectedValueOnce(Error('invalid output'));x.pool.configure(1);await flush();
 expect(x.ports.uncertain).toHaveBeenCalledOnce();expect(x.pool.blockedReason).toBeUndefined();
 expect(x.events).toContain('execute:b');x.pool.stop(true);await flush();
});
it('keeps the pool blocked even when persisting an admission error fails',async()=>{
 const x=setup();x.ports.claim.mockRejectedValueOnce(Error('unavailable'));const blocked=vi.fn(async()=>{throw Error('disk full')});const pool=new LocalWorkerPool({...x.ports,blocked});pool.configure(1);await flush();expect(pool.blockedReason).toBeTruthy();expect(x.ports.report).toHaveBeenCalledTimes(2);pool.wake();await flush();expect(x.ports.claim).toHaveBeenCalledTimes(1);pool.stop();
});

it('takes later jobs after three rejected inputs and stops only when its policy requests it',async()=>{
 const {RejectedQueueRequest}=await import('../src/core/local-worker-pool');
 const x=setup();
 let rejected=0;
 const claim=vi.fn(async()=>{if(rejected<3)throw new RejectedQueueRequest(`bad-${++rejected}`,'Invalid reference');return x.queued.shift();});
 const failed=vi.fn(async()=>undefined);
 const pool=new LocalWorkerPool({...x.ports,claim,failed});
 pool.configure(1);await flush();
 expect(failed).toHaveBeenCalledTimes(3);expect(x.events).toContain('execute:a');
 expect(pool.blockedReason).toBeUndefined();pool.stop(true);await flush();
});
