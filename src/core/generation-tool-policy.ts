import {z} from 'zod';
const serverSchema=z.object({name:z.string(),tools:z.record(z.string(),z.unknown()).optional()});
/** A claimed isolation profile must be checked against effective inventory, not configuration intent. */
export function verifyGenerationToolPolicy(input:unknown) {
 const inventory=z.object({servers:z.array(serverSchema),builtins:z.array(z.string())}).parse(input);
 const external=inventory.servers.filter(server=>Object.keys(server.tools??{}).length>0);
 const allowed=new Set(['image_gen','image_generation','view_image']);
 const unexpected=inventory.builtins.filter(tool=>!allowed.has(tool));
 if(external.length||unexpected.length)throw new Error('Generation tool isolation is not established');
 if(!inventory.builtins.some(tool=>tool==='image_gen'||tool==='image_generation'))throw new Error('Image generation tool unavailable');
 return true;
}
