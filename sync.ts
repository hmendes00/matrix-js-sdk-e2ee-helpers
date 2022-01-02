import { MatrixEvent, Room, RoomMember } from 'matrix-js-sdk';
import { GetClient, MatrixService } from './matrix';

const HandleMessage = (event: MatrixEvent) => {
    console.log('Event.decrypted %o', event.getContent());
}

export const RoomTimelineListener = () => {
    GetClient().on("Room.timeline", (event: MatrixEvent, room: Room, toStartOfTimeline) => {
        console.log('eeencrypted')
        if (event.isEncrypted()) {
            // handling in handleEventDecrypted
            console.log('is encrypted');
            return;
        }

        if(event.getType() === 'm.room.message') {
            HandleMessage(event)
        }

        console.log('NOT ENCRYPTED');
      
        console.log('Room.timeline', event);
        
    });
}

export const RoomMessageListener = () => {
    GetClient().on("room.message", async (event: MatrixEvent, room: Room, toStartOfTimeline) => {
        console.log('ENCRYPTED')
        if (event.isEncrypted()) {
          // handling in handleEventDecrypted
          console.log('ENCRYPTED')
          return;
        }
        HandleMessage(event);
          // we know we only want to respond to messages
          if (event.getType() !== "m.room.message") {
          return;
          } else {
            HandleMessage(event);
          }
      });
    
}

export const EventDecryptedListener = () => {
    GetClient().on("Event.decrypted", async (event: MatrixEvent) => {
        console.log('Event decryption try of type %o',  event.getType())
        if (event.isDecryptionFailure()) {
            console.log("Decryption failure: ", event);
          return;
        }
        HandleMessage(event);
        if (event.getType() === "m.room.message"){
            HandleMessage(event);
        }
    });
}

const RoomKeyRequestListener = () => {
    GetClient().on("crypto.roomKeyRequest", (event) => {
        console.log('requested key');
        event.share();
    });
}

const InviteUserToRoom = async (roomId: string, userId: string) => {
    await GetClient()
        .invite(roomId, userId)
        .then(() => {
            console.log('User was invited');
        })
        .catch((err) => {
            console.error("err", err);
        });

    await GetClient().sendSharedHistoryKeys(roomId, [userId]);
}

const JoinRoomListener = () => {
    const _client = GetClient();
    _client.on("RoomMember.membership", (event: MatrixEvent, member: RoomMember) => {
        if (member.membership === "invite" && member.userId === _client.getUserId()) {
            _client.joinRoom(member.roomId).then(function() {
                console.log("Auto-joined %s", member.roomId);
            });
        }
    });
}

const SetupEventBindings = () => {
    JoinRoomListener();
    RoomTimelineListener();
    EventDecryptedListener();
    RoomMessageListener();
    RoomKeyRequestListener();
}

export const PrepareSync = () => {
    const _client = GetClient();
    _client.once('sync', async (state) => {
        switch (state) {
            case 'PREPARED':
                // eslint-disable-next-line no-case-declarations
                const _rooms = _client.getRooms();
                await _client.uploadKeys();
                SetupEventBindings();
                MatrixService.firstSyncDone.value = true;
                _client.removeListener('sync', PrepareSync);
                break;
            case 'ERROR':
                _client.removeListener('sync', PrepareSync);
                break;
        }
    });
}
