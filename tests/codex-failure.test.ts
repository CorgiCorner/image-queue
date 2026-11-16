import {expect,it} from 'vitest';import{codexFailureMessage}from'../src/core/codex-failure';
it('classifies quota, authentication and model failures without echoing raw logs',()=>{
 expect(codexFailureMessage('usage limit reached secret-key')).toContain('usage limit');
 expect(codexFailureMessage('401 unauthorized secret-key')).toContain('not signed in');
 expect(codexFailureMessage('model x not supported secret-key')).toContain('model is unavailable');
 expect(codexFailureMessage('secret-key')).not.toContain('secret-key');
});
