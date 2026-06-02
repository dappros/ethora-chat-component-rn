/**
 * Regression tests pinning the customer-feedback round (May 2026 → 26.5.5).
 *
 * Each block corresponds to a numbered item in the feedback. Code-level
 * behaviour is asserted directly; visual UI / keyboard handling that
 * jest can't observe is called out with a `// MANUAL: ...` comment so
 * a reader can see what's NOT covered here.
 */

describe('customer feedback round — locked behaviour', () => {
  // ── Item 1: api.config import ─────────────────────────────────────────
  describe('apiClient does not import ../../api.config', () => {
    it('source has no reference to api.config', () => {
      const fs = require('fs');
      const src = fs.readFileSync(
        require.resolve('../src/networking/apiClient'),
        'utf-8'
      );
      expect(src).not.toMatch(/api\.config/);
    });
  });

  // ── Item 3: addRoomViaApi thunk ───────────────────────────────────────
  describe('addRoomViaApi exists and is a thunk', () => {
    it('exports a callable thunk action creator', () => {
      const mod = require('../src/roomStore/roomsSlice');
      expect(typeof mod.addRoomViaApi).toBe('function');
      // RTK thunks expose `.type` (the action prefix) on the creator.
      expect(typeof mod.addRoomViaApi.typePrefix).toBe('string');
      expect(mod.addRoomViaApi.typePrefix).toContain('addRoomViaApi');
    });

    it('addRoomFromApi reducer merges into existing room', () => {
      const slice = require('../src/roomStore/roomsSlice');
      const reducer = slice.default;
      const initial = reducer(undefined, { type: '@@INIT' });
      const jid = 'room@conference.example.com';
      // Pre-seed a room with some existing data
      const seeded = reducer(initial, {
        type: 'roomMessages/addRoom',
        payload: { roomData: { jid, title: 'Old', usersCnt: 5, messages: [], isLoading: false, roomBg: null, name: 'Old' } },
      });
      // Now apply addRoomFromApi with fewer fields
      const merged = reducer(seeded, {
        type: 'roomMessages/addRoomFromApi',
        payload: { room: { jid, title: 'New', messages: [] } },
      });
      expect(merged.rooms[jid].jid).toBe(jid);
      // existing messages array preserved (not replaced)
      expect(Array.isArray(merged.rooms[jid].messages)).toBe(true);
    });
  });

  // ── Item 2: Unhandled promise rejections ──────────────────────────────
  describe('Unhandled promise rejections — .catch handlers in place', () => {
    it('ChatWrapper attaches .catch to every getRoomsStanza() chain', () => {
      const fs = require('fs');
      const src = fs.readFileSync(
        require.resolve('../src/components/MainComponents/ChatWrapper'),
        'utf-8'
      );
      // Each getRoomsStanza().then(…) must be followed by a .catch.
      // Count getRoomsStanza occurrences and count .catch following them.
      const thenCount = (src.match(/getRoomsStanza\(\)\s*\.then/g) || []).length;
      const catchCount = (
        src.match(/getRoomsStanza\(\)\s*\.then[\s\S]{0,500}?\.catch/g) || []
      ).length;
      expect(thenCount).toBeGreaterThan(0);
      expect(catchCount).toBe(thenCount);
    });

    it('ThreadWrapper attaches .catch to getHistoryStanza() chain', () => {
      const fs = require('fs');
      const src = fs.readFileSync(
        require.resolve('../src/components/Thread/ThreadWrapper'),
        'utf-8'
      );
      expect(src).toMatch(/getHistoryStanza[\s\S]{0,300}?\.catch/);
    });
  });

  // ── Item 4: onGetMembers preserves existing members ───────────────────
  describe('onGetMembers does not wipe REST-loaded members on empty stanza', () => {
    beforeEach(() => {
      jest.resetModules();
    });

    it('early-returns when activities list is empty', () => {
      // Mock the store so we can observe whether updateRoom was dispatched.
      const dispatched: any[] = [];
      jest.doMock('../src/roomStore', () => ({
        store: {
          getState: () => ({
            rooms: {
              activeRoomJID: 'room@conf',
              rooms: {
                'room@conf': {
                  roomMembers: [
                    {
                      firstName: 'Existing',
                      lastName: 'User',
                      xmppUsername: 'eu',
                      _id: 'eu-id',
                      jid: 'eu',
                    },
                  ],
                },
              },
            },
          }),
          dispatch: (a: any) => dispatched.push(a),
        },
      }));

      // Stanza with the right id but NO <activity> children → activities=[].
      const stanza: any = {
        attrs: { id: 'roomMemberInfo' },
        getChildren: (name: string) => (name === 'query' ? [{ attrs: {}, getChildren: () => [] }] : []),
      };

      const { onGetMembers } = require('../src/networking/stanzaHandlers');
      onGetMembers(stanza);

      // No updateRoom action dispatched → existing members preserved.
      expect(dispatched).toEqual([]);
    });

    it('merges new activities with existing members by jid', () => {
      const dispatched: any[] = [];
      jest.doMock('../src/roomStore', () => ({
        store: {
          getState: () => ({
            rooms: {
              activeRoomJID: 'room@conf',
              rooms: {
                'room@conf': {
                  roomMembers: [
                    {
                      firstName: 'Existing',
                      lastName: 'User',
                      xmppUsername: 'eu',
                      _id: 'eu-id',
                      jid: 'eu',
                    },
                  ],
                },
              },
            },
          }),
          dispatch: (a: any) => dispatched.push(a),
        },
      }));

      const stanza: any = {
        attrs: { id: 'roomMemberInfo' },
        getChildren: (name: string) =>
          name === 'query'
            ? [
                {
                  attrs: { room: 'room@conf' },
                  getChildren: (n: string) =>
                    n === 'activity'
                      ? [{ attrs: { jid: 'eu', name: 'Existing User', role: 'moderator', last_active: '1' } }]
                      : [],
                },
              ]
            : [],
      };

      const { onGetMembers } = require('../src/networking/stanzaHandlers');
      onGetMembers(stanza);

      // One updateRoom dispatched with roomMembers that preserve firstName/lastName.
      expect(dispatched).toHaveLength(1);
      const action = dispatched[0];
      expect(action.type).toMatch(/updateRoom/);
      const members = action.payload.updates.roomMembers;
      expect(members).toHaveLength(1);
      expect(members[0].firstName).toBe('Existing'); // preserved from existing
      expect(members[0].lastName).toBe('User');
      expect(members[0].role).toBe('moderator'); // added from stanza
    });
  });

  // ── Item 5: MediaModal stray semicolon ────────────────────────────────
  describe('MediaModal has no stray text child inside Modal', () => {
    it('JSX between Modal tags has only <View> as child (no orphan semicolon)', () => {
      const fs = require('fs');
      const src = fs.readFileSync(
        require.resolve('../src/components/styled/MediaModal'),
        'utf-8'
      );
      // The bug: `</View>;` followed by `</Modal>`. Assert the closing
      // </View> is NOT followed by a semicolon before whitespace.
      expect(src).not.toMatch(/<\/View>;\s*<\/Modal>/);
    });
  });

  // ── Item 7: MediaMessage routing for application/octet-stream ─────────
  describe('MediaMessage octet-stream routing', () => {
    beforeEach(() => {
      jest.resetModules();
    });

    it('routes octet-stream with audio extension to AudioMessage', () => {
      // The audio-extension sniff lives in the shared `isLikelyAudio`
      // helper now (mimeToExtension.ts) so MediaMessage + FilePreviewModal
      // share one source of truth. Verify the helper actually says "yes"
      // for octet-stream + audio extension, and "no" for octet-stream +
      // non-audio. Functional assertion, not a regex pin.
      const { isLikelyAudio } = require('../src/helpers/mimeToExtension');
      const audioExts = ['mp3', 'm4a', 'wav', 'aac', 'ogg', 'flac'];
      for (const ext of audioExts) {
        expect(
          isLikelyAudio('application/octet-stream', `voice.${ext}`, null)
        ).toBe(true);
      }
      expect(
        isLikelyAudio('application/octet-stream', 'random.bin', null)
      ).toBe(false);

      const fs = require('fs');
      const src = fs.readFileSync(
        require.resolve('../src/components/MainComponents/MediaMessage'),
        'utf-8'
      );
      expect(src).toMatch(
        /case\s+mimeType\.includes\('application\/octet-stream'\)/
      );
      expect(src).toMatch(/<AudioMessage\s+src=\{location \|\| ''\}/);
      expect(src).toContain('mimeType={mimeType}');
      expect(src).toContain('originalName={(message as any)?.originalName}');
    });

    it('isLikelyAudio recognises voice-message naming hints (octet-stream voicemails)', () => {
      // Customer-reported #9: web app ships voicemails as
      // application/octet-stream with no audio extension. The helper
      // must still recognise them via voice/voicemail/recording naming
      // hints in the filename OR the URL path.
      const { isLikelyAudio } = require('../src/helpers/mimeToExtension');
      expect(
        isLikelyAudio('application/octet-stream', 'voicemail-12345.bin', null)
      ).toBe(true);
      expect(
        isLikelyAudio('application/octet-stream', 'voice-note.bin', null)
      ).toBe(true);
      expect(
        isLikelyAudio('application/octet-stream', 'recording_2026.bin', null)
      ).toBe(true);
      expect(
        isLikelyAudio(
          'application/octet-stream',
          null,
          'https://cdn.example.com/voicemail/abc-123'
        )
      ).toBe(true);
      // A non-audio file with a similar-looking word doesn't match —
      // the hint requires a word-boundary on at least one side.
      expect(
        isLikelyAudio('application/octet-stream', 'invoice.pdf', null)
      ).toBe(false);
    });

    it('keeps a generic helper fallback for non-octet-stream files', () => {
      const fs = require('fs');
      const src = fs.readFileSync(
        require.resolve('../src/components/MainComponents/MediaMessage'),
        'utf-8'
      );
      // Default branch renders FileDownload.
      expect(src).toMatch(/return\s+\(\s*<FileDownload/);
    });
  });

  // ── Item 8: TypeScript ships .d.ts not raw .ts ────────────────────────
  describe('package.json types points at compiled .d.ts', () => {
    it('types field is lib/typescript/*.d.ts, not src/*.ts', () => {
      const pkg = require('../package.json');
      expect(pkg.types).toMatch(/\.d\.ts$/);
      expect(pkg.types).toContain('lib/');
    });

    it('exports map resolves consumers to compiled lib/, not source', () => {
      const pkg = require('../package.json');
      // NOTE: `main` stays "index.js" on purpose — the repo root doubles
      // as the Expo testbed, and @expo/config resolves the dev entry from
      // `main` (it does NOT honour expo.entryPoint in this SDK). `index.js`
      // isn't in `files`, so it's never published; modern consumers (Node
      // >=12.16 / Metro w/ exports) resolve through the `exports` map, which
      // is the real shipping contract and MUST point at compiled output.
      const entry = pkg.exports?.['.'];
      expect(entry).toBeDefined();
      expect(entry.require).toContain('lib/commonjs'); // CJS consumers
      expect(entry.import).toContain('lib/module'); // ESM consumers
      expect(entry.types).toMatch(/\.d\.ts$/);
      expect(entry.types).toContain('lib/');
    });

    it('exports map contains no ./src/ paths anywhere', () => {
      const pkg = require('../package.json');
      const seen: string[] = [];

      const walk = (value: unknown) => {
        if (typeof value === 'string') {
          seen.push(value);
          return;
        }
        if (Array.isArray(value)) {
          value.forEach(walk);
          return;
        }
        if (value && typeof value === 'object') {
          Object.values(value).forEach(walk);
        }
      };

      walk(pkg.exports);

      expect(seen.length).toBeGreaterThan(0);
      expect(seen).not.toEqual(
        expect.arrayContaining([expect.stringMatching(/(^|\/)\.\/src\//)])
      );
      expect(seen).not.toEqual(
        expect.arrayContaining([expect.stringMatching(/(^|\/)src\//)])
      );
    });

    it('react-native-builder-bob config present', () => {
      const pkg = require('../package.json');
      expect(pkg['react-native-builder-bob']).toBeDefined();
      expect(pkg['react-native-builder-bob'].targets).toBeDefined();
    });
  });

  // ── Item 9d: SendInput accepts video media types ──────────────────────
  describe('SendInput media pickers accept videos', () => {
    it('camera + gallery pickers use array mediaTypes including videos', () => {
      const fs = require('fs');
      const src = fs.readFileSync(
        require.resolve('../src/components/styled/SendInput'),
        'utf-8'
      );
      // Both pickers should use ['images', 'videos'] — not the deprecated
      // MediaTypeOptions.Images enum that limited camera to photo-only.
      const matches = src.match(/mediaTypes:\s*\['images',\s*'videos'\]/g);
      expect(matches).not.toBeNull();
      expect(matches!.length).toBeGreaterThanOrEqual(2); // camera + gallery
    });

    it('SendInput no longer references deprecated MediaTypeOptions enum', () => {
      const fs = require('fs');
      const src = fs.readFileSync(
        require.resolve('../src/components/styled/SendInput'),
        'utf-8'
      );
      expect(src).not.toMatch(/MediaTypeOptions/);
    });
  });

  // ── Items 9a / 9b: AudioMessage uses expo-av, VideoMessage uses expo-video ──
  describe('Audio uses expo-av / Video uses expo-video', () => {
    it('AudioMessage uses Audio.Sound from expo-av', () => {
      const fs = require('fs');
      const src = fs.readFileSync(
        require.resolve('../src/components/styled/AudioMessage'),
        'utf-8'
      );
      expect(src).toMatch(/from 'expo-av'/);
      expect(src).toMatch(/Audio\.Sound/);
      // Old broken stub had `amplitudes` state and commented-out fetch.
      expect(src).not.toMatch(/const \[amplitudes/);
    });

    it('VideoMessage shows a tappable poster that opens the preview (no onBuffer loop)', () => {
      const fs = require('fs');
      const src = fs.readFileSync(
        require.resolve('../src/components/styled/VideoMessage'),
        'utf-8'
      );
      // Inline bubble now renders the first frame as a poster behind a
      // play affordance; tapping anywhere opens the full-screen player.
      // Inline native controls are off (they swallowed the tap and looked
      // cramped). Migrated expo-av → expo-video (useVideoPlayer/VideoView).
      expect(src).toMatch(/from 'expo-video'/);
      expect(src).toMatch(/useVideoPlayer|VideoView/);
      expect(src).toMatch(/onPress=\{handleOpen\}/);
      // The original bug: onBuffer={handleOpen} re-opened the modal in a
      // loop. Guard that it never comes back on any handler.
      expect(src).not.toMatch(/onBuffer=\{handleOpen\}/);
    });
  });

  // ── No more emoji-mart import (26.5.5 cleanup) ────────────────────────
  describe('emoji-mart is fully removed from SDK source', () => {
    it('no source file imports emoji-mart', () => {
      const { execSync } = require('child_process');
      const output = execSync(
        `grep -rn "emoji-mart" ${require('path').resolve(__dirname, '../src')} --include="*.ts" --include="*.tsx" || true`
      ).toString();
      expect(output.trim()).toBe('');
    });
  });

  // ── 26.5.3: expo packages moved to peerDependencies ───────────────────
  describe('expo media packages are peer deps, not runtime deps', () => {
    it('expo-av / expo-image-picker etc. live under peerDependencies only', () => {
      const pkg = require('../package.json');
      const expoPeers = [
        'expo-av',
        'expo-clipboard',
        'expo-document-picker',
        'expo-image-manipulator',
        'expo-image-picker',
        'expo-media-library',
      ];
      for (const name of expoPeers) {
        expect(pkg.peerDependencies[name]).toBeDefined();
        expect(pkg.dependencies?.[name]).toBeUndefined();
        expect(pkg.peerDependenciesMeta?.[name]?.optional).toBe(true);
      }
    });
  });

  // ── 26.5.4: error overlay no longer has the web-port wording ──────────
  describe('ChatWrapper error overlay no longer says "refresh the page"', () => {
    it('source does not contain the legacy web-port wording', () => {
      const fs = require('fs');
      const src = fs.readFileSync(
        require.resolve('../src/components/MainComponents/ChatWrapper'),
        'utf-8'
      );
      expect(src).not.toMatch(/refresh the page/i);
      expect(src).toMatch(/Retry/);
    });
  });

  // ── MANUAL coverage gaps (jest can't observe these) ───────────────────
  // - Item 6 (iOS keyboard lift on focus): requires real iOS sim + interaction
  // - Item 7 (Android keyboard flicker): requires real Android device, frame
  //   capture during keyboard open animation
  // Both have static-code assertions: ReduxWrapper mounts <KeyboardProvider>
  // and ChatRoom uses platform-aware behavior. The runtime check is e2e.
  describe('keyboard handling — code-level assertions only', () => {
    it('ReduxWrapper mounts <KeyboardProvider>', () => {
      const fs = require('fs');
      const src = fs.readFileSync(
        require.resolve('../src/components/MainComponents/ReduxWrapper'),
        'utf-8'
      );
      expect(src).toMatch(/<KeyboardProvider>/);
      expect(src).toMatch(/from 'react-native-keyboard-controller'/);
    });

    it('ChatRoom uses platform-aware KAV behavior', () => {
      const fs = require('fs');
      const src = fs.readFileSync(
        require.resolve('../src/components/MainComponents/ChatRoom'),
        'utf-8'
      );
      // 26.5.8 (bug #6 retest): both platforms use `padding`. `height`
      // on Android double-resizes with adjustResize (flicker) and
      // `undefined` got the input blocked on hosts that disable
      // adjustResize via softInputMode. `padding` doesn't change the
      // layout height — adds bottom-padding equal to keyboard height
      // — so it works regardless of host softInputMode.
      expect(src).toMatch(/behavior="padding"/);
    });
  });
});
