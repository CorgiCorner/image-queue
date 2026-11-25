import {mkdtemp,writeFile,chmod,rm,mkdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,expect,it} from 'vitest';
import {runCodexAppServer} from '../src/storage/codex-app-server';
const roots:string[]=[];
const finalReport='The tool rejected `referenced_image_paths`: must contain at most 5 paths. '+'x'.repeat(300)+' Unlogged tail.';
afterEach(async()=>{await Promise.all(roots.splice(0).map(r=>rm(r,{recursive:true,force:true})));});
async function fixture(mode='ok'){
 const root=await mkdtemp(join(tmpdir(),'iq-server-test-'));roots.push(root);
 const home=join(root,'home');await mkdir(join(home,'generated_images','thread'),{recursive:true});
 const image=join(home,'generated_images','thread','image.png');await writeFile(image,'png');
 const executable=join(root,'fake');
 await writeFile(executable,`#!${process.execPath}\nconst rl=require('node:readline').createInterface({input:process.stdin});
const emit=x=>process.stdout.write(JSON.stringify(x)+'\\n');
rl.on('line',line=>{const x=JSON.parse(line);if(!x.id)return;let result={};
if(x.method==='config/read')result={config:{mcp_servers:{private:{}},plugins:{secret:{}}}};
if(x.method==='thread/start'){require('node:fs').writeFileSync(${JSON.stringify(join(root,'config'))},JSON.stringify(x.params));result={thread:{id:'thread'}};}
if(x.method==='mcpServerStatus/list')result={data:[{name:'private',tools:${mode==='tools'?'({unsafe:{}})':'{}'}}]};
emit({id:x.id,result});
if(x.method==='turn/start'){
if(${JSON.stringify(mode)}==='hang'){require('node:fs').writeFileSync(${JSON.stringify(join(root,'turn-started'))},'yes');return;}
require('node:fs').writeFileSync(${JSON.stringify(join(root,'request'))},x.params.input[0].text);
const request=JSON.parse(x.params.input[0].text);
if(${JSON.stringify(mode)}.startsWith('missing-image')){
emit({method:'item/completed',params:{threadId:'thread',item:{type:'agentMessage',text:'Earlier response sentinel.'}}});
if(${JSON.stringify(mode)}==='missing-image-started')emit({method:'item/started',params:{threadId:'thread',item:{type:'imageGeneration',status:'inProgress'}}});
emit({method:'item/completed',params:{threadId:'thread',item:{type:'agentMessage',text:${JSON.stringify(finalReport)}}}});
emit({method:'turn/completed',params:{threadId:'thread',turn:{status:'completed'}}});return;
}
emit({method:'item/completed',params:{threadId:'thread',item:{type:'imageGeneration',status:'completed',savedPath:${JSON.stringify(image)},revisedPrompt:${mode==='rewrite'?'"changed"':'request.imageRequest'},inputImages:${mode==='wrong-hash'?`[{path:${JSON.stringify(image)},sha256:'0'.repeat(64)}]`:'[]'}}}});
emit({method:'turn/completed',params:{threadId:'thread',turn:{status:'completed'}}});}
});`);await chmod(executable,0o700);
 return {root,home,executable};
}
async function run(mode='ok',references:string[]=[]){
 const f=await fixture(mode);if(mode==='wrong-hash')references=[join(f.home,'generated_images','thread','image.png')];const old=process.env.CODEX_HOME;process.env.CODEX_HOME=f.home;
 try{await runCodexAppServer({executable:f.executable,request:{workspace:f.root,output:join(f.root,'out.png'),receipt:join(f.root,'receipt'),prompt:'exact\nprompt',references,width:1024,height:1536,model:'gpt-6.1-sol',effort:'low'},signal:new AbortController().signal,eventLog:join(f.root,'events'),errorLog:join(f.root,'errors'),onStarted:async()=>{},timeoutMs:2000});return f;}finally{if(old===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=old;}
}
it('uses a read-only thread, disables inherited tools and collects verified event output',async()=>{
 const f=await run();const config=JSON.parse(await readFile(join(f.root,'config'),'utf8'));
 expect(config.sandbox).toBe('read-only');expect(config.approvalPolicy).toBe('never');
 expect(config.config['mcp_servers.private.enabled']).toBe(false);
 expect(config.config['plugins.secret.enabled']).toBe(false);
 expect(config.config['features.shell_tool']).toBe(false);
 expect(await readFile(join(f.root,'out.png'),'utf8')).toBe('png');
 expect(JSON.parse(await readFile(join(f.root,'receipt'),'utf8')).prompt).toBe('exact\nprompt');
 const request=JSON.parse(await readFile(join(f.root,'request'),'utf8'));
 expect(request).toMatchObject({imageRequest:'exact\nprompt',requestedSize:{width:1024,height:1536}});
 expect(config.developerInstructions).toContain('never append dimensions');
});
it('rejects effective external tools before starting a generation',async()=>{await expect(run('tools')).rejects.toThrow('External generation tools');});
it('records a definite failure and truncated final message when generation never starts',async()=>{
 const f=await fixture('missing-image');
 const eventLog=join(f.root,'events');
 await expect(runCodexAppServer({executable:f.executable,request:{workspace:f.root,output:join(f.root,'out.png'),prompt:'private prompt sentinel',references:[],model:'gpt-6.1-sol',effort:'low'},signal:new AbortController().signal,eventLog,errorLog:join(f.root,'errors'),onStarted:async()=>{},timeoutMs:3000})).rejects.toMatchObject({
  code:'missing_image',uncertain:false,message:expect.stringContaining(finalReport.slice(0,300)),
 });
 const content=await readFile(eventLog,'utf8');
 expect(content.trim().split('\n').map(row=>JSON.parse(row)).at(-1)).toMatchObject({
  event:'attempt_failed',code:'missing_image',imageGenerationStarted:false,reportedHint:'reference_limit',
  finalAgentMessage:finalReport.slice(0,300),
 });
 expect(content).not.toMatch(/private prompt sentinel|Earlier response sentinel|Unlogged tail/i);
});
it('keeps the result uncertain if an imageGeneration item started',async()=>{
 await expect(run('missing-image-started')).rejects.toMatchObject({code:'missing_image',uncertain:true});
});
it('rejects six references before starting Codex',async()=>{
 await expect(run('ok',Array.from({length:6},(_,i)=>`/ref-${i}.png`))).rejects.toMatchObject({
  code:'reference_limit',uncertain:false,message:expect.stringContaining('at most 5 reference images (got 6)'),
 });
 await expect(readFile(join(roots.at(-1)!,'config'))).rejects.toMatchObject({code:'ENOENT'});
});
it('rejects actual rewritten prompts',async()=>{await expect(run('rewrite')).rejects.toThrow('changed');});
it('rejects an output outside the private directory before launching',async()=>{
 const f=await fixture();await expect(runCodexAppServer({executable:f.executable,request:{workspace:f.root,output:join(tmpdir(),'outside.png'),prompt:'x',references:[],model:'gpt-6.1-sol',effort:'low'},signal:new AbortController().signal,eventLog:join(f.root,'events'),errorLog:join(f.root,'errors'),onStarted:async()=>{}})).rejects.toThrow('private run');
});
it('does not launch a pre-cancelled request',async()=>{
 const f=await fixture();const controller=new AbortController();controller.abort();
 await expect(runCodexAppServer({executable:f.executable,request:{workspace:f.root,output:join(f.root,'out.png'),prompt:'x',references:[],model:'gpt-6.1-sol',effort:'low'},signal:controller.signal,eventLog:join(f.root,'events'),errorLog:join(f.root,'errors'),onStarted:async()=>{}})).rejects.toThrow('cancelled');
});

it('rejects a silently omitted reference even when generation succeeds',async()=>{await expect(run('ok',['/missing-reference.png'])).rejects.toThrow('omitted reference');});

it('bounds an unresponsive generation process by timeout',async()=>{await expect(run('hang')).rejects.toThrow('uncertain');},5000);

it('aborts a started process without publishing a result',async()=>{
 const f=await fixture('hang');const controller=new AbortController();let started=false;
 await expect(runCodexAppServer({executable:f.executable,request:{workspace:f.root,output:join(f.root,'out.png'),prompt:'x',references:[],model:'gpt-6.1-sol',effort:'low'},signal:controller.signal,eventLog:join(f.root,'events'),errorLog:join(f.root,'errors'),onStarted:async()=>{started=true;controller.abort();},timeoutMs:3000})).rejects.toThrow('cancelled');
 expect(started).toBe(true);await expect(readFile(join(f.root,'out.png'))).rejects.toThrow();
});

it('cancels while the generation turn is in flight',async()=>{
 const f=await fixture('hang');const controller=new AbortController();
 const promise=runCodexAppServer({executable:f.executable,request:{workspace:f.root,output:join(f.root,'out.png'),prompt:'x',references:[],model:'gpt-6.1-sol',effort:'low'},signal:controller.signal,eventLog:join(f.root,'events'),errorLog:join(f.root,'errors'),onStarted:async()=>{},timeoutMs:4000});
 const rejected=expect(promise).rejects.toThrow('uncertain');
 for(let i=0;i<100;i++){try{await readFile(join(f.root,'turn-started'));break;}catch{await new Promise(resolve=>setTimeout(resolve,10));}}
 expect(await readFile(join(f.root,'turn-started'),'utf8')).toBe('yes');
 controller.abort();await rejected;await expect(readFile(join(f.root,'out.png'))).rejects.toThrow();
});

it('rejects a reference file whose observed hash differs from the request',async()=>{await expect(run('wrong-hash')).rejects.toThrow('reference evidence');});
