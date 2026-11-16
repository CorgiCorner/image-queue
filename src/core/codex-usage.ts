import {z} from 'zod';
const windowSchema=z.object({usedPercent:z.number().min(0),resetsAt:z.number().int().nonnegative().optional()});
const snapshot=z.object({primary:windowSchema.nullable().optional(),secondary:windowSchema.nullable().optional(),spendControlReached:z.boolean().optional(),rateLimitReachedType:z.string().nullable().optional()});
const response=z.object({ordinaryUsageAllowed:z.boolean().optional(),rateLimits:snapshot});
export type CodexUsage={state:'available'|'exhausted'|'unknown';resetAt?:string;checkedAt:string};
/** Strip account identifiers, credits and every field unrelated to admission. */
export function codexUsage(value:unknown,now=Date.now()):CodexUsage {
 const parsed=response.safeParse(value);const checkedAt=new Date(now).toISOString();
 if(!parsed.success)return {state:'unknown',checkedAt};
 const {rateLimits:r,ordinaryUsageAllowed}=parsed.data;
 const exhausted=[r.primary,r.secondary].filter(w=>w&&w.usedPercent>=100);
 const blocked=ordinaryUsageAllowed===false||r.spendControlReached===true||Boolean(r.rateLimitReachedType)||exhausted.length>0;
 const resets=exhausted.map(w=>w!.resetsAt).filter((n):n is number=>n!==undefined&&n*1000>now);
 const observed=ordinaryUsageAllowed===true||r.primary!=null||r.secondary!=null;
 return {state:blocked?'exhausted':observed?'available':'unknown',...(resets.length?{resetAt:new Date(Math.max(...resets)*1000).toISOString()}:{}),checkedAt};
}
