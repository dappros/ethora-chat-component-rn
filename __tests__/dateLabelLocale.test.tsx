/**
 * The date divider between message groups.
 *
 * Found on a live fr-CA run, not by reading code: with the whole chat in
 * French - "3 utilisateurs", "Rechercher...", "Écrire un message" - the
 * divider above yesterday's messages still said "Yesterday". DateLabel
 * hardcoded 'Today'/'Yesterday' even though `date.today`/`date.yesterday`
 * had been sitting in the string table all along, and formatted every
 * other date with a literal 'en-US', so a French reader got "September 15"
 * instead of "15 septembre". (useT's own doc comment already warned about
 * exactly this - "DateLabel did exactly that" - it just had not been
 * fixed.)
 */

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';

import chatSettingsReducer, { setConfig } from '../src/roomStore/chatSettingsSlice';
import roomsReducer from '../src/roomStore/roomsSlice';
import DateLabel from '../src/components/styled/DateLabel';
import { IConfig } from '../src/types/types';

const makeStore = (locale: string) => {
  const store = configureStore({
    reducer: { chatSettingStore: chatSettingsReducer, rooms: roomsReducer },
  });
  store.dispatch(setConfig({ i18n: { locale } } as IConfig));
  return store;
};

const renderAt = async (locale: string, date: Date) => {
  let tree: renderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = renderer.create(
      <Provider store={makeStore(locale)}>
        <DateLabel date={date} />
      </Provider>
    );
  });
  return JSON.stringify(tree!.toJSON());
};

const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
};

describe('DateLabel follows the reader locale', () => {
  it('says Today/Yesterday in French for fr-CA', async () => {
    expect(await renderAt('fr-CA', new Date())).toContain("Aujourd'hui");
    const y = await renderAt('fr-CA', daysAgo(1));
    expect(y).toContain('Hier');
    expect(y).not.toContain('Yesterday');
  });

  it('says Today/Yesterday in Spanish for es-US', async () => {
    expect(await renderAt('es-US', new Date())).toContain('Hoy');
    const y = await renderAt('es-US', daysAgo(1));
    expect(y).toContain('Ayer');
    expect(y).not.toContain('Yesterday');
  });

  it('still says Today/Yesterday in English for en', async () => {
    expect(await renderAt('en', new Date())).toContain('Today');
    expect(await renderAt('en', daysAgo(1))).toContain('Yesterday');
  });

  it('formats older dates in the reader’s language, not en-US', async () => {
    // Far enough back that it takes the Intl branch, close enough to stay
    // inside the same year so the format stays month+day.
    const older = daysAgo(40);
    const fr = await renderAt('fr-CA', older);
    const en = await renderAt('en', older);

    const frExpected = older.toLocaleDateString('fr-CA', {
      month: 'long',
      day: 'numeric',
    });
    expect(fr).toContain(frExpected);
    // The regression: the French render was byte-identical to the English
    // one because the locale was hardcoded.
    expect(fr).not.toBe(en);
  });
});
