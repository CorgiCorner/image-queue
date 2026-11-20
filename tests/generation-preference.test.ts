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

it('defaults a Cloudflare deployment to the API and the preferred model, and refuses the local queue there', async () => {
  const { vi } = await import('vitest');
  vi.stubEnv('IMAGE_QUEUE_STORAGE_DRIVER', 'cloudflare');
  try {
    const store = new MemoryStorage();
    expect(await readGenerationPreference(store)).toEqual({ source: 'api', provider: 'openai' });
    await store.put('models', 'openai', [
      { id: 'gpt-image-1.5', name: 'GPT Image 1.5', provider: 'openai' },
      { id: 'gpt-image-2.6-sunburst', name: 'GPT Image 2.6 Sunburst', provider: 'openai' },
    ]);
    expect(await readGenerationPreference(store)).toEqual({ source: 'api', provider: 'openai', model: 'gpt-image-2.6-sunburst' });
    // A queue choice saved before the deployment moved to Cloudflare is not used there.
    await store.put('settings', 'generation-source', { source: 'queue', provider: 'openai' });
    expect(await readGenerationPreference(store)).toMatchObject({ source: 'api' });
    await expect(saveGenerationPreference(store, { source: 'queue', provider: 'openai' })).rejects.toThrow('only in a local installation');
    expect(await saveGenerationPreference(store, { source: 'api', provider: 'openai', model: 'gpt-image-1.5' })).toMatchObject({ model: 'gpt-image-1.5' });
    expect(await readGenerationPreference(store)).toMatchObject({ source: 'api', model: 'gpt-image-1.5' });
  } finally {
    vi.unstubAllEnvs();
  }
});
