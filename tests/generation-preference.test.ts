import {expect,it} from 'vitest';
import {MemoryStorage} from '../src/storage/memory';
import {readGenerationPreference,saveGenerationPreference} from '../src/core/generation-preference';
it('persists a source without changing or generating existing requests',async()=>{
 const store=new MemoryStorage();await store.put('jobs','old',{source:'queue',status:'queued'});
 await store.put('models','openai',[{id:'gpt-image-1.5',name:'GPT Image',provider:'openai'}]);
 expect(await saveGenerationPreference(store,{source:'api',provider:'openai',model:'gpt-image-1.5'})).toMatchObject({source:'api',model:'gpt-image-1.5'});
 expect(await store.get('jobs','old')).toEqual({source:'queue',status:'queued'});
 expect(await readGenerationPreference(store)).toMatchObject({source:'api'});
 await saveGenerationPreference(store,{source:'queue',provider:'openai'});
 expect(await readGenerationPreference(store)).toMatchObject({source:'queue',model:'gpt-image-1.5'});
});
it('rejects an unconfigured API model and leaves the preference unchanged',async()=>{
 const store=new MemoryStorage();await store.put('settings','generation-source',{source:'queue'});
 await expect(saveGenerationPreference(store,{source:'api',provider:'openai',model:'unknown'})).rejects.toThrow('configured OpenAI');
 expect(await readGenerationPreference(store)).toMatchObject({source:'queue'});
});
