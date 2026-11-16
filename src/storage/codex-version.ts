import {execFile} from 'node:child_process';import{promisify}from'node:util';import{supportedCodexVersion,minimumCodexVersion}from'../core/codex-version';import{UserFacingError}from'../core/user-facing-error';import{codexProcessEnvironment}from'../core/codex-generation-command';
export async function checkCodexVersion(executable:string){
 const {stdout}=await promisify(execFile)(executable,['--version'],{env:codexProcessEnvironment(process.env),timeout:5000,maxBuffer:4096});
 if(!supportedCodexVersion(stdout))throw new UserFacingError(`Update Codex CLI to ${minimumCodexVersion} or newer before enabling local execution.`);
 return stdout.trim();
}
