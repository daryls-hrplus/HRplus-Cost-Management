(()=>{
  'use strict';
  const DB_NAME='hrplus-cost-management', STORE='datasets', VERSION=2;
  let db=null;
  const request=(r)=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error||new Error('IndexedDB request failed.'))});
  const unavailable=()=>!window.indexedDB;
  window.HRplusStorage={
    available:()=>!unavailable(),
    initialize:async()=>{if(unavailable())throw new Error('IndexedDB is unavailable. Imported records cannot be restored after refresh.');db=await new Promise((resolve,reject)=>{const r=indexedDB.open(DB_NAME,VERSION);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(STORE))r.result.createObjectStore(STORE,{keyPath:'id'})};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error||new Error('Unable to open browser storage.'))})},
    saveDataset:async(id,data)=>{if(!db)throw new Error('Browser storage is not initialized.');return request(db.transaction(STORE,'readwrite').objectStore(STORE).put({...data,id}))},
    getDataset:async id=>{if(!db)return null;return request(db.transaction(STORE,'readonly').objectStore(STORE).get(id))},
    deleteDataset:async id=>{if(!db)return;return request(db.transaction(STORE,'readwrite').objectStore(STORE).delete(id))},
    clearAllDatasets:async()=>{if(!db)return;return request(db.transaction(STORE,'readwrite').objectStore(STORE).clear())}
  };
})();