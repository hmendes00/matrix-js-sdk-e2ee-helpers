import { GetClient } from './matrix';
import { ICryptoCallbacks } from 'matrix-js-sdk';
import { ISecretStorageKeyInfo } from 'matrix-js-sdk/lib/crypto/api';
import { DeviceTrustLevel } from 'matrix-js-sdk/lib/crypto/CrossSigning';
import { encodeBase64, encodeUnpaddedBase64 } from 'matrix-js-sdk/lib/crypto/olmlib';
import { deriveKey } from 'matrix-js-sdk/src/crypto/key_passphrase';
import { decodeRecoveryKey } from 'matrix-js-sdk/src/crypto/recoverykey';
import { IdbLoad, IdbSave } from './idb-helper';

const secretStorageBeingAccessed = false;
const secretStorageKeys: Record<string, Uint8Array> = {};
const secretStorageKeyInfo: Record<string, ISecretStorageKeyInfo> = {};

let dehydrationCache: {
    key?: Uint8Array;
    keyInfo?: ISecretStorageKeyInfo;
} = {};

function isCachingAllowed(): boolean {
    return secretStorageBeingAccessed;
}

function cacheSecretStorageKey(
    keyId: string,
    keyInfo: ISecretStorageKeyInfo,
    key: Uint8Array,
): void {
    if (isCachingAllowed()) {
        secretStorageKeys[keyId] = key;
        secretStorageKeyInfo[keyId] = keyInfo;
    }
}

function makeInputToKey(
    keyInfo: ISecretStorageKeyInfo,
): (keyParams: { passphrase: string; recoveryKey: string }) => Promise<Uint8Array> {
    return async ({ passphrase, recoveryKey }) => {
        if (passphrase) {
            return deriveKey(
                passphrase,
                keyInfo.passphrase.salt,
                keyInfo.passphrase.iterations,
            );
        } else {
            return decodeRecoveryKey(recoveryKey);
        }
    };
}

async function getSecretStorageKey(
    { keys: keyInfos }: { keys: Record<string, ISecretStorageKeyInfo> },
    ssssItemName
): Promise<any> {
    const cli = GetClient();
    let keyId = await cli.getDefaultSecretStorageKeyId();
    let keyInfo;
    if(!keyInfos) {
        return ['', new Uint8Array()];
    }
    if (keyId) {
        // use the default SSSS key if set
        keyInfo = keyInfos[keyId];
        if (!keyInfo) {
            // if the default key is not available, pretend the default key
            // isn't set
            keyId = '';
        }
    }
    console.log('keyid',keyInfos[keyId]);
    if (!keyId) {
        // if no default SSSS key is set, fall back to a heuristic of using the
        // only available key, if only one key is set
        const keyInfoEntries = Object.entries(keyInfos);
        if (keyInfoEntries.length > 1) {
            throw new Error("Multiple storage key requests not implemented");
        }
        if(keyInfoEntries[0]) {
            keyId = keyInfoEntries[0][0];
            keyInfo = keyInfoEntries[0][1];
        }
    }

    // Check the in-memory cache
    if (isCachingAllowed() && secretStorageKeys[keyId]) {
        return [keyId, secretStorageKeys[keyId]];
    }

    if (dehydrationCache.key) {
        if (await GetClient().checkSecretStorageKey(dehydrationCache.key, keyInfo)) {
            cacheSecretStorageKey(keyId, keyInfo, dehydrationCache.key);
            return [keyId, dehydrationCache.key];
        }
    }

    const inputToKey = makeInputToKey(keyInfo);

    const recoveryKey = await GetClient().createRecoveryKeyFromPassphrase('----');
    const key = await inputToKey({passphrase: '', recoveryKey: recoveryKey.keyInfo?.pubkey!});
    // console.log(recoveryKey);
    // const key = recoveryKey.keyInfo?.key;

    console.log('GOT IT', key, keyId);
    // Save to cache to avoid future prompts in the current session
    cacheSecretStorageKey(keyId, keyInfo, key);
    if(keyId && key) {
        return [keyId, key];
    }
        
    return ['', new Uint8Array()]
    
}

export async function getDehydrationKey(
    keyInfo: ISecretStorageKeyInfo,
    checkFunc: (Uint8Array) => void,
): Promise<Uint8Array> {
    const inputToKey = makeInputToKey(keyInfo);
    const key = await inputToKey({ passphrase: '', recoveryKey: ''});

    // need to copy the key because rehydration (unpickling) will clobber it
    dehydrationCache = { key: new Uint8Array(key), keyInfo };

    return key;
}


async function onSecretRequested(
    userId: string,
    deviceId: string,
    requestId: string,
    name: string,
    deviceTrust: DeviceTrustLevel,
): Promise<string> {
    console.log("onSecretRequested", userId, deviceId, requestId, name, deviceTrust);
    const client = GetClient();
    if (userId !== client.getUserId()) {
        return '';
    }
    if (!deviceTrust || !deviceTrust.isVerified()) {
        console.log(`Ignoring secret request from untrusted device ${deviceId}`);
        return '';
    }
    if (
        name === "m.cross_signing.master" ||
        name === "m.cross_signing.self_signing" ||
        name === "m.cross_signing.user_signing"
    ) {
        const callbacks = client.getCrossSigningCacheCallbacks();
        if (!callbacks.getCrossSigningKeyCache) return '';
        const keyId = name.replace("m.cross_signing.", "");
        const key = await callbacks.getCrossSigningKeyCache(keyId);
        if (!key) {
            console.log(
                `${keyId} requested by ${deviceId}, but not found in cache`
            );
        }
        return key && encodeBase64(key);
    } else if (name === "m.megolm_backup.v1") {
        const key = await client.crypto.getSessionBackupPrivateKey();
        if (!key) {
            console.log(
                `session backup key requested by ${deviceId}, but not found in cache`,
            );
        }
        if(key) {
            return encodeBase64(key);
        }
    }
    console.log("onSecretRequested didn't recognise the secret named ", name);
    return '';
}

export const crossSigningCallbacks: ICryptoCallbacks = {
    getSecretStorageKey,
    cacheSecretStorageKey,
    onSecretRequested,
    getDehydrationKey,
};

/**
* Get a previously stored pickle key.  The pickle key is used for
* encrypting libolm objects.
* @param {string} userId the user ID for the user that the pickle key is for.
* @param {string} userId the device ID that the pickle key is for.
* @returns {string|null} the previously stored pickle key, or null if no
*     pickle key has been stored.
*/
export const GetPickleKey = async (userId: string, deviceId: string): Promise<string | null> => {
   if (!window.crypto || !window.crypto.subtle) {
       return null;
   }
   let data;
   try {
       data = await IdbLoad("pickleKey", [userId, deviceId]);
   } catch (e) {
       console.log("idbLoad for pickleKey failed", e);
   }
   if (!data) {
       return null;
   }
   if (!data.encrypted || !data.iv || !data.cryptoKey) {
    console.log("Badly formatted pickle key");
       return null;
   }

   const additionalData = new Uint8Array(userId.length + deviceId.length + 1);
   for (let i = 0; i < userId.length; i++) {
       additionalData[i] = userId.charCodeAt(i);
   }
   additionalData[userId.length] = 124; // "|"
   for (let i = 0; i < deviceId.length; i++) {
       additionalData[userId.length + 1 + i] = deviceId.charCodeAt(i);
   }

   try {
       const key = await crypto.subtle.decrypt(
           { name: "AES-GCM", iv: data.iv, additionalData }, data.cryptoKey,
           data.encrypted,
       );
       return encodeUnpaddedBase64(key);
   } catch (e) {
    console.log("Error decrypting pickle key");
       return null;
   }
}

/**
     * Create and store a pickle key for encrypting libolm objects.
     * @param {string} userId the user ID for the user that the pickle key is for.
     * @param {string} deviceId the device ID that the pickle key is for.
     * @returns {string|null} the pickle key, or null if the platform does not
     *     support storing pickle keys.
     */
 export const CreatePickleKey = async (userId: string, deviceId: string): Promise<string | null> => {
    if (!window.crypto || !window.crypto.subtle) {
        return null;
    }
    const crypto = window.crypto;
    const randomArray = new Uint8Array(32);
    crypto.getRandomValues(randomArray);
    const cryptoKey = await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"],
    );
    const iv = new Uint8Array(32);
    crypto.getRandomValues(iv);

    const additionalData = new Uint8Array(userId.length + deviceId.length + 1);
    for (let i = 0; i < userId.length; i++) {
        additionalData[i] = userId.charCodeAt(i);
    }
    additionalData[userId.length] = 124; // "|"
    for (let i = 0; i < deviceId.length; i++) {
        additionalData[userId.length + 1 + i] = deviceId.charCodeAt(i);
    }

    const encrypted = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData }, cryptoKey, randomArray,
    );

    try {
        await IdbSave("pickleKey", [userId, deviceId], { encrypted, iv, cryptoKey });
    } catch (e) {
        return null;
    }
    return encodeUnpaddedBase64(randomArray);
}
