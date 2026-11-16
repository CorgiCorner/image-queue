import {z} from 'zod';
import type {Storage} from '../storage/types';
export const localRunnerSettingsSchema=z.object({workers:z.number().int().min(0).max(5),paused:z.boolean().optional(),blockedReason:z.string().min(1).max(1000).optional(),resumeAt:z.iso.datetime().optional(),blockedJobId:z.string().min(1).max(200).optional()});
export async function readLocalRunnerSettings(store:Storage){const value=await store.get('settings','local-runner');return value===undefined?undefined:normalize(localRunnerSettingsSchema.parse(value));}

function normalize(value:ReturnType<typeof localRunnerSettingsSchema.parse>){return {...value,workers:value.workers||1,paused:value.paused??value.workers===0};}
