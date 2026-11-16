import {expect,it} from 'vitest';
import {agentConfigDirectory,fileManagerCommand} from '../src/storage/open-agent-config-directory';
it('restricts destinations to the client folder and current workspace',()=>{
 expect(agentConfigDirectory('Codex','/home/example','/project')).toBe('/home/example/.codex');
 expect(agentConfigDirectory('Claude Code','/home/example','/project')).toBe('/project');
});
it('uses file managers without shell interpolation',()=>{
 const path='/folder with spaces/$(echo nope)';
 expect(fileManagerCommand('darwin',path)).toEqual(['/usr/bin/open',[path]]);
 expect(fileManagerCommand('win32',path)).toEqual(['explorer.exe',[path]]);
 expect(fileManagerCommand('linux',path)).toEqual(['xdg-open',[path]]);
 expect(()=>fileManagerCommand('other',path)).toThrow('not available');
});
