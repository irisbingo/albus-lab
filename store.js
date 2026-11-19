const dbp=new Promise((resolve,reject)=>{const req=indexedDB.open('albus-lab',1);req.onupgradeneeded=()=>req.result.createObjectStore('books',{keyPath:'id'});req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
export async function books(){const db=await dbp;return new Promise((resolve,reject)=>{const r=db.transaction('books').objectStore('books').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
export async function save(book){const db=await dbp;return new Promise((resolve,reject)=>{const t=db.transaction('books','readwrite');t.objectStore('books').put(book);t.oncomplete=resolve;t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error);});}
export function readLocal(key,fallback){try{return JSON.parse(localStorage.getItem('albus:'+key))??fallback;}catch{return fallback;}}
export function writeLocal(key,value){try{localStorage.setItem('albus:'+key,JSON.stringify(value));return true;}catch{return false;}}
