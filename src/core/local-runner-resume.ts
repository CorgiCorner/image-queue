/** A single local timer. Long waits are chunked to avoid Node's timer overflow. */
export function scheduleQuotaResume(resetAt:string,resume:()=>Promise<void>):()=>void {
 let timer:ReturnType<typeof setTimeout>|undefined;
 let cancelled=false;
 const deadline=Date.parse(resetAt);
 const schedule=()=>{
  if(cancelled||!Number.isFinite(deadline))return;
  const remaining=deadline-Date.now();
  timer=setTimeout(()=>{
   if(cancelled)return;
   if(deadline>Date.now())schedule();
   else void resume().catch(()=>{/* The runner persists and reports admission failures. */});
  },Math.min(Math.max(remaining,0),2_147_483_647));
  timer.unref?.();
 };
 schedule();
 return ()=>{cancelled=true;if(timer)clearTimeout(timer);};
}
