const dbp=new Promise((resolve,reject)=>{const req=indexedDB.open('albus-lab',1);req.onupgradeneeded=()=>req.result.createObjectStore('books',{keyPath:'id'});req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
export async function books(){const db=await dbp;return new Promise((resolve,reject)=>{const r=db.transaction('books').objectStore('books').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
export async function save(book){const db=await dbp;return new Promise((resolve,reject)=>{const t=db.transaction('books','readwrite');t.objectStore('books').put(book);t.oncomplete=resolve;t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error);});}
export function readLocal(key,fallback){try{return JSON.parse(localStorage.getItem('albus:'+key))??fallback;}catch{return fallback;}}
export function writeLocal(key,value){try{localStorage.setItem('albus:'+key,JSON.stringify(value));return true;}catch{return false;}}

// Delete exactly one imported edition, resolving only after the transaction commits.
export async function deleteBook(id){const db=await dbp;return new Promise((resolve,reject)=>{const t=db.transaction('books','readwrite');t.objectStore('books').delete(id);t.oncomplete=resolve;t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error||Error('删除已取消'));});}
export function withoutBookRecords(id,progress,marks){const next={...progress};delete next[id];return {progress:next,marks:marks.filter(m=>m.id!==id)};}
// Keep the seven series slots, but render every distinct imported edition.
export function shelfEntries(library){const result=[];for(let i=0;i<7;i++){const editions=library.filter(b=>b.order===i+1);if(editions.length)for(const book of editions)result.push({book,index:i});else result.push({book:null,index:i});}for(const book of library.filter(b=>!Number.isInteger(b.order)||b.order<1||b.order>7))result.push({book,index:-1});return result;}
