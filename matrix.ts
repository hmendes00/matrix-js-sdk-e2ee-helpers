import { CreatePickleKey, crossSigningCallbacks, GetPickleKey } from './ssss';
import { createClient, ICreateClientOpts, MatrixClient, Room } from 'matrix-js-sdk';
import { decryptAES, encryptAES, IEncryptedPayload } from 'matrix-js-sdk/lib/crypto/aes';
import { ref, Ref } from 'vue'; // I am using VUE. ref and REF here is just to make it reactive. You should use your own way to set reactivity or handle firstSync and basicSetupDone state how you believe fits better
import { IdbLoad, IdbSave } from './idb-helper';
import { GenerateClientOptsEncryption, GetCryptoStore, PickleKeyToAesKey, SetupCryptoBasics } from './crypto';
import { CreateIndexDBStore } from './store';

export interface MatrixServiceInterface {
    client?: MatrixClient;
    getClient(): MatrixClient;
    firstSyncDone: Ref<boolean>;
    getDeviceId(): string;
    setDeviceId(deviceId: string): void;
    getUserId(): string;
    setUserId(deviceId: string): void;
    hasStoreInitialized(): boolean;
    isLoggedIn: boolean;
    isBasicSetupDone: Ref<boolean>;
    getCachedAccessToken(): Promise<string>;
    cacheAccessToken(accessToken: string): Promise<void>;
}

export interface VirtualRoomObjInterface {
    id: string;
    room: Room;
}

export const MatrixService: MatrixServiceInterface = {
    client: undefined,
    hasStoreInitialized: () => localStorage.getItem('mx_store_init') === 'true',
    getDeviceId: () => localStorage.getItem('deviceId') as string,
    setDeviceId: (deviceId: string) => localStorage.setItem('deviceId', deviceId),
    getUserId: () => localStorage.getItem('mxUserId') as string,
    setUserId: (userId: string) => localStorage.setItem('mxUserId', userId),
    getClient: () => {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return MatrixService.client!;
    },
    getCachedAccessToken: async () => {
        let encryptedAccessToken;
        let accessToken = localStorage.getItem("mx_access_token") || '';
        try {
            encryptedAccessToken = await IdbLoad("account", "mx_access_token");
        } catch (error) {
            console.log('idbLoad failed to read mx_access_token in account table', error);  
        }

        if (!encryptedAccessToken) {
            if (accessToken) {
                try {
                    // try to migrate access token to IndexedDB if we can
                    await IdbSave("account", "mx_access_token", accessToken);
                    localStorage.removeItem("mx_access_token"); //remove from localStorage
                } catch (e) {
                    console.log("migration of access token to IndexedDB failed", e);
                }
            }
        }

        const pickleKey = await GetPickleKey(MatrixService.getUserId(), MatrixService.getDeviceId());
        
        if(pickleKey && encryptedAccessToken) {
            const aesKey = await PickleKeyToAesKey(pickleKey);
            accessToken = await decryptAES(encryptedAccessToken, aesKey, 'access_token');
            aesKey.fill(0);
        }

        return accessToken;
    },
    cacheAccessToken: async (accessToken: string) => {
        const client = MatrixService.getClient();
        // store whether we expect to find an access token, to detect the case
        // where IndexedDB is blown away
        if (client.getAccessToken()) {
            localStorage.setItem("mx_has_access_token", "true");
        } else {
            localStorage.deleteItem("mx_has_access_token");
        }

        const pickleKey = await GetPickleKey(MatrixService.getUserId(), MatrixService.getDeviceId());

        if (pickleKey) {
            let encryptedAccessToken: IEncryptedPayload|null = null;

            try {
                const aesKey = await PickleKeyToAesKey(pickleKey);
                encryptedAccessToken = await encryptAES(accessToken, aesKey, 'access_token');
                aesKey.fill(0); // needs to zero it after using
            } catch (error) {
                console.log('Could not encrypt access token')
            }
        
            try {
                // save either the encrypted access token, or the plain access
                // token if we were unable to encrypt (e.g. if the browser doesn't
                // have WebCrypto).
                await IdbSave(
                    'account', 'mx_access_token',
                    encryptedAccessToken || client.getAccessToken(),
                )
            } catch (e) {
                localStorage.setItem("mx_access_token", client.getAccessToken()); 
            }

            localStorage.setItem("mx_has_pickle_key", String(true));

        } else {
            try {
                await IdbSave(
                    "account", "mx_access_token", client.getAccessToken(),
                );
            } catch (e) {
                localStorage.setItem("mx_access_token", client.getAccessToken());
            }
            if (localStorage.getItem("mx_has_pickle_key")) {
                console.log("Expected a pickle key, but none provided.  Encryption may not work.");
            }
        }
    },
    isLoggedIn: false,
    firstSyncDone: ref(false),
    isBasicSetupDone: ref(false)
}

const CreateOrUpdateClient = (opts: ICreateClientOpts) => {
    if(MatrixService.client) {
        MatrixService.client.stopClient();
    }
    console.log('creating/updating client');
    MatrixService.client = createClient(opts);
} 

export const GetClient = () => MatrixService.getClient();

export const Login = async (username: string, password: string) => {
    try {
        const cachedAccessToken = await MatrixService.getCachedAccessToken();
        const client = GetClient();
        if(cachedAccessToken) {
            CreateOrUpdateClient({
                    baseUrl: 'YOUR_MATRIX_SERVER_URL',
                    deviceId: MatrixService.getDeviceId(),
                    accessToken: cachedAccessToken,
                    userId: MatrixService.getUserId(),
                    store: client.store
                }
            )
        } else {
        
            // eslint-disable-next-line @typescript-eslint/camelcase
            const result = await client.login('m.login.password', { user: username, password, device_id: MatrixService.getDeviceId() });
            
            if(!MatrixService.getDeviceId()) {
                MatrixService.setDeviceId(result.device_id);
            }

            if(!MatrixService.getUserId()) {
                MatrixService.setUserId(client.getUserId());
            }

            await CreatePickleKey(MatrixService.getUserId(), MatrixService.getDeviceId())
        }
        MatrixService.isLoggedIn = true;
        
        return Promise.resolve(true);
    } catch (error) {
        console.log('Error when trying to login to mx', error);
        return Promise.reject('Could not login');
    } finally {
        await GetCryptoStore().startup();
        const clientOpts = await GenerateClientOptsEncryption(GetClient(), MatrixService.getDeviceId());
        Object.assign(clientOpts.cryptoCallbacks, crossSigningCallbacks);
        CreateOrUpdateClient(clientOpts);
        await SetupCryptoBasics(GetClient(), MatrixService.getDeviceId());
        await MatrixService.cacheAccessToken(GetClient().getAccessToken());
    }
}

export const IsLoggedIn = (): boolean => {
    return MatrixService.isLoggedIn;
}

export const SetupMatrixBasics = async () => {
    const store = await CreateIndexDBStore();

    if(!MatrixService.hasStoreInitialized()) {
        console.log('Could not setup mx basics. Encrypted is disabled');
        return;
    }
    await CreateOrUpdateClient({ 
        baseUrl: 'YOUR_MATRIX_SERVER_URL',
        deviceId: MatrixService.getDeviceId(),
        timelineSupport: true,
        store
    });
    MatrixService.isBasicSetupDone.value = true;
}

export const StartClient = () => {
    return GetClient().startClient({ initialSyncLimit: 10 });
}

export const GetRoomAccountData = (roomId: string) => {
    return GetClient().getRoom(roomId).accountData;
}

export const GetVirtualRooms = (): VirtualRoomObjInterface[] => {
    return GetClient().getRooms().map((room) => ({room, id: room.roomId }));
}
