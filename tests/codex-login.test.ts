import{expect,it}from'vitest';import{parseCodexLogin}from'../src/core/codex-login';
it('distinguishes subscription login, API-key login and signed-out state',()=>{
 expect(parseCodexLogin('Logged in using ChatGPT')).toBe('chatgpt');expect(parseCodexLogin('Logged in using an API key')).toBe('api-key');expect(parseCodexLogin('Not logged in')).toBe('signed-out');expect(parseCodexLogin('unrecognized output')).toBe('unknown');
});
