import {FileStorage} from '../src/storage/fs';
const [root,action]=process.argv.slice(2);
const store=new FileStorage(root);
try {
 await store.lock('crash-check',async()=>{
  process.stdout.write('ACQUIRED\n');
  if(action==='hold')await new Promise<void>(resolve=>{
   const keepAlive=setInterval(()=>{},1000);
   process.once('message',()=>{clearInterval(keepAlive);resolve();});
  });
 });
} catch(error) {process.stdout.write('BUSY\n');process.exitCode=2;}
