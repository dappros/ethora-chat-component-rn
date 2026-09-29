/**
 * Manual mode is auto mode behind a tap.
 *
 * Both reveal the SAME translation the stanza already carries — manual just
 * gates it behind a press. So the "Translate" link must appear on exactly
 * the messages auto would have translated, and reveal exactly the text auto
 * would have shown.
 *
 * Two defects made manual look dead while auto worked on the same message
 * (both ported verbatim from the web SDK, which still has them):
 *   - manual's target language ended at the literal 'en' rather than the
 *     reader's own langSource, so a French reader's tap asked for an
 *     ENGLISH translation and got "Could not translate";
 *   - the link was offered on a language compare alone, without checking a
 *     translation was actually attached.
 */

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { Provider } from 'react-redux';
import { store } from '../src/roomStore';
import MessageTranslate from '../src/components/MessageBubble/MessageTranslate';
import { useMessageTranslation } from '../src/hooks/useMessageTranslation';
import { IConfig } from '../src/types/types';

const READER = 'fr-CA';
const config = { translates: { enabled: true } } as IConfig;

// English message, reader is French, server attached the French translation.
const translated: any = {
  id: '1',
  body: 'hi, this message is in english',
  langSource: 'en-CA',
  translations: {
    fr: {
      translatedText: 'salut, ce message est en anglais',
      language: 'fr',
      languageName: 'French',
    },
  },
  user: { id: 'someone', name: 'John' },
};

// Tagged and foreign, but the server attached nothing.
const untranslated: any = {
  id: '2',
  body: 'hi, this message is in english',
  langSource: 'en-CA',
  translations: undefined,
  user: { id: 'someone', name: 'John' },
};

const render = async (message: any, extra?: Partial<IConfig>) => {
  let tree: renderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = renderer.create(
      <Provider store={store}>
        <MessageTranslate
          message={message}
          isUser={false}
          config={{ ...config, ...extra } as IConfig}
          readerLocale={READER}
        />
      </Provider>
    );
  });
  return tree!;
};

const textsOf = (tree: renderer.ReactTestRenderer): string[] =>
  tree.root
    .findAllByType(Text)
    .flatMap((n) =>
      Array.isArray(n.props.children) ? n.props.children : [n.props.children]
    )
    .filter((c): c is string => typeof c === 'string');

const tapLink = async (tree: renderer.ReactTestRenderer, label: string) => {
  const node = tree.root
    .findAll((n) => typeof n.props?.onPress === 'function')
    .find((n) =>
      n
        .findAllByType(Text)
        .some((txt) =>
          (Array.isArray(txt.props.children)
            ? txt.props.children
            : [txt.props.children]
          ).includes(label)
        )
    );
  if (!node) {
    throw new Error(`no tappable link labelled "${label}"`);
  }
  await act(async () => {
    node.props.onPress();
  });
};

describe('manual translate mirrors auto', () => {
  it('reveals the same text auto would have rendered', async () => {
    const auto = useMessageTranslation(translated, READER, true);
    expect(auto.hasTranslation).toBe(true);

    const tree = await render(translated);
    expect(textsOf(tree)).toContain('Translate');

    await tapLink(tree, 'Translate');

    const shown = textsOf(tree);
    expect(shown).toContain(auto.displayText);
    expect(shown).toContain('salut, ce message est en anglais');
    // The failure state is unreachable on the stanza-attached path.
    expect(shown).not.toContain('Could not translate');

    await act(async () => {
      tree.unmount();
    });
  });

  it('uses the reader’s language, not a hardcoded English fallback', async () => {
    // The regression: with targetLocale pinned to 'en' this message has no
    // 'en' entry, so the tap could only ever fail.
    expect(translated.translations.en).toBeUndefined();
    expect(translated.translations.fr.translatedText).toBeTruthy();

    const tree = await render(translated);
    await tapLink(tree, 'Translate');
    expect(textsOf(tree)).toContain('salut, ce message est en anglais');

    await act(async () => {
      tree.unmount();
    });
  });

  it('offers no link when there is nothing to reveal', async () => {
    expect(useMessageTranslation(untranslated, READER, true).hasTranslation).toBe(
      false
    );
    const tree = await render(untranslated);
    expect(tree.toJSON()).toBeNull();

    await act(async () => {
      tree.unmount();
    });
  });

  it('toggles back to the original by collapsing, not by printing it twice', async () => {
    // The bubble body ABOVE this component is already the original text in
    // manual mode (Message.tsx only translates inline in AUTO mode, see
    // showInlineTranslation). The regression: "Show original" swapped the
    // original into the revealed block as well, so the same sentence showed
    // twice - once in the body, once under the divider. Collapsing the block
    // is what the label actually promises.
    const tree = await render(translated);
    await tapLink(tree, 'Translate');
    expect(textsOf(tree)).toContain('salut, ce message est en anglais');
    expect(textsOf(tree)).toContain('Show original');

    await tapLink(tree, 'Show original');

    const after = textsOf(tree);
    // No second copy of the original - the bubble body owns the only one.
    expect(after).not.toContain('hi, this message is in english');
    // The translation is hidden and the link offers to bring it back.
    expect(after).not.toContain('salut, ce message est en anglais');
    expect(after).toContain('Translate');
    expect(after).not.toContain('Show original');

    // And it re-reveals on a second tap.
    await tapLink(tree, 'Translate');
    expect(textsOf(tree)).toContain('salut, ce message est en anglais');

    await act(async () => {
      tree.unmount();
    });
  });

  it('collapses a host translation without re-running the host translator', async () => {
    const onTranslate = jest.fn(async () => 'traduit par hote');
    const tree = await render(untranslated, {
      translates: { enabled: true, onTranslate },
    } as Partial<IConfig>);

    await tapLink(tree, 'Translate');
    expect(onTranslate).toHaveBeenCalledTimes(1);
    expect(textsOf(tree)).toContain('traduit par hote');

    await tapLink(tree, 'Show original');
    const after = textsOf(tree);
    expect(after).not.toContain('traduit par hote');
    expect(after).not.toContain('hi, this message is in english');
    expect(after).toContain('Translate');

    // Re-revealing serves the cached text, it does not pay for the host's
    // translator a second time.
    await tapLink(tree, 'Translate');
    expect(onTranslate).toHaveBeenCalledTimes(1);
    expect(textsOf(tree)).toContain('traduit par hote');

    await act(async () => {
      tree.unmount();
    });
  });

  it('never renders on the reader’s own message', async () => {
    let tree: renderer.ReactTestRenderer | undefined;
    await act(async () => {
      tree = renderer.create(
        <Provider store={store}>
          <MessageTranslate
            message={translated}
            isUser
            config={config}
            readerLocale={READER}
          />
        </Provider>
      );
    });
    expect(tree!.toJSON()).toBeNull();
    await act(async () => {
      tree!.unmount();
    });
  });

  it('still offers the link for a host translator, which can succeed where the stanza is empty', async () => {
    const onTranslate = jest.fn(async () => 'traduit par hôte');
    const tree = await render(untranslated, {
      translates: { enabled: true, onTranslate },
    } as Partial<IConfig>);

    expect(textsOf(tree)).toContain('Translate');
    await tapLink(tree, 'Translate');
    expect(onTranslate).toHaveBeenCalledTimes(1);
    expect(textsOf(tree)).toContain('traduit par hôte');

    await act(async () => {
      tree.unmount();
    });
  });
});
