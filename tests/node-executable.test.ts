import {expect,it,vi} from 'vitest';
const resolve=vi.hoisted(()=>vi.fn());
vi.mock('../src/storage/resolve-executable',()=>({resolveExecutable:resolve}));
import {nodeExecutable} from '../src/storage/node-executable';
it('falls through unavailable preferred executables without breaking configuration',async()=>{
 resolve.mockRejectedValue(new Error('missing'));
 expect(await nodeExecutable()).toBe(process.execPath);
 resolve.mockResolvedValue('/stable/node');
 expect(await nodeExecutable()).toBe('/stable/node');
});
