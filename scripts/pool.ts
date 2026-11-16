import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { storage } from '../src/storage';
import { tickPool, finishPool, poolConfig, MAX_WORKERS } from '../src/core/pool';
import { configuredQueueRoot } from '../src/sources/queue';
import { hash } from '../src/core/schema';
const [command,slotText,workerId]=process.argv.slice(2);
const slot = Number(slotText);
if ((command !== "tick" && command !== "finish" && command !== "check") ||
    !Number.isInteger(slot) || slot < 1 || slot > MAX_WORKERS ||
    !workerId?.trim() || process.argv.length !== 5) {
  console.error(`Usage: pnpm pool <tick|finish|check> <slot 1-${MAX_WORKERS}> <worker-id>`);
  process.exit(1);
}
const root=(await configuredQueueRoot());
const queueHash=await hash(await readFile(path.join(root,'images-todo.md'),'utf8'));
const claimsPath=path.join(root,'out','.claims');
let claims:{worker:string;state:string;claimed_at_utc:string}[]=[];
try {claims=await Promise.all((await readdir(claimsPath)).filter(file=>file.endsWith('.json')).map(async file=>JSON.parse(await readFile(path.join(claimsPath,file),'utf8'))));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
const mine=claims.filter(claim=>claim.worker===workerId);
const store=await storage();
const owner = await store.get<{ workerId: string }>("pulses", String(slot));
if (owner && owner.workerId !== workerId) throw new Error("Slot belongs to another worker");
const config = await poolConfig(store);
const workerInstructionsVersion = command === 'tick'
  ? /Version: `(image-queue-worker-v\d+)`/.exec(await readFile(path.join(process.cwd(), 'WORKER.md'), 'utf8'))?.[1]
  : undefined;
if (command === 'tick' && !workerInstructionsVersion) throw new Error('WORKER.md has no valid instruction version');
const hasReservation = mine.some(claim => claim.state === 'reserved');
const result=command==='check'
  ? { allowed: slot <= config.workers || hasReservation, draining: slot > config.workers && hasReservation }
  : command==='tick'?await tickPool(store,{slot,workerId,queueHash,hasReservation:mine.some(claim=>claim.state==='reserved'),workerInstructionsVersion,now:Date.now()}):await finishPool(store,{slot,workerId,queueHash,claimedAt:mine.map(claim=>claim.claimed_at_utc).sort().at(-1),now:Date.now()});
console.log(JSON.stringify({ ...result, queueDirectory: root }));
