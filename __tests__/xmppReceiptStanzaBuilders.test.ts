/**
 * XEP-0184 receipt and XEP-0333 displayed-marker builders: exact XML, the
 * room-directed groupchat shape, and the store hint that keeps them in MAM.
 */
import { sendReceivedReceipt } from '../src/networking/xmpp/sendReceivedReceipt.xmpp';
import { sendDisplayedMarker } from '../src/networking/xmpp/sendDisplayedMarker.xmpp';

const ROOM = 'room1@conference.xmpp.test';
const ME_JID = '0xabc@xmpp.test/web-1234';

function makeClient() {
  const send = jest.fn();
  const client: any = {
    send,
    jid: { toString: () => ME_JID },
  };
  return { client, send };
}

const sentXml = (send: jest.Mock) => String(send.mock.calls[0][0]);

describe('sendReceivedReceipt', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
  });
  afterEach(() => jest.restoreAllMocks());

  it('sends a groupchat receipt to the room carrying the message id and the real sender', () => {
    const { client, send } = makeClient();
    sendReceivedReceipt(client, 'arch-42', ROOM);
    expect(send).toHaveBeenCalledTimes(1);
    expect(sentXml(send)).toBe(
      '<message id="message-received:1700000000000" type="groupchat" ' +
        `from="${ME_JID}" to="${ROOM}">` +
        '<received xmlns="urn:xmpp:receipts" id="arch-42" from="' +
        `${ME_JID}"/>` +
        '<store xmlns="urn:xmpp:hints"/>' +
        '</message>'
    );
  });

  it('carries no <body> and no <data>, so it never reads as a chat message', () => {
    const { client, send } = makeClient();
    sendReceivedReceipt(client, 'arch-42', ROOM);
    const stanza = send.mock.calls[0][0];
    expect(stanza.getChild('body')).toBeUndefined();
    expect(stanza.getChild('data')).toBeUndefined();
  });
});

describe('sendDisplayedMarker', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(1700000000999);
  });
  afterEach(() => jest.restoreAllMocks());

  it('sends one groupchat XEP-0333 marker pointing at the newest displayed message', () => {
    const { client, send } = makeClient();
    sendDisplayedMarker(client, 'arch-99', ROOM);
    expect(send).toHaveBeenCalledTimes(1);
    expect(sentXml(send)).toBe(
      '<message id="message-displayed:1700000000999" type="groupchat" ' +
        `from="${ME_JID}" to="${ROOM}">` +
        '<displayed xmlns="urn:xmpp:chat-markers:0" id="arch-99" from="' +
        `${ME_JID}"/>` +
        '<store xmlns="urn:xmpp:hints"/>' +
        '</message>'
    );
  });

  it('carries no <body> and no <data>', () => {
    const { client, send } = makeClient();
    sendDisplayedMarker(client, 'arch-99', ROOM);
    const stanza = send.mock.calls[0][0];
    expect(stanza.getChild('body')).toBeUndefined();
    expect(stanza.getChild('data')).toBeUndefined();
  });
});
