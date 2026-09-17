/**
 * End-to-end locale wiring, at the component level.
 *
 * `i18nStringCoverage` proves the TABLES are complete; it says nothing
 * about whether a component actually reads them. The fr-CA/es-US bug QA
 * filed was exactly that gap: the strings existed (or could have), but
 * AttachSheet and the new-message divider rendered English literals that
 * never went near `useT()`.
 *
 * So this mounts the REAL components with a real store, sets a REGIONAL
 * locale (fr-CA / es-US — not the bare base tag), and asserts translated
 * text comes out. It fails the moment someone reintroduces a hardcoded
 * caption in one of these screens, and it also pins the region -> base
 * language resolution the captions depend on.
 */

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';

import chatSettingsReducer, { setConfig } from '../src/roomStore/chatSettingsSlice';
import roomsReducer from '../src/roomStore/roomsSlice';
import AttachSheet from '../src/components/Modals/AttachSheet/AttachSheet';
import NewMessageLabel from '../src/components/styled/NewMessageLabel';
import { IConfig } from '../src/types/types';

const makeStore = (locale: string) => {
  const store = configureStore({
    reducer: { chatSettingStore: chatSettingsReducer, rooms: roomsReducer },
  });
  store.dispatch(setConfig({ i18n: { locale } } as IConfig));
  return store;
};

const allText = (tree: renderer.ReactTestRenderer): string =>
  JSON.stringify(tree.toJSON());

const renderWith = async (locale: string, node: React.ReactElement) => {
  let tree: renderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = renderer.create(
      <Provider store={makeStore(locale)}>{node}</Provider>
    );
  });
  return tree!;
};

describe('regional locales render translated UI, not English', () => {
  const attachSheet = (
    <AttachSheet
      visible
      onClose={() => {}}
      onCamera={() => {}}
      onGallery={() => {}}
      onDocument={() => {}}
    />
  );

  it('fr-CA renders the Attach sheet in French', async () => {
    const tree = await renderWith('fr-CA', attachSheet);
    const text = allText(tree);

    expect(text).toContain('Photos et vidéos');
    expect(text).toContain('Voir la bibliothèque');
    expect(text).toContain('Téléverser un fichier');
    expect(text).toContain('Prendre une photo'); // camera tile a11y label

    // The English literals the sheet used to ship.
    expect(text).not.toContain('Photos & Videos');
    expect(text).not.toContain('View Library');
    expect(text).not.toContain('Upload a File');

    await act(async () => tree.unmount());
  });

  it('es-US renders the Attach sheet in Spanish', async () => {
    const tree = await renderWith('es-US', attachSheet);
    const text = allText(tree);

    expect(text).toContain('Fotos y videos');
    expect(text).toContain('Ver galería');
    expect(text).toContain('Subir un archivo');
    expect(text).toContain('Tomar foto');

    expect(text).not.toContain('Photos & Videos');
    expect(text).not.toContain('View Library');
    expect(text).not.toContain('Upload a File');

    await act(async () => tree.unmount());
  });

  it('translates the new-message divider for fr-CA and es-US', async () => {
    const fr = await renderWith('fr-CA', <NewMessageLabel />);
    expect(allText(fr)).toContain('Nouveaux messages');
    expect(allText(fr)).not.toContain('New messages');
    await act(async () => fr.unmount());

    const es = await renderWith('es-US', <NewMessageLabel />);
    expect(allText(es)).toContain('Nuevos mensajes');
    expect(allText(es)).not.toContain('New messages');
    await act(async () => es.unmount());
  });

  it('still renders English for an English locale', async () => {
    const tree = await renderWith('en-CA', attachSheet);
    const text = allText(tree);
    expect(text).toContain('Photos & Videos');
    expect(text).toContain('View Library');
    expect(text).toContain('Upload a File');
    await act(async () => tree.unmount());
  });
});
