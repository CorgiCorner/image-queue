import type {Storage} from '../storage/types';
export type LocalAttempt = {
 id:string; jobId:string; state:'prepared'|'running'|'succeeded'|'uncertain';
 createdAt:string; updatedAt:string; model:string; prompt:string; references:string[];
 processId?:number; startedAt?:string; error?:string;
};
/** Persisted before launch. Contains no provider credentials or claim token. */
export async function prepareLocalAttempt(store:Storage,input:Pick<LocalAttempt,'jobId'|'model'|'prompt'|'references'>) {
 return store.lock(`local-attempt-${input.jobId}`,async()=>{
  const previous=(await store.list<LocalAttempt>('local-attempts')).find(a=>a.jobId===input.jobId&&a.state!=='succeeded');
  if(previous)throw new Error('An unresolved generation attempt already exists');
  const now=new Date().toISOString();
  const attempt:LocalAttempt={...input,references:[...input.references],id:crypto.randomUUID(),state:'prepared',createdAt:now,updatedAt:now};
  await store.put('local-attempts',attempt.id,attempt);return attempt;
 });
}
export async function updateLocalAttempt(store:Storage,id:string,state:'running'|'succeeded'|'uncertain',processId?:number) {
 return store.lock(`local-attempt-record-${id}`,async()=>{
  const attempt=await store.get<LocalAttempt>('local-attempts',id);
  if(!attempt)throw new Error('Generation attempt not found');
  const allowed=attempt.state==='prepared'?['running','uncertain']:attempt.state==='running'?['succeeded','uncertain']:[];
  if(!allowed.includes(state))throw new Error('Invalid generation attempt transition');
  const updated={...attempt,state,updatedAt:new Date().toISOString(),...(state==='running'?{startedAt:new Date().toISOString()}:{}),...(processId?{processId}:{})};
  await store.put('local-attempts',id,updated);return updated;
 });
}
/** Only after exclusive executor ownership, never while another executor lives. */
export async function recoverLocalAttempts(store:Storage) {
 const recovered:LocalAttempt[]=[];
 for(const a of await store.list<LocalAttempt>('local-attempts')) {
  if(a.state==='prepared'&&!a.startedAt){await store.delete('local-attempts',a.id);continue;}
  if(a.state==='prepared'||a.state==='running')recovered.push(await updateLocalAttempt(store,a.id,'uncertain'));
 }
 return recovered;
}
