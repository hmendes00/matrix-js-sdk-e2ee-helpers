# matrix-js-sdk-e2ee-helpers
This REPO is intended to help people having a hard time to setup e2ee using matrix-js-sdk.

# Skeleton Project Using Ionic + Vue + Matrix-js-sdk
[matrix-ionic-vue-e2ee-skeleton](https://github.com/hmendes00/matrix-ionic-vue-e2ee-skeleton)

# Before Getting Started

I am not good at e2ee so I don't understand basic concepts of it. I tried to compile some of the functions that I am using that might help someone else as well.
If you understand it and believe some parts could be improved, feel free to do so.

This should be a collaborative REPO to help people have this setup with less headaches.

I'll try to explain when each function should be called in the next topic.

One more thing:
Every here reflects my experience setting up this in my Ionic + Vue project.
It might not be exactly the same thing for someone else, but hopefully it will still
help them somehow.

# How to use it

One of the libraries used for encryption is Olm so you will need to install it as well (at least I had to)
(I AM ADDING MY CURRENT PACKAGE.JSON to this project as well)

for Olm basically add this line to your dependencies list on package.json
"olm": "https://packages.matrix.org/npm/olm/olm-3.2.1.tgz"

You might have to play with you tsconfig/jsconfig. I am adding mine just in case.

-----
The first thing you will need to do is to add `Olm` library to your `globals`.
In you main.js/main.ts file, add the following:
`import Olm from 'olm';`
`global.Olm = Olm;`

then add a reference to the `./matrix.ts` that we have available in the repo so you can setup the basics for e2ee
`import { SetupMatrixBasics } from './matrix';`
then call
`SetupMatrixBasics();`

That part should be done before anything else in your code. This will make sure we have everything setup and ready to be called in other files

-------
After basic setup is done (You will need to track if it's done or not - in the `matrix.ts` file I am tracking it with Ref/ref of vue to have some reactivity

In your login page, add an import to the following functions of our `matrix.ts` and `sync.ts` helpers, respectively:
`import { IsLoggedIn, Login, MatrixService, StartClient } from './matrix';`
`import { PrepareSync } from './sync';`

If using vue 3 as well, you can use `watch` from `import { watch } from 'vue'`
```
watch(MatrixService.isBasicSetupDone, (isSetupDone) => {
      if(isSetupDone && !IsLoggedIn()) {
        Login('your-user', 'your-password').then(async () => {
          await StartClient();
          await PrepareSync();
          
        });
      }
    })
```

if not you just need to make sure the basic setup is done and the user is not already logged in, then call the login part:
```
 Login('your-user', 'your-password').then(async () => {
    await StartClient();
    await PrepareSync();
 });
```

To load the chat list, make sure the firstSync is done

`import { GetRoomAccountData, GetVirtualRooms, MatrixService, VirtualRoomObjInterface } from './matrix';`

Again, if using vue 3:

```
const rooms = ref(Array<VirtualRoomObjInterface>());
watch(MatrixService.firstSyncDone, (isSynced) => {
  if(isSynced) {
    rooms.value = GetVirtualRooms();
  }
});
```

if not, you can just call `GetVirtualRooms()` when firstSyncDone is actually done

------
At this point, when you load the page, if you have encryption set in another device already, it should send a request to it (A NEW DEVICE IS TRYING TO ACCESS YOUR ACCOUNT)

Then you would need to hit Verify (in the one already setup) to proceed to the EMOJI match part.

in your new screen you can create an emoji-verification modal or component and call it from the `crypto.ts` file
you will see the following line there:
`router.push('/popup/device-verification');`

That line should be replaced with the way you use to open the modal or to call the emoji-verification-screen component.

--------
In the emoji-verification-screen, add the following import
`import { CryptoService } from './crypto';`

From there you should have access to the *in-memory* challenge step

```
const verification = await CryptoService.verificationChallengeObj.then((verification) => verification);
    
    if(!verification || !verification.challenge.length) {
      router.push('/home');
      return;
    }
    
    const emojis = verification.challenge.map((emoji) => {
      return {
        emoji: emoji[0],
        label: emoji[1]
      }
    });
    
    // list here should be the list you want to display. It will hold an array of objects containing {emoji, label}. It should work out of the box by
    // just displaying it in the html (because it's a browser emoji)
    this.list = emojis; 
```

For the sake of example, I am adding the HTML I have in my Ionic application to display the emojis:

```
<template>
  <ion-page>
      <ion-header collapse="condense" class="space-between header-padding">
          <ion-label class="bold-max">Verify other login</ion-label>
      </ion-header>
    <ion-content class="ion-padding bold-500">
      <ion-text>Confirm the emoji below are displayed on both sessions, in the same order:</ion-text>
      <div class="emoji-wrapper">
        <ion-item  lines="none" class="emoji-item" v-for="(item,index) in this.list" :key="index">
          <div class="item-content">
            <ion-label class="emoji">{{ item.emoji }}</ion-label>
            <ion-label>{{ item.label }}</ion-label>
          </div>
        </ion-item>
      </div>
      <div class="confirm-area">
        <ion-button color="danger" @click="submitMatch(false)">They don't match</ion-button>
        <ion-button color="success" @click="submitMatch(true)">They match</ion-button>
      </div>
    </ion-content>
  </ion-page>
</template>
```

You will see I have two buttons: "They don't match" and "They match" calling the `submitMatch(boolean)` function.
That function is also available *in-memory*.

If you are using Vue 3, you can declare it like so:

```
methods: {
    async submitMatch(emojisMatch: boolean) {
      const verification = await CryptoService.verificationChallengeObj.then((verification) => verification);
      verification?.handleResult(emojisMatch);
      router.push('/home'); // redirecting to the home page after confirmed or not
    },
}
```

You should be able to adapt the code above to your own frontend framework.

-------
That part should confirm the emojis own your side.. and if you confirmed the emojis in the current logged in device as well, you should now have access to the rooms and encrypted conversations from before.

If you never had a device connected before, then encryption should be all set as well.

# Notes

The `ssss.ts` file was created when I was trying to go to a different path, but it should be fixed to suport the ssss restore from backup, etc.

Again, I am not good at e2ee and I tried my best here to make this work and it finally works on my app. It's also caching the user (by encrypting it's access_token) so next time a user loads the page, it doesn't have to go through login and a bunch of other steps. It will load things from cache.

------

# E2EE Resources

From [Matrix Channel](https://www.youtube.com/channel/UCin7rgh4DiVxnvMsgRJf74g):

https://www.youtube.com/watch?v=QSeVHiN1dJE

More Resources:
The following videos were recommended by [@nahakiole](https://github.com/nahakiole) and actually helped me to better understand basic concept of encryption itself.

Secret Key Exchange (Diffie-Hellman):
https://www.youtube.com/watch?v=NmM9HA2MQGI

Instant Messaging und das Signalprotokoll:
https://www.youtube.com/watch?v=DXv1boalsDI

Double Ratchet Messaging Encryption - Computerphile:
https://www.youtube.com/watch?v=9sO2qdTci-s

What's Up With Group Messaging? - Computerphile:
https://www.youtube.com/watch?v=Q0_lcKrUdWg

End to End Encryption (E2EE) - Computerphile:
https://www.youtube.com/watch?v=jkV1KEJGKRA



------

If this REPO helps 1 person, I will already be very happy :)

Please, help me improve it if you think it can be improved (I am sure it can).

If you can add details on why things are happening that way, etc, feel free to do so as well.

There's no ownership in this REPO. This is to help anyone who's trying to understand/setup e2ee using matrix-js-sdk

Thanks!
