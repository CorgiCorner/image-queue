/** Consistent local reservation time, with elapsed time and no seconds. */
export function reservationTime(value:string|undefined,now=Date.now(),locales?:string|string[],timeZone?:string) {
 const timestamp=Date.parse(value??'');
 if(!Number.isFinite(timestamp))return 'an unknown time';
 const absolute=new Intl.DateTimeFormat(locales,{dateStyle:'medium',timeStyle:'short',...(timeZone?{timeZone}:{})}).format(timestamp);
 const minutes=Math.max(0,Math.floor((now-timestamp)/60000));
 const relative=minutes<1?'just now':minutes<60?`${minutes} ${minutes===1?'minute':'minutes'} ago`:minutes<1440?`${Math.floor(minutes/60)} ${minutes<120?'hour':'hours'} ago`:`${Math.floor(minutes/1440)} ${minutes<2880?'day':'days'} ago`;
 return `${absolute} · ${relative}`;
}
