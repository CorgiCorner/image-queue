import {expect,it} from 'vitest';
import {workerSetupLink} from '../src/core/worker-setup';
import {defaultPool} from '../src/core/pool';
it('opens a workspace-scoped draft with safe configuration and duplicate-worker protection',()=>{
 const link=workerSetupLink({command:'/node',args:['/workspace with spaces/dist/mcp.mjs'],env:{OPENAI_API_KEY:'secret',IMAGE_QUEUE_QUEUE_DIR:'/queue'}},{...defaultPool,workers:1});
 const url=new URL(link!);expect(url.protocol).toBe('codex:');expect(url.searchParams.get('path')).toBe('/workspace with spaces');const prompt=url.searchParams.get('prompt')!;expect(prompt).toContain('docs/protocol/worker.py');expect(prompt).toContain('never replace an existing queue or reservation');expect(prompt).toContain('reuse them');expect(prompt).toContain('at most 1');expect(prompt).toContain('/queue');expect(prompt).toContain('every pool and tagging command');expect(prompt).toContain('MCP client environment alone does not configure scheduled chats');expect(prompt).not.toContain('secret');expect(prompt).toContain('Do not generate images');
});
it('does not invent a workspace for an unavailable launch',()=>{expect(workerSetupLink(undefined,defaultPool)).toBeUndefined();expect(workerSetupLink({command:'node',args:[]},defaultPool)).toBeUndefined();});
it('preserves a paused pool during setup',()=>{const link=workerSetupLink({command:'/node',args:['/project/dist/mcp.mjs']},{...defaultPool,workers:0})!;const prompt=new URL(link).searchParams.get('prompt')!;expect(prompt).toContain('at most 0 active slots');expect(prompt).toContain('keep workers paused');});
