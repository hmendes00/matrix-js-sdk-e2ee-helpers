import { EventType, IndexedDBStore, MatrixEvent } from 'matrix-js-sdk';

class CustomIndexedDBStore extends IndexedDBStore {
    /**
     * Get account data event by event type
     * @param {string} eventType The event type being queried
     * @return {?MatrixEvent} the user account_data event of given type, if any
     */
     public getAccountData(eventType: EventType | string): MatrixEvent {
        return this.accountData[eventType];
    }
}

export const CreateIndexDBStore = async () => {
    const store = new CustomIndexedDBStore({ localStorage, indexedDB: indexedDB, dbName: 'matrix-js-sdk-store-name'});
    await store.startup(); // load from indexed db
    localStorage.setItem('mx_store_init', 'true');
    return store;
};

export const storeExists = async () => {
    const exists = await IndexedDBStore.exists(
        indexedDB, 'matrix-js-sdk-store-name',
    );
    if(!exists) {
        console.log('Store does not exist or was deleted');
        
        //TODO: recommend a full sync or do full sync automatically
    }

    return exists;
}
