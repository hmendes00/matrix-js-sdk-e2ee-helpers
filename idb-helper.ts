// just *accessing* indexedDB throws an exception in firefox with

// indexeddb disabled.
let indexedDB: IDBFactory;
try {
    indexedDB = window.indexedDB;
} catch (e) {
    // nothing to show
}


/* Simple wrapper functions around IndexedDB.
 */

let idb: IDBDatabase|null = null;

async function IdbInit(): Promise<void> {
    if (!indexedDB) {
        throw new Error("IndexedDB not available");
    }
    idb = await new Promise((resolve, reject) => {
        const request = indexedDB.open('indexdb-name-to-hold-account-data', 1);
        request.onerror = reject;
        request.onsuccess = (event) => { resolve(request.result); };
        request.onupgradeneeded = (event) => {
            const db = request.result;
            db.createObjectStore("pickleKey");
            db.createObjectStore("account");
        };
    });
}

export const IdbLoad = async (
    table: string,
    key: string | string[],
): Promise<any> => {
    if (!idb) {
        await IdbInit();
    }
    return new Promise((resolve, reject) => {
        const txn = idb!.transaction([table], "readonly");
        txn.onerror = reject;

        const objectStore = txn.objectStore(table);
        const request = objectStore.get(key);
        request.onerror = reject;
        request.onsuccess = (event) => { resolve(request.result); };
    });
}

export const IdbSave = async (
    table: string,
    key: string | string[],
    data: any,
): Promise<void> => {
    if (!idb) {
        await IdbInit();
    }
    return new Promise((resolve, reject) => {
        const txn = idb!.transaction([table], "readwrite");
        txn.onerror = reject;

        const objectStore = txn.objectStore(table);
        const request = objectStore.put(data, key);
        request.onerror = reject;
        request.onsuccess = (event) => { resolve(); };
    });
}

export const IdbDelete = async (
    table: string,
    key: string | string[],
): Promise<void> => {
    if (!idb) {
        await IdbInit();
    }
    return new Promise((resolve, reject) => {
        const txn = idb!.transaction([table], "readwrite");
        txn.onerror = reject;

        const objectStore = txn.objectStore(table);
        const request = objectStore.delete(key);
        request.onerror = reject;
        request.onsuccess = (event) => { resolve(); };
    });
}
