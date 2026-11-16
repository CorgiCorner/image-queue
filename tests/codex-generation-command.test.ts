import {expect,it} from 'vitest';
import {codexGenerationArguments,codexProcessEnvironment} from '../src/core/codex-generation-command';
it('keeps ordered attachments and prompt as argv data with an explicit separator',()=>{
 const args=codexGenerationArguments({prompt:'literal $(touch bad)\ntext',references:['/one image.png','/two.png'],workspace:'/run',output:'/run/result.png',model:'gpt-6.1-sol',effort:'low'});
 expect(args.slice(-6,-1)).toEqual(['-i','/one image.png','-i','/two.png','--']);
 expect(args.at(-1)).toContain('literal $(touch bad)\ntext');expect(args).toContain('service_tier="priority"');expect(args).toContain('web_search="disabled"');expect(args).toContain('mcp_servers={}');expect(args).toContain('plugins._default.enabled=false');expect(args).toContain('sandbox_workspace_write.network_access=false');
});
it('does not pass inherited API keys, hooks or cloud secrets to generation',()=>{
 expect(codexProcessEnvironment({HOME:'/home',PATH:'/bin',OPENAI_API_KEY:'secret',NODE_OPTIONS:'--require evil',IMAGE_QUEUE_SETTINGS_SECRET:'secret'})).toEqual({NODE_ENV:'production',HOME:'/home',PATH:'/bin'});
});
