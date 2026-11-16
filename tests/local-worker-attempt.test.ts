import {expect,it} from 'vitest';
import {MemoryStorage} from '../src/storage/memory';
import {prepareLocalAttempt,updateLocalAttempt,recoverLocalAttempts} from '../src/core/local-worker-attempt';
it('persists exact prompt and reference order before launch and rejects unresolved duplicates',async()=>{
 const s=new MemoryStorage();const a=await prepareLocalAttempt(s,{jobId:'IMG-one',model:'gpt-6.1-sol',prompt:'literal\nprompt',references:['/second','/first']});
 expect(await s.get('local-attempts',a.id)).toEqual(a);expect(a.state).toBe('prepared');expect(a.references).toEqual(['/second','/first']);
 await expect(prepareLocalAttempt(s,{jobId:'IMG-one',model:a.model,prompt:a.prompt,references:[]})).rejects.toThrow('unresolved');
 await updateLocalAttempt(s,a.id,'running',123);await updateLocalAttempt(s,a.id,'succeeded');
 expect(await recoverLocalAttempts(s)).toEqual([]);
});
it('recovers unfinished attempts as uncertain and never silently retries',async()=>{
 const s=new MemoryStorage();const a=await prepareLocalAttempt(s,{jobId:'IMG-one',model:'gpt-6.1-sol',prompt:'x',references:[]});
 await updateLocalAttempt(s,a.id,'running',123);
 expect((await recoverLocalAttempts(s))[0].state).toBe('uncertain');
 await expect(updateLocalAttempt(s,a.id,'running')).rejects.toThrow('transition');
 await expect(prepareLocalAttempt(s,{jobId:'IMG-one',model:a.model,prompt:'x',references:[]})).rejects.toThrow('unresolved');
});

it('releases a prepared attempt with no launch intent during exclusive recovery',async()=>{
 const s=new MemoryStorage();const a=await prepareLocalAttempt(s,{jobId:'IMG-never-started',model:'gpt-6.1-sol',prompt:'x',references:[]});
 expect(await recoverLocalAttempts(s)).toEqual([]);expect(await s.get('local-attempts',a.id)).toBeUndefined();
 expect(await prepareLocalAttempt(s,{jobId:a.jobId,model:a.model,prompt:a.prompt,references:[]})).toBeTruthy();
});
