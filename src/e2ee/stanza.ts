import { Element, parse } from 'ltx';
import { store } from '../roomStore';
import { translateKey } from '../i18n/strings';
import { NS_OMEMO } from './ns';
import { omemoReady, senderJidFromMuc } from './index';

export type DecryptOutcome =
  | 'not-encrypted'
  | 'decrypted'
  | 'undecryptable'
  | 'drop';

export type E2eeError =
  | 'unsupported'
  | 'other-device'
  | 'failed';

const READY_TIMEOUT_MS = 8000;

export function encryptedCarrier(
  stanza: Element,
  depth = 0
): Element | undefined {
  if (depth > 4 || !stanza?.getChild) {return undefined;}
  if (stanza.name === 'message' && stanza.getChild('encrypted', NS_OMEMO)) {
    return stanza;
  }
  for (const child of stanza.children ?? []) {
    if (typeof child === 'string') {continue;}
    const found = encryptedCarrier(child as Element, depth + 1);
    if (found) {return found;}
  }
  return undefined;
}

const PLACEHOLDER_KEY: Record<E2eeError, string> = {
  unsupported: 'e2ee.unsupportedMessage',
  'other-device': 'e2ee.otherDevice',
  failed: 'e2ee.undecryptable',
};

export function placeholderKey(error?: string): string {
  return PLACEHOLDER_KEY[error as E2eeError] ?? PLACEHOLDER_KEY.failed;
}

function placeholder(error: E2eeError): Element {
  const settings = store.getState()?.chatSettingStore;
  return new Element('body', {}).t(
    translateKey(
      placeholderKey(error),
      settings?.config?.i18n?.locale || settings?.langSource,
      settings?.config?.i18n?.strings
    )
  );
}

function mark(carrier: Element, error?: E2eeError): void {
  let data = carrier.getChild('data');
  if (!data) {
    data = new Element('data', {});
    carrier.append(data);
  }
  data.attrs.omemoEncrypted = 'true';
  if (error) {
    data.attrs.undecryptable = 'true';
    data.attrs.e2eeError = error;
  }
}

function strip(carrier: Element): void {
  carrier.remove('encrypted', NS_OMEMO);
  carrier.remove('encryption', 'urn:xmpp:eme:0');
  carrier.remove('body');
}

function close(carrier: Element, error: E2eeError): DecryptOutcome {
  strip(carrier);
  carrier.append(placeholder(error));
  mark(carrier, error);
  return 'undecryptable';
}

export function rewriteEncryptedStanza(stanza: Element): DecryptOutcome {
  const carrier = encryptedCarrier(stanza);
  if (!carrier) {return 'not-encrypted';}
  const encrypted = carrier.getChild('encrypted', NS_OMEMO);
  if (!encrypted?.getChild('payload')) {return 'drop';}
  return close(carrier, 'unsupported');
}

const waitForDevice = () => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), READY_TIMEOUT_MS);
  });
  return Promise.race([omemoReady(), timeout]).finally(() => {
    if (timer) {clearTimeout(timer);}
  });
};

export async function decryptStanzaInPlace(
  stanza: Element,
  domain: string
): Promise<DecryptOutcome> {
  const carrier = encryptedCarrier(stanza);
  if (!carrier) {return 'not-encrypted';}

  const encrypted = carrier.getChild('encrypted', NS_OMEMO);
  if (!encrypted?.getChild('payload')) {return 'drop';}

  const from = String(carrier.attrs?.from || '');
  const roomJid = from.split('/')[0]!;
  const sender = senderJidFromMuc(from, domain);
  const crypto = await waitForDevice();
  const decrypted = sender
    ? await crypto?.decrypt(carrier, sender, roomJid)
    : undefined;

  if (!decrypted?.content) {
    return close(
      carrier,
      decrypted?.error === 'omemo_not_encrypted_for_this_device'
        ? 'other-device'
        : 'failed'
    );
  }

  strip(carrier);
  const wrapper = parse(`<omemo-content>${decrypted.content}</omemo-content>`);
  carrier.append(...wrapper.children);
  mark(carrier);
  return 'decrypted';
}
