
import { ICreateClientOpts, IndexedDBCryptoStore, MatrixClient } from 'matrix-js-sdk';
import { verificationMethods } from 'matrix-js-sdk/lib/crypto';
import { IVerificationChannel } from 'matrix-js-sdk/lib/crypto/verification/request/Channel';
import { VerificationRequest } from 'matrix-js-sdk/lib/crypto/verification/request/VerificationRequest';

// send request to specific account
let currentVerificationRequest: VerificationRequest|null = null;

interface VerificationChallengeInterface {
    challenge: Array<any>;
    handleResult(challengeMatches: any): void;
    cancel(): void;
    cancelPromise: Promise<VerificationRequest<IVerificationChannel>>;
}

interface CryptoServiceInterface {
    cryptoStore?: IndexedDBCryptoStore;
    isDeviceVerified(): boolean;
    verificationChallengeObj: Promise<VerificationChallengeInterface|null>;
}

export const CryptoService: CryptoServiceInterface = {
    cryptoStore: undefined,
    isDeviceVerified: () => !!localStorage.getItem('deviceVerified'),
    verificationChallengeObj: Promise.resolve(null)

}

// The pickle key is a string of unspecified length and format.  For AES, we
// need a 256-bit Uint8Array. So we HKDF the pickle key to generate the AES
// key.  The AES key should be zeroed after it is used.
export const PickleKeyToAesKey = async (pickleKey: string): Promise<Uint8Array> => {
  const pickleKeyBuffer = new Uint8Array(pickleKey.length);
  for (let i = 0; i < pickleKey.length; i++) {
      pickleKeyBuffer[i] = pickleKey.charCodeAt(i);
  }
  const hkdfKey = await window.crypto.subtle.importKey(
      "raw", pickleKeyBuffer, "HKDF", false, ["deriveBits"],
  );
  pickleKeyBuffer.fill(0);
  return new Uint8Array(await window.crypto.subtle.deriveBits(
      {
          name: "HKDF", hash: "SHA-256",
          // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
          // @ts-ignore: https://github.com/microsoft/TypeScript-DOM-lib-generator/pull/879
          salt: new Uint8Array(32), info: new Uint8Array(0),
      },
      hkdfKey,
      256,
  ));
}

export const GetCryptoStore = () => {
    if(!CryptoService.cryptoStore) {
        CryptoService.cryptoStore = new IndexedDBCryptoStore(
            indexedDB, 'your-crypto-store-name',
        );
    }

    return CryptoService.cryptoStore;
}

export const DownloadMyKeys = (client: MatrixClient) => {
    return client.downloadKeys([client.getUserId()]);
}

export const GenerateClientOptsEncryption = (client: MatrixClient, deviceId: string): ICreateClientOpts => { 
    return { 
        baseUrl: 'ADD_YOUR_MATRIX_URL_HERE',
        cryptoStore: GetCryptoStore(),
        deviceId: client.getDeviceId() || deviceId,
        accessToken: client.getAccessToken(),
        userId: client.getUserId(),
        store: client.store,
        sessionStore: {
            setLocalTrustedBackupPubKey: (trustedPubKey) => localStorage.setItem('inPrivateMatrixPubKey', trustedPubKey),
            getLocalTrustedBackupPubKey: () => localStorage.getItem('inPrivateMatrixPubKey')
        },
        cryptoCallbacks: {},
        verificationMethods: [verificationMethods.SAS]
    };
}

const StartVerification = async (request: VerificationRequest): Promise<VerificationChallengeInterface> => {
    if (!request.verifier) {
      if (!request.initiatedByMe) {
        await request.accept();
        if (request.cancelled) {
          throw new Error("verification aborted");
        }
        // Auto chose method as the only one we both support.
        await request.beginKeyVerification(
          request.methods[0],
          request.targetDevice
        );
      } else {
        await request.waitFor(() => request.started || request.cancelled);
      }
      if (request.cancelled) {
        throw new Error("verification aborted");
      }
    }
    const sasEventPromise = new Promise<any>(resolve =>
      request.verifier.once("show_sas", resolve)
    );
    request.verifier.verify();
    const sasEvent = await sasEventPromise;
    if (request.cancelled) {
      throw new Error("verification aborted");
    }
    let challenge = [];
    if (sasEvent.sas.emoji) {
      challenge = sasEvent.sas.emoji;
    } else if (sasEvent.sas.decimal) {
      challenge = sasEvent.sas.decimal;
    } else {
      sasEvent.cancel();
      throw new Error("unknown verification method");
    }
    // here you should call a screen that will display the EMOJIs to define if they match or not
    // the object returned here will be accessed from that screen and you will have access to the emoji
    // list and the functions to confirm match or not (and the option to cancel).
    router.push('/popup/device-verification'); // replace this with your wait to call another screen (this will only work for SPA applications because the object will be in memory.) You can also call a modal window instead
    return {
      challenge,
      handleResult(challengeMatches) {
        // challengeMatches is true if it matches and false if not.
        if (!challengeMatches) {
          sasEvent.mismatch();
        } else {
          sasEvent.confirm();
        }
      },
      cancel() {
        if (!request.cancelled) {
          sasEvent.cancel();
        }
      },
      cancelPromise: request.waitFor(() => request.cancelled),
    };
}

export const SendVerificationRequest = async (client: MatrixClient) => {
    currentVerificationRequest = await client.requestVerification(client.getUserId());
    CryptoService.verificationChallengeObj = StartVerification(currentVerificationRequest);
}

const verifyDevice = async (client: MatrixClient, userId: string, deviceId: string) => {
    await client.setDeviceKnown(userId, deviceId, true);
    await client.setDeviceVerified(userId, deviceId, true);
}

/**
 * Check (by userId) if device is verified
 */
 const IsDeviceVerified = (client: MatrixClient, deviceId: string, userId: string): boolean => {
    const device = client.getStoredDevice(userId, deviceId);
    return !device.isUnverified();
}

export const SetupCryptoBasics = async (client: MatrixClient, deviceId: string) => {
  await client.initCrypto();
  await DownloadMyKeys(client);
  if(!IsDeviceVerified(client, deviceId, client.getUserId())) {
      SendVerificationRequest(client);
  }
}
