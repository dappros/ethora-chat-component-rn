import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import { EMOJI_CATEGORIES, type EmojiEntry } from '../../assets/emojiData';
import { searchEmojis } from '../../helpers/emoji';
import { useTheme } from '../../hooks/useTheme';
import { useT } from '../../i18n/useT';

interface EmojiPickerSheetProps {
  visible: boolean;
  onClose: () => void;
  onPick: (id: string) => void;
}

const COLUMNS = 7;
const ROW_HEIGHT = 46;
const HEADER_HEIGHT = 34;
const RECENTS_KEY = '@ethora/recent-reactions';
const RECENTS_MAX = 14;
const RECENTS_ID = 'recent';

type Row =
  | { kind: 'header'; key: string; categoryId: string; title: string }
  | { kind: 'row'; key: string; emojis: EmojiEntry[] };

const CATEGORY_ICONS: Record<string, string> = {
  [RECENTS_ID]: '🕒',
  people: '😀',
  nature: '🐻',
  foods: '🍔',
  activity: '⚽',
  places: '🚗',
  objects: '💡',
  symbols: '#️⃣',
  flags: '🏁',
};

const chunk = (list: EmojiEntry[], size: number): EmojiEntry[][] => {
  const out: EmojiEntry[][] = [];
  for (let i = 0; i < list.length; i += size) {out.push(list.slice(i, i + size));}
  return out;
};

const byId = (() => {
  let map: Map<string, EmojiEntry> | null = null;
  return () => {
    if (!map) {
      map = new Map();
      for (const c of EMOJI_CATEGORIES) {for (const e of c.emojis) {map.set(e[0], e);}}
    }
    return map;
  };
})();

export const loadRecentReactions = async (): Promise<string[]> => {
  try {
    const raw = await AsyncStorage.getItem(RECENTS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
};

export const rememberRecentReaction = async (id: string): Promise<void> => {
  try {
    const current = await loadRecentReactions();
    const next = [id, ...current.filter((x) => x !== id)].slice(0, RECENTS_MAX);
    await AsyncStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
  }
};

export const EmojiPickerSheet: React.FC<EmojiPickerSheetProps> = ({
  visible,
  onClose,
  onPick,
}) => {
  const theme = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const sheetHeight = Math.round(windowHeight * 0.62);
  const [query, setQuery] = useState('');
  const [recents, setRecents] = useState<string[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>('people');
  const listRef = useRef<FlatList<Row>>(null);
  const slide = useRef(new Animated.Value(0)).current;
  // Finger offset while the header is dragged down (0 = resting).
  const drag = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) {return;}
    setQuery('');
    loadRecentReactions().then(setRecents);
    slide.setValue(0);
    drag.setValue(0);
    Animated.timing(slide, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible, slide, drag]);

  const close = useCallback(() => {
    Animated.timing(slide, {
      toValue: 0,
      duration: 200,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => onClose());
  }, [onClose, slide]);

  const swipeDown = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .activeOffsetY(8)
        .failOffsetX([-24, 24])
        .onUpdate((e) => drag.setValue(Math.max(0, e.translationY)))
        .onEnd((e) => {
          if (e.translationY > 90 || e.velocityY > 800) {
            close();
          } else {
            Animated.spring(drag, {
              toValue: 0,
              useNativeDriver: true,
              bounciness: 4,
            }).start();
          }
        }),
    [close, drag]
  );

  const pick = useCallback(
    (id: string) => {
      rememberRecentReaction(id);
      onPick(id);
      close();
    },
    [onPick, close]
  );

  const { rows, sectionIndex } = useMemo(() => {
    const out: Row[] = [];
    const starts: Record<string, number> = {};
    const recentEntries = recents
      .map((id) => byId().get(id))
      .filter((e): e is EmojiEntry => !!e);
    const sections = [
      ...(recentEntries.length
        ? [{ id: RECENTS_ID, name: 'Frequently used', emojis: recentEntries }]
        : []),
      ...EMOJI_CATEGORIES,
    ];
    for (const section of sections) {
      starts[section.id] = out.length;
      out.push({
        kind: 'header',
        key: `h-${section.id}`,
        categoryId: section.id,
        title: section.name,
      });
      chunk(section.emojis, COLUMNS).forEach((emojis, i) =>
        out.push({ kind: 'row', key: `${section.id}-${i}`, emojis })
      );
    }
    return { rows: out, sectionIndex: starts };
  }, [recents]);

  const searchRows = useMemo<Row[]>(() => {
    if (!query.trim()) {return [];}
    return chunk(searchEmojis(query, 140), COLUMNS).map((emojis, i) => ({
      kind: 'row',
      key: `s-${i}`,
      emojis,
    }));
  }, [query]);

  const data = query.trim() ? searchRows : rows;

  const getItemLayout = useCallback(
    (items: ArrayLike<Row> | null | undefined, index: number) => {
      let offset = 0;
      for (let i = 0; i < index; i++) {
        offset += items?.[i]?.kind === 'header' ? HEADER_HEIGHT : ROW_HEIGHT;
      }
      return {
        length: items?.[index]?.kind === 'header' ? HEADER_HEIGHT : ROW_HEIGHT,
        offset,
        index,
      };
    },
    []
  );

  const jumpTo = useCallback(
    (categoryId: string) => {
      const index = sectionIndex[categoryId];
      if (index === undefined) {return;}
      setActiveCategory(categoryId);
      listRef.current?.scrollToIndex({ index, animated: true });
    },
    [sectionIndex]
  );

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: { item: Row }[] }) => {
      const first = viewableItems[0]?.item;
      if (!first) {return;}
      const key = first.kind === 'header' ? first.categoryId : first.key.split('-')[0];
      if (key && key !== 's') {setActiveCategory(key);}
    }
  ).current;

  const renderItem = useCallback(
    ({ item }: { item: Row }) => {
      if (item.kind === 'header') {
        return (
          <Text style={[styles.header, { color: theme.textMuted }]}>
            {item.title.toUpperCase()}
          </Text>
        );
      }
      return (
        <View style={styles.row}>
          {item.emojis.map(([id, native]) => (
            <Pressable
              key={id}
              testID={`emoji-${id}`}
              onPress={() => pick(id)}
              style={({ pressed }) => [
                styles.cell,
                pressed && { backgroundColor: theme.surfaceHighlight },
              ]}
            >
              <Text style={styles.cellGlyph}>{native}</Text>
            </Pressable>
          ))}
        </View>
      );
    },
    [pick, theme]
  );

  const categoryBar = useMemo(
    () => [
      ...(sectionIndex[RECENTS_ID] !== undefined ? [RECENTS_ID] : []),
      ...EMOJI_CATEGORIES.map((c) => c.id),
    ],
    [sectionIndex]
  );

  if (!visible) {return null;}

  return (
    <Modal visible transparent animationType="none" onRequestClose={close}>
      <GestureHandlerRootView style={styles.backdrop}>
      <Pressable style={styles.backdrop} onPress={close}>
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, styles.dim, { opacity: slide }]}
        />
      </Pressable>
      <Animated.View
        style={[
          styles.sheet,
          {
            height: sheetHeight,
            paddingBottom: insets.bottom,
            backgroundColor: theme.surface,
            transform: [
              {
                translateY: Animated.add(
                  slide.interpolate({
                    inputRange: [0, 1],
                    outputRange: [sheetHeight, 0],
                  }),
                  drag
                ),
              },
            ],
          },
        ]}
      >
        <GestureDetector gesture={swipeDown}>
        <View collapsable={false} style={styles.dragArea}>
        <View style={styles.grabberHit}>
          <View style={[styles.grabber, { backgroundColor: theme.border }]} />
        </View>
        <View
          style={[styles.search, { backgroundColor: theme.surfaceSecondary }]}
        >
          <Text style={[styles.searchIcon, { color: theme.textMuted }]}>⌕</Text>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t('search.placeholder')}
            placeholderTextColor={theme.textMuted}
            style={[styles.searchInput, { color: theme.text }]}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
          />
        </View>
        </View>
        </GestureDetector>
        <FlatList
          ref={listRef}
          data={data}
          renderItem={renderItem}
          keyExtractor={(item) => item.key}
          getItemLayout={getItemLayout}
          initialNumToRender={14}
          maxToRenderPerBatch={12}
          windowSize={7}
          removeClippedSubviews
          keyboardShouldPersistTaps="handled"
          onViewableItemsChanged={query.trim() ? undefined : onViewableItemsChanged}
          viewabilityConfig={{ itemVisiblePercentThreshold: 10 }}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <Text style={[styles.empty, { color: theme.textMuted }]}>
              {query.trim() ? '—' : ''}
            </Text>
          }
        />
        {!query.trim() && (
          <View style={[styles.bar, { borderTopColor: theme.border }]}>
            {categoryBar.map((id) => (
              <Pressable
                key={id}
                testID={`emoji-category-${id}`}
                onPress={() => jumpTo(id)}
                style={[
                  styles.barItem,
                  activeCategory === id && {
                    backgroundColor: theme.surfaceSecondary,
                  },
                ]}
              >
                <Text style={styles.barGlyph}>{CATEGORY_ICONS[id] || '•'}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
  },
  dim: {
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 12,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowOffset: { width: 0, height: -4 },
    shadowRadius: 12,
    elevation: 12,
  },
  dragArea: {
    paddingTop: 2,
  },
  grabberHit: {
    height: 26,
    justifyContent: 'center',
    marginBottom: 4,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    paddingHorizontal: 12,
    height: 40,
    marginBottom: 8,
  },
  searchIcon: {
    fontSize: 18,
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 0,
  },
  listContent: {
    paddingBottom: 8,
  },
  header: {
    height: HEADER_HEIGHT,
    lineHeight: HEADER_HEIGHT,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.6,
  },
  row: {
    flexDirection: 'row',
    height: ROW_HEIGHT,
  },
  cell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  cellGlyph: {
    fontSize: 28,
  },
  empty: {
    textAlign: 'center',
    paddingVertical: 24,
  },
  bar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  barItem: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  barGlyph: {
    fontSize: 18,
  },
});

export default EmojiPickerSheet;
