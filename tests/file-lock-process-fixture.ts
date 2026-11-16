import {FileStorage} from '../src/storage/fs';
const [root,action]=process.argv.slice(2);
const store=new FileStorage(root);
try {
 await store.lock('crash-check',async()=>{
  process.stdout.write('ACQUIRED\n');
  if(action==='hold')await new Promise(()=>setInterval(()=>{},1000));
 });
} catch(error) {process.stdout.write('BUSY\n');process.exitCode=2;}
