import {xml} from '@xmpp/client';
import {Element} from 'ltx';
import {rootStore} from '../stores/context';
import uuid from 'react-native-uuid';
import {runInAction} from 'mobx';
import {Message} from '../stores/types';
import {walletToUsername} from '../helpers/walletToUsername';

// TO DO: we are thinking to refactor this code in the following way:
// each stanza will be parsed for 'type'
// then it will be handled based on the type
// XMPP parsing will be done universally as a pre-processing step
// then handlers for different types will work with a Javascript object
// types: standard, coin transfer, is composing, attachment (media), token (nft) or smart contract
// types can be added into our chat protocol (XMPP stanza add field type="") to make it easier to parse here

export const createMessage = async (
  data: {
    [x: string]: any;
    coinsInMessage?: any;
    numberOfReplies?: any;
    isSystemMessage?: any;
    isMediafile?: any;
    locationPreview?: any;
    mimetype?: any;
    location?: any;
    senderWalletAddress?: any;
    senderFirstName?: any;
    senderLastName?: any;
    photoURL?: any;
    senderJID?: any;
    token?: any;
    refreshToken?: any;
    roomJid?: any;
    tokenAmount?: any;
    quickReplie?: any;
    notDisplayedValue?: any;
    showInChannel?: any;
  },
  body: Element | undefined,
  id: string,
  from: any,
): Promise<Message> => {
  if (!body || typeof body.getText !== 'function') {
    throw new Error("Invalid body: 'getText' method is missing.");
  }

  if (!data || !id || !from) {
    console.log('Invalid arguments: data, id, and from are required.');
  }

  //   1727176680255262 === 1727176680255262 && console.log(data);

  const timestamp = id?.slice(0, 13);
  const date = timestamp && !isNaN(+timestamp) ? new Date(+timestamp).toISOString() : '';


  const fullName = data?.senderLastName
    ? `${data.senderFirstName} ${data?.senderLastName}`
    : `${data.senderFirstName}`;

  const message = {
    id: id,
    _id: id,
    // body: body.getText(),
    roomJID: from,
    date: new Date(+id.slice(0, 13)).toISOString(),
    key: `${Date.now() + Number(id)}`,
    numberOfReplies: data?.numberOfReplies,
    isSystemMessage: data?.isSystemMessage,
    isMediafile: data?.isMediafile,
    locationPreview: data?.locationPreview,
    mimetype: data?.mimetype,
    location: data?.location,
    user: {
      id: data.senderWalletAddress,
      name: fullName,
      avatar: data.photoURL,
      jid: data.senderJID,
      token: data.token,
      refreshToken: data.refreshToken,
      _id: walletToUsername(data.senderJID),
    },
    text: body.getText(),
    FN: data.senderFirstName,
    username: walletToUsername(data.senderJID),
    createdAt: new Date(+id.slice(0, 13)),
    tokenAmount: data?.tokenAmount,
    quickReplie: data?.quickReplie,
    notDisplayedValue: data?.notDisplayedValue,
    showInChannel: data?.showInChannel,
  };

  return message;
};

//core default
const onRealtimeMessage = async (stanza: Element) => {
  if (
    !stanza?.getChild('result') &&
    !stanza.getChild('composing') &&
    !stanza.getChild('paused') &&
    !stanza.getChild('subject') &&
    !stanza.is('iq')
  ) {
    const body = stanza?.getChild('body');
    const archived = stanza?.getChild('archived');
    const data = stanza?.getChild('data');
    const id = archived?.attrs.id;

    if (!data) {
      console.log(stanza.toString());
      console.log('Missing archived elements in real-time message.');
      return;
    }

    if (!data.attrs.senderJID) {
      console.log(stanza.toString());
      console.log(data.attrs.senderJID);

      console.log('Missing sender information in real-time message.');
      return;
    }

    const message = await createMessage(
      data.attrs,
      body,
      id,
      stanza.attrs.from,
    );

    runInAction(() => rootStore.chatStore.addMessages([message]));
    return message;
  }
};

const onMessageHistory = async (stanza: any) => {
  if (
    stanza.is('message') &&
    stanza.children[0].attrs.xmlns === 'urn:xmpp:mam:2'
  ) {
    const body = stanza
      .getChild('result')
      ?.getChild('forwarded')
      ?.getChild('message')
      ?.getChild('body');
    const data = stanza
      .getChild('result')
      ?.getChild('forwarded')
      ?.getChild('message')
      ?.getChild('data');
    const delay = stanza
      .getChild('result')
      ?.getChild('forwarded')
      ?.getChild('delay');

    const id = stanza.getChild('result')?.attrs.id;
    // if (!data || !body || !delay || !id) {
    //   console.log('Missing required elements in message history.');
    //   return;
    // }

    // if (
    //   !data.attrs.senderFirstName ||
    //   !data.attrs.senderLastName ||
    //   !data.attrs.senderJID
    // ) {
    //   console.log('Missing sender information in message history.');
    //   return;
    // }

    const message = await createMessage(
      data.attrs,
      body,
      id,
      stanza.attrs.from,
    );

    if (!message?._id) {
      console.log('message has no _id');
      message._id = uuid.v4().toString();
    }
    runInAction(() => rootStore.chatStore.addMessages([message]));
  }
};

const handleIqStanza = async (stanza: Element) => {
  if (stanza.is('iq'))
    if (stanza?.getChild('fin')?.getChild('set')?.getChild('count'))
      Number(
        stanza.getChild('fin')?.getChild('set')?.getChild('count')?.getText(),
      ) === 0 &&
        runInAction(() => (rootStore.chatStore.currentRoom.noMessages = true));
};

const handleComposing = async (stanza: Element, currentUser: string) => {
  if (
    currentUser !== stanza.attrs?.from?.split('/')?.[1] &&
    stanza.attrs?.type !== 'error'
  ) {
    if (stanza.getChild('paused') || stanza.getChild('composing')) {
      runInAction(() =>
        rootStore.chatStore.setComposing(!!stanza?.getChild('composing')),
      );
    }
  }
};

const getListOfRooms = (xmpp: any) => {
  xmpp.client.send(xml('presence'));
  xmpp.getArchive(xmpp.client?.jid?.toString());
  xmpp.getArchive('0x6C394B10F5Da4141b99DB2Ad424C5688c3f202B3');
  xmpp.getRooms();
};

const onGetLastMessageArchive = (stanza: Element, xmpp: any) => {
  if (stanza.attrs.id === 'sendMessage') {
    const data = stanza.getChild('stanza-id');
    if (data) {
      xmpp.getLastMessageArchive(data.attrs.by);
      return;
    }
    return onMessageHistory(stanza);
  }
};

export {
  getListOfRooms,
  onRealtimeMessage,
  onMessageHistory,
  onGetLastMessageArchive,
  handleComposing,
  handleIqStanza,
};
