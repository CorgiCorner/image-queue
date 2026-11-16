import {mkdir,copyFile,writeFile,lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
/** Bootstrap missing files only. Existing queue/history and helpers are never overwritten. */
export async function prepareLocalQueue(root:string,applicationRoot:string) {
 await mkdir(root,{recursive:true,mode:0o700});
 for(const name of ['worker.py','request.sh']){
  try {await copyFile(path.join(applicationRoot,'docs','protocol',name),path.join(root,name),constants.COPYFILE_EXCL);}
  catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
  if(!(await lstat(path.join(root,name))).isFile())throw new Error('Queue helper is not a file');
 }
 try {await writeFile(path.join(root,'images-todo.md'),'# Image requests\n',{flag:'wx',mode:0o600});}
 catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
 if(!(await lstat(path.join(root,'images-todo.md'))).isFile())throw new Error('Queue request file is not a file');
}
