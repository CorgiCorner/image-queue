import {FileStorage} from '../src/storage/fs';
import {purgeJobs,recoverPurges} from '../src/core/purge';
const [root,mode]=process.argv.slice(2);const store=new FileStorage(root);
if(mode==='interrupt'){
 const remove=store.delete.bind(store);let held=false;
 store.delete=async(collection,id)=>{if(collection==='jobs'&&!held){held=true;process.stdout.write('JOURNALED\n');await new Promise(()=>setInterval(()=>{},1000));}return remove(collection,id);};
 await purgeJobs(store,['one','two']);
}else{await recoverPurges(store);process.stdout.write(JSON.stringify({jobs:(await store.list('jobs')).length,tombstones:(await store.list('tombstones')).length,complete:(await store.list<{complete:boolean}>('purge-operations')).every(x=>x.complete)})+'\n');}
