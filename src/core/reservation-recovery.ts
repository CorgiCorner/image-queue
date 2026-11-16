import {z} from 'zod';
import type {Storage} from '../storage/types';
import {idSchema,type Job} from './schema';
import {UserFacingError} from './user-facing-error';
export const reservationRecoveryInput=z.object({id:idSchema,acknowledgeUncertain:z.literal(true)});
/** Owner decision only: retain the original file claim and record uncertainty in panel metadata. */
export async function inspectReservedResult(store:Storage,input:z.infer<typeof reservationRecoveryInput>) {
 const {id}=reservationRecoveryInput.parse(input);
 return store.lock(id,async()=>{
  const job=await store.get<Job>('jobs',id);
  if(!job||job.source!=='queue'||job.status!=='running'||!job.claim?.reserved||job.archivedAt||job.trashedAt)throw new UserFacingError('Select a reserved queue request');
  const updated:Job={...job,status:'uncertain',reservationReviewedAt:new Date().toISOString(),error:'The original worker may still have a result. Its reservation has been preserved.',updatedAt:new Date().toISOString()};
  await store.put('jobs',id,updated);return updated;
 });
}
