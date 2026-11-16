export type CodexLogin='chatgpt'|'api-key'|'signed-out'|'unknown';
export function parseCodexLogin(text:string):CodexLogin {
 if(/logged in using ChatGPT/i.test(text))return 'chatgpt';
 if(/api key|api-key/i.test(text)&&/logged in|configured/i.test(text))return 'api-key';
 if(/not logged in|signed out|no.*auth/i.test(text))return 'signed-out';
 return 'unknown';
}
