import { parse } from 'ltx';
import { getDataFromXml } from '../../src/helpers/getDataFromXml';
import { createMessageFromXml } from '../../src/helpers/createMessageFromXml';
import { IMessage } from '../../src/types/types';

/**
 * Media messages as they exist on the wire, one stanza per format (web
 * multi-attach, legacy comma lists, older SDKs). Hosts, ids and names are
 * sanitised copies; the shapes are the real ones.
 */
export const ROOM = 'app1_room1@conference.xmpp.example.com';
const FROM = `${ROOM}/app1_user1`;
export const FILES = 'https://files.example.com/files';

const esc = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export const stanza = (
  id: string,
  body: string | null,
  dataAttrs: Record<string, string>
) => {
  const attrs = Object.entries(dataAttrs)
    .map(([key, value]) => `${key}="${esc(value)}"`)
    .join(' ');
  return `<message xmlns="jabber:client" id="${id}" type="groupchat" from="${FROM}">${
    body === null ? '' : `<body>${esc(body)}</body>`
  }<stanza-id id="17919711801062851" by="${ROOM}" xmlns="urn:xmpp:sid:0"/><data ${attrs}/></message>`;
};

export const wireAttachment = (n: number, extra: Record<string, unknown> = {}) => ({
  attachmentId: `att-${n}`,
  location: `${FILES}/file-${n}.jpg`,
  locationPreview: `${FILES}/file-${n}-s.jpg`,
  mimetype: 'image/jpeg',
  originalName: `shot-${n}.jpg`,
  fileName: `stored-${n}`,
  size: String(1000 + n),
  duration: '',
  ...extra,
});

/** Web multi-attach: flat fields describe #0, `attachments` lists all. */
export const multiStanza = (
  count: number,
  extra: Record<string, string> = {},
  body = 'media'
) => {
  const list = Array.from({ length: count }, (_, i) => wireAttachment(i));
  const first = list[0]!;
  return stanza('send-media-message:m1', body, {
    senderJID: `${ROOM}/abc`,
    senderFirstName: 'Ann',
    senderLastName: 'Lee',
    isMediafile: 'true',
    location: first.location,
    locationPreview: first.locationPreview,
    mimetype: first.mimetype,
    originalName: first.originalName,
    fileName: first.fileName,
    size: first.size,
    ...(count > 1 ? { attachments: JSON.stringify(list) } : {}),
    ...extra,
  });
};

export const COMMA_LIST_STANZA = stanza('send-media-message:d1', 'two shots', {
  isMediafile: 'true',
  location: `${FILES}/a.jpg,${FILES}/b.png`,
  locationPreview: `${FILES}/a-s.jpg,${FILES}/b-s.png`,
  mimetype: 'image/jpeg,image/png',
  originalName: 'a.jpg,b.png',
});

export const PLAIN_MEDIA_STANZA = stanza('send-media-message:b1', 'media', {
  isMediafile: 'true',
  location: `${FILES}/574f4ba5.pdf`,
  locationPreview: '',
  mimetype: 'application/pdf',
  originalName: 'sample.pdf',
  fileName: '574f4ba5',
  size: '18810',
});

export const N1_STANZA = stanza('send-media-message:011e37c5', 'hello', {
  isMediafile: 'true',
  location: `${FILES}/16ee46ff.jpg`,
  locationPreview: `${FILES}/16ee46ff.jpg`,
  mimetype: 'image/jpeg',
  originalName: 'unsplash.jpg',
  size: '1833474',
});

export const toMessage = async (xml: string): Promise<IMessage> => {
  const data = await getDataFromXml(parse(xml) as never);
  return (await createMessageFromXml(data as never)) as IMessage;
};

/** The positional convention (MAM catch-up): raw <data> attrs, then body. */
export const toPositionalMessage = async (xml: string): Promise<IMessage> => {
  const el = parse(xml);
  const data = el.getChild('data')!;
  return (await createMessageFromXml(
    { ...data.attrs },
    el.getChild('body'),
    el.attrs.id,
    el.attrs.from,
    false
  )) as IMessage;
};
