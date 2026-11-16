/** Classify locally captured errors without forwarding raw logs or credentials to the UI. */
export function codexFailureMessage(text:string):string {
 if(/usage limit|quota exceeded|rate.limit|limit reached|insufficient_quota/i.test(text))return 'Codex usage limit reached. Check your plan before resuming local execution.';
 if(/not logged in|unauthorized|authentication|sign in|login required/i.test(text))return 'Codex is not signed in. Sign in locally, then resume execution.';
 if(/model.*(?:not found|unavailable|not supported|does not exist)/i.test(text))return 'The selected Codex model is unavailable. Choose an available model before resuming.';
 return 'Codex generation failed. Inspect the local attempt before resuming.';
}
