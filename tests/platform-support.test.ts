import {expect,it} from 'vitest';
import {platformSupport} from '../src/core/platform-support';
it('marks only the verified platform as tested without blocking other systems',()=>{
 expect(platformSupport('darwin','arm64')).toMatchObject({tested:true,warning:undefined});
 for(const [os,arch] of [['darwin','x64'],['linux','x64'],['win32','arm64']])expect(platformSupport(os,arch)).toMatchObject({tested:false,warning:expect.stringContaining('Untested')});
});
