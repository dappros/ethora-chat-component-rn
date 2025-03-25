import xmpp from '@xmpp/client';
import {Element} from 'ltx';
import {
  VITE_APP_XMPP_SERVICE,
  VITE_XMPP_HOST,
  VITE_XMPP_SERVICE,
} from '../config/apiService';
import {
  handleComposing,
  handleIqStanza,
  onGetLastMessageArchive,
  onMessageHistory,
  onRealtimeMessage,
} from '../xmpp/stanzaHandlers';
import {rootStore} from '../stores/context';
import {runInAction} from 'mobx';

const xml = xmpp.xml;

const XMPP_SERVICE = VITE_XMPP_SERVICE;
const XMPP_HOST = VITE_XMPP_HOST;

class WsClient {
  service = '';
  username = '';
  password = '';
  client: xmpp.Client | null = null;
  resource = '';

  constructor(service: string) {
    this.service = service;
    this.username = '';
    this.password = '';
    this.resource = Date.now().toString();
  }

  checkOnline() {
    return this.client && this.client.status === 'online';
  }

  login(username: string, password: string) {
    try {
      return new Promise((resolve, reject) => {
        this.username = username;
        this.password = password;

        if (this.client && this.client.status === 'online') {
          console.log('Already connected to WS');
          this.client.start().then(() => console.log('reinited'));
          resolve(this.client.jid);
          return;
        }

        if (!this.client) {
          this.client = xmpp.client({
            username: this.username,
            password: this.password,
            service: this.service,
            resource: this.resource,
          });

          this.client.on('online', (jid: unknown) => {
            const message = xml('presence');
            console.log('successfull online');

            if (this.client) {
              this.client.send(message);
              resolve(jid);
            }
          });

          this.client.on('error', (error: any) => {
            console.log('xmpp on error ', error);
            reject(error);
          });

          this.client
            .start()
            .then(() => console.log('inited'))
            .catch(error => console.log(error, 'There were an error'));

          this.client.on('stanza', stanza => {
            switch (stanza.name) {
              case 'message':
                onRealtimeMessage(stanza);
                onMessageHistory(stanza);
                onGetLastMessageArchive(stanza, this);
                handleComposing(stanza, this.username);
                break;
              case 'presence':
                break;
              case 'iq':
                handleIqStanza(stanza);
                onRealtimeMessage(stanza); //check if it should be here
                handleComposing(stanza, this.username);
                break;
              default:
                console.log('Unhandled stanza type:', stanza.name);
            }
          });
          this.client.setMaxListeners(20);
        }
      });
    } catch (error) {
      console.log('login error');
    }
  }

  async subscribe(roomName: string) {
    try {
      if (this.client) {
        const message = xml(
          'iq',
          {
            to: `${roomName}@${VITE_XMPP_SERVICE}`,
            type: 'set',
            id: 'newSubscription',
          },
          xml(
            'subscribe',
            {xmlns: 'urn:xmpp:mucsub:0', nick: this.client?.jid?.getLocal()},
            xml('event', {node: 'urn:xmpp:mucsub:nodes:messages'}),
            xml('event', {node: 'urn:xmpp:mucsub:nodes:presence'}),
          ),
        );

        // console.log('-----> ', message.toString());

        this.client.send(message);
      }
    } catch (error) {
      console.log('sub error');
    }
  }

  async presence(roomJID: string) {
    return new Promise((resolve, reject) => {
      if (this.client) {
        try {
          const presence = xml(
            'presence',
            {
              to: `${roomJID}@${VITE_XMPP_SERVICE}/${this.username}`,
              id: 'presenceInRoom',
            },
            xml('x', {xmlns: 'http://jabber.org/protocol/muc'}),
          );

          this.client
            .send(presence)
            .then(() => {
              resolve('Presence in room sent successfully');
            })
            .catch((error: any) => {
              console.error('Failed to send presence in room:', error);
              reject(error);
            });
        } catch (error) {
          console.error(
            'An error occurred while setting presence in room:',
            error,
          );
          reject(error);
        }
      } else {
        reject('Failed to send presence in room, no inited client');
      }
    });
  }

  sendMessage = (
    roomJID: string,
    firstName: string,
    lastName: string,
    walletAddress: string,
    userMessage: string,
  ) => {
    const id = `send-message:${Date.now().toString()}`;

    try {
      const message = xml(
        'message',
        {
          to: `${roomJID}@${XMPP_SERVICE}`,
          type: 'groupchat',
          id: id,
        },
        xml('data', {
          xmlns: XMPP_SERVICE,
          senderFirstName: firstName,
          senderLastName: lastName,
          senderJID: this?.client?.jid?.toString(),
          senderWalletAddress: walletAddress,
          roomJid: roomJID,
          isSystemMessage: false,
          photoURL: '',
          tokenAmount: 0,
          quickReplies: '',
          notDisplayedValue: '',
          showInChannel: true,
        }),
        xml('body', {}, userMessage),
      );
      this?.client?.send(message);
    } catch (error) {
      console.error('An error occurred while sending message:', error);
    }
  };

  getHistory = async (chatJID: string, max: number, before?: number) => {
    const id = `get-history:${Date.now().toString()}`;

    let stanzaHdlrPointer: {
      (el: Element): void;
      (stanza: any): void;
    };

    const unsubscribe = () => {
      this.client?.off('stanza', stanzaHdlrPointer);
    };

    const responsePromise = new Promise((resolve, reject) => {
      let messages: Element[] = [];

      stanzaHdlrPointer = stanza => {
        const result = stanza.getChild('result');

        if (
          stanza.is('message') &&
          stanza.attrs['from'] &&
          stanza.attrs['from'].startsWith(chatJID) &&
          result
        ) {
          const messageEl = result.getChild('forwarded')?.getChild('message');

          messages.push(messageEl);
        }

        if (
          stanza.is('iq') &&
          stanza.attrs['id'] === id &&
          stanza.attrs['type'] === 'result'
        ) {
          let mainMessages: Record<string, string>[] = [];

          for (const msg of messages) {
            const text = msg.getChild('body')?.getText();

            if (text) {
              let parsedEl: Record<string, string> = {};

              parsedEl.text = text;
              parsedEl.from = msg.attrs['from'];
              parsedEl.id = msg.getChild('archived')?.attrs['id'];
              parsedEl.created = parsedEl.id.slice(0, 13);
              const data = msg.getChild('data');

              if (!data || !data.attrs) {
                continue;
              }

              for (const [key, value] of Object.entries(data.attrs)) {
                parsedEl[key] = value as string;
              }

              // ignore messages wich has isReply but there is no mainMessage field
              if (parsedEl.isReply === 'true' && !parsedEl.mainMessage) {
                continue;
              }

              if (parsedEl.mainMessage) {
                try {
                  parsedEl.mainMessage = JSON.parse(parsedEl.mainMessage);
                } catch (e) {
                  // ignore message if mainMessage is not parsable
                  continue;
                }
              }

              mainMessages.push(parsedEl);
            }
          }
          unsubscribe();
          resolve(mainMessages);
        }

        if (
          stanza.is('iq') &&
          stanza.attrs.id === id &&
          stanza.attrs.type === 'error'
        ) {
          unsubscribe();
          reject();
        }
      };

      this.client?.on('stanza', stanzaHdlrPointer);

      const message = xml(
        'iq',
        {
          type: 'set',
          to: `${chatJID}@${XMPP_SERVICE}`,
          id: id,
        },
        xml(
          'query',
          {xmlns: 'urn:xmpp:mam:2'},
          xml(
            'set',
            {xmlns: 'http://jabber.org/protocol/rsm'},
            xml('max', {}, max.toString()),
            before ? xml('before', {}, before.toString()) : xml('before'),
          ),
        ),
      );

      this.client?.send(message).catch(err => console.log('err on load', err));
    });

    const timeoutPromise = createTimeoutPromise(10000, unsubscribe);

    try {
      const res = await Promise.race([responsePromise, timeoutPromise]);
      return res;
    } catch (e) {
      console.log('=-> error ', e);
      return null;
    }
  };

  getFN(name: string) {
    const id = `get-FN:${Date.now().toString()}`;

    let stanzaHdlrPointer: (stanza: any) => void;

    const unsubscribe = () => {
      this.client?.off('stanza', stanzaHdlrPointer);
    };

    const responsePromise = new Promise((resolve, reject) => {
      stanzaHdlrPointer = stanza => {
        if (
          stanza.is('iq') &&
          stanza.attrs.id === id &&
          stanza.attrs.type === 'result'
        ) {
          const FN = stanza.getChild('vCard')?.getChild('FN')?.getText();
          unsubscribe();
          resolve(FN);
        }

        if (
          stanza.is('iq') &&
          stanza.attrs.id === id &&
          stanza.attrs.type === 'error'
        ) {
          unsubscribe();
          reject();
        }
      };

      this.client?.on('stanza', stanzaHdlrPointer);

      const msg = xml(
        'iq',
        {
          type: 'get',
          id: id,
          to: `${name}@${XMPP_HOST}`,
        },
        xml('vCard', {
          xmlns: 'vcard-temp',
        }),
      );

      // console.log('--------------------------------- >>>>>>> ', msg.toString());
      this.client?.send(msg);
    });

    const timeoutPromise = createTimeoutPromise(1000, unsubscribe);

    return Promise.race([responsePromise, timeoutPromise]);
  }

  getRoomTitle(roomName: string): Promise<string> {
    const id = `get-room-title:${Date.now().toString()}`;

    let stanzaHdlrPointer: (stanza: any) => void;

    const unsubscribe = () => {
      this.client?.off('stanza', stanzaHdlrPointer);
    };

    const responsePromise = new Promise((resolve, reject) => {
      stanzaHdlrPointer = stanza => {
        if (
          stanza.is('iq') &&
          stanza.attrs.id === id &&
          stanza.attrs.type === 'result'
        ) {
          const fields = stanza
            .getChild('query')
            ?.getChild('x')
            ?.getChildren('field');

          let roomTitle = '';
          fields.forEach(
            (el: {
              attrs: {[x: string]: string};
              getChild: (arg0: string) => {
                (): any;
                new (): any;
                getText: {(): string; new (): any};
              };
            }) => {
              if (el.attrs['var'] === 'muc#roomconfig_roomname') {
                roomTitle = el.getChild('value')?.getText();
              }
            },
          );
          unsubscribe();
          resolve(roomTitle);
        }

        if (
          stanza.is('iq') &&
          stanza.attrs.id === id &&
          stanza.attrs.type === 'error'
        ) {
          unsubscribe();
          reject();
        }
      };

      this.client?.on('stanza', stanzaHdlrPointer);

      const message = xml(
        'iq',
        {
          id: id,
          to: `${roomName}@${XMPP_SERVICE}`,
          type: 'get',
        },
        xml('query', {xmlns: 'http://jabber.org/protocol/disco#info'}),
      );
      this.client?.send(message);
    });

    const timeoutPromise: Promise<any> = createTimeoutPromise(
      1000,
      unsubscribe,
    );

    return Promise.race([responsePromise, timeoutPromise]);
  }

  sendTypingRequest(chatId: string, fullName: string, start: boolean) {
    let id = `typing-${Date.now()}`;
    const stanza = xml(
      'message',
      {
        type: 'groupchat',
        id: id,
        to: chatId,
      },
      xml(start ? 'composing' : 'paused', {
        xmlns: 'http://jabber.org/protocol/chatstates',
      }),
      xml('data', {
        fullName: fullName,
      }),
    );

    this.client?.send(stanza);
  }

  getChatsPrivateStoreRequest() {
    const id = `get-chats-private-req:${Date.now().toString()}`;
    let stanzaHdlrPointer: {
      (el: Element): void;
      (stanza: Element): void;
      (el: Element): void;
    };

    const unsubscribe = () => {
      this.client?.off('stanza', stanzaHdlrPointer);
    };

    const responsePromise = new Promise((resolve, _reject) => {
      stanzaHdlrPointer = (stanza: Element) => {
        if (stanza.is('iq') && stanza.attrs.id === id) {
          let chatjson = stanza.getChild('query')?.getChild('chatjson');

          if (chatjson) {
            resolve(chatjson.attrs.value);
          } else {
            resolve(null);
          }
        }
      };

      this.client?.on('stanza', stanzaHdlrPointer);

      const message = xml(
        'iq',
        {
          id: id,
          type: 'get',
        },
        xml(
          'query',
          {xmlns: 'jabber:iq:private'},
          xml('chatjson', {xmlns: 'chatjson:store'}),
        ),
      );

      this.client?.send(message);
    });

    const timeoutPromise = createTimeoutPromise(2000, unsubscribe);

    return Promise.race([responsePromise, timeoutPromise]);
  }

  async actionSetTimestampToPrivateStore(chatId: string, timestamp: number) {
    let storeObj: any = await this.getChatsPrivateStoreRequest();

    if (storeObj && typeof storeObj === 'object') {
      storeObj[chatId] = timestamp;

      const str = JSON.stringify(storeObj);
      await this.setChatsPrivateStoreRequest(str);
      return true;
    } else {
      await this.setChatsPrivateStoreRequest(
        JSON.stringify({[chatId]: timestamp}),
      );
      return true;
    }
  }

  async actionSetChatViewedTimestamp() {
    const chat = rootStore.chatStore.currentRoom;

    if (!chat) {
      return;
    }

    const timestamp = Date.now();

    await this.actionSetTimestampToPrivateStore(chat.localJid, timestamp);
    runInAction(() => rootStore.chatStore.setLastViewedTimestamp(timestamp));
  }

  setChatsPrivateStoreRequest(jsonObj: string) {
    const id = `set-chats-private-req:${Date.now().toString()}`;
    let stanzaHdlrPointer: {
      (el: Element): void;
      (stanza: Element): void;
      (el: Element): void;
    };

    const unsubscribe = () => {
      this.client?.off('stanza', stanzaHdlrPointer);
    };

    const responsePromise = new Promise((resolve, _reject) => {
      stanzaHdlrPointer = (stanza: Element) => {
        if (stanza.is('iq') && stanza.attrs.id === id) {
          resolve(true);
        }
      };

      this.client?.on('stanza', stanzaHdlrPointer);

      const message = xml(
        'iq',
        {
          id: id,
          type: 'set',
        },
        xml(
          'query',
          {xmlns: 'jabber:iq:private'},
          xml('chatjson', {xmlns: 'chatjson:store', value: jsonObj}),
        ),
      );

      this.client?.send(message);
    });

    const timeoutPromise = createTimeoutPromise(2000, unsubscribe);

    return Promise.race([responsePromise, timeoutPromise]);
  }

  getLastMessageArchive(roomJID: string) {
    const message = xml(
      'iq',
      {
        type: 'set',
        to: roomJID,
        id: 'GetArchive',
      },
      xml(
        'query',
        {xmlns: 'urn:xmpp:mam:2'},
        xml(
          'set',
          {xmlns: 'http://jabber.org/protocol/rsm'},
          xml('max', {}, '1'),
          xml('before'),
        ),
      ),
    );
    console.log('sending', message.toString());
    this.client?.send(message);
  }
}

function createTimeoutPromise(
  ms: number | undefined,
  unsubscribe: {(): void; (): void; (): void; (): void},
) {
  return new Promise((_, reject) => {
    setTimeout(() => {
      try {
        unsubscribe();
      } catch (e) {}
      reject();
    }, ms);
  });
}

const wsClient = new WsClient(VITE_APP_XMPP_SERVICE);
export {wsClient};
