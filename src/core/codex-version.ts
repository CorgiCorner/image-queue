export const minimumCodexVersion='0.167.1';
export function supportedCodexVersion(text:string){
 const match=/\bcodex-cli\s+(\d+)\.(\d+)\.(\d+)\b/.exec(text);
 if(!match)return false;
 const version=match.slice(1).map(Number),minimum=minimumCodexVersion.split('.').map(Number);
 for(let i=0;i<3;i++){if(version[i]>minimum[i])return true;if(version[i]<minimum[i])return false;}
 return true;
}
