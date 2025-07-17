import React from 'react';
import { Linking, Platform, Pressable, Text, View } from 'react-native';

// ——— Стили для markdown-элементов
import type { TextStyle, ViewStyle } from 'react-native';

const styles: {
  paragraph: ViewStyle;
  heading: TextStyle[];
  codeBlock: ViewStyle;
  codeInline: TextStyle;
  link: TextStyle;
  quote: ViewStyle;
  listItemRow: ViewStyle;
  listMarker: TextStyle;
} = {
  paragraph: { marginVertical: 2 },
  heading: [
    { fontWeight: 'bold' as TextStyle['fontWeight'], fontSize: 24, marginVertical: 6 },
    { fontWeight: 'bold' as TextStyle['fontWeight'], fontSize: 20, marginVertical: 6 },
    { fontWeight: 'bold' as TextStyle['fontWeight'], fontSize: 18, marginVertical: 6 },
    { fontWeight: 'bold' as TextStyle['fontWeight'], fontSize: 16, marginVertical: 6 },
    { fontWeight: 'bold' as TextStyle['fontWeight'], fontSize: 15, marginVertical: 6 },
    { fontWeight: 'bold' as TextStyle['fontWeight'], fontSize: 14, marginVertical: 6 },
  ],
  codeBlock: {
    backgroundColor: '#f0f0f0',
    padding: 10,
    borderRadius: 8,
    marginVertical: 4,
  },
  codeInline: {
    backgroundColor: '#eee',
    paddingVertical: 1,
    paddingHorizontal: 4,
    borderRadius: 4,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
  },
  link: { color: 'blue', textDecorationLine: 'underline' },
  quote: {
    borderLeftWidth: 3,
    borderLeftColor: '#ccc',
    paddingLeft: 10,
    marginVertical: 2,
  },
  listItemRow: { flexDirection: 'row', alignItems: 'flex-start' },
  listMarker: { minWidth: 20 } as TextStyle,
};

export function parseMessageBody(text: string): (string | JSX.Element)[] {
  if (typeof text !== 'string') return [text];

  let key = 0;
  const elements: (string | JSX.Element)[] = [];
  const lines = text.split('\n');

  let inCodeBlock = false;
  let codeBuffer: string[] = [];

  const parseInline = (input: string): (string | JSX.Element)[] => {
    const output: (string | JSX.Element)[] = [];
    const regex =
      /(\*\*\*[^*]+?\*\*\*|\*\*[^*]+?\*\*|\*[^*]+?\*|~~[^~]+?~~|`[^`]+?`|https?:\/\/[\w.-]+(?:\.[\w.-]+)+[\w\-._~:/?#[\]@!$&'()*+,;=]+)/g;

    let lastIndex = 0, match;
    while ((match = regex.exec(input)) !== null) {
      if (match.index > lastIndex) output.push(input.slice(lastIndex, match.index));
      const token = match[0];
      if (/^\*\*\*.*\*\*\*$/.test(token)) {
        output.push(<Text key={`b-${key++}`} style={{ fontWeight: 'bold', fontStyle: 'italic' }}>{token.slice(3, -3)}</Text>);
      } else if (/^\*\*.*\*\*$/.test(token)) {
        output.push(<Text key={`b-${key++}`} style={{ fontWeight: 'bold' }}>{token.slice(2, -2)}</Text>);
      } else if (/^\*.*\*$/.test(token)) {
        output.push(<Text key={`i-${key++}`} style={{ fontStyle: 'italic' }}>{token.slice(1, -1)}</Text>);
      } else if (/^~~.*~~$/.test(token)) {
        output.push(<Text key={`s-${key++}`} style={{ textDecorationLine: 'line-through' }}>{token.slice(2, -2)}</Text>);
      } else if (/^`.*`$/.test(token)) {
        output.push(<Text key={`code-${key++}`} style={styles.codeInline}>{token.slice(1, -1).trim()}</Text>);
      } else if (/^https?:\/\//.test(token)) {
        output.push(
          <Pressable key={`link-${key++}`} onPress={() => Linking.openURL(token)}>
            <Text style={styles.link}>{token}</Text>
          </Pressable>
        );
      }
      lastIndex = match.index + token.length;
    }
    if (lastIndex < input.length) output.push(input.slice(lastIndex));
    return output;
  };

  const parseList = (startIndex: number): { list: JSX.Element; newIndex: number } => {
    const items: JSX.Element[] = [];
    const isOrdered = /^\d+\./.test(lines[startIndex].trim());
    let i = startIndex;
    let listItemNumber = 1;
    while (i < lines.length) {
      const line = lines[i];
      if (/^(\d+\.\s+|\-\s+)/.test(line)) {
        const itemText = line.replace(/^(\d+\.\s+|\-\s+)/, '');
        items.push(
          <View style={styles.listItemRow} key={`li-${key++}`}>
            <Text style={styles.listMarker}>{isOrdered ? `${listItemNumber++}.` : '\u2022'}</Text>
            <Text style={{ flex: 1 }}>{parseInline(itemText)}</Text>
          </View>
        );
      } else if (line.trim() === '') {
        break;
      } else {
        break;
      }
      i++;
    }
    return {
      list: (
        <View key={`list-${key++}`} style={{ marginVertical: 3 }}>
          {items}
        </View>
      ),
      newIndex: i - 1,
    };
  };

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];

    if (!inCodeBlock && line.trim().startsWith('```')) {
      inCodeBlock = true;
      continue;
    }
    if (inCodeBlock && line.trim() === '```') {
      inCodeBlock = false;
      elements.push(
        <View key={`pre-${key++}`} style={styles.codeBlock}>
          <Text
            style={{
              fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
              fontSize: 13,
              color: '#333',
            }}
            selectable
          >
            {codeBuffer.join('\n')}
          </Text>
        </View>
      );
      codeBuffer = [];
      continue;
    }
    if (inCodeBlock) {
      codeBuffer.push(line);
      continue;
    }

    if (/^#{1,6}\s/.test(line)) {
      const level = (line.match(/^#+/)![0].length || 1) - 1;
      const content = line.replace(/^#{1,6}\s/, '');
      elements.push(
        <Text key={`h-${key++}`} style={styles.heading[level]}>
          {parseInline(content)}
        </Text>
      );
      continue;
    }

    if (line.startsWith('>')) {
      elements.push(
        <View key={`quote-${key++}`} style={styles.quote}>
          <Text>{parseInline(line.replace(/^>\s*/, ''))}</Text>
        </View>
      );
      continue;
    }

    if (/^(\-|\d+\.)\s+/.test(line)) {
      const { list, newIndex } = parseList(idx);
      elements.push(list);
      idx = newIndex;
      continue;
    }

    if (line.trim() === '') {
      elements.push(<View key={`br-${key++}`} />);
    } else {
      elements.push(
        <View key={`p-${key++}`} style={styles.paragraph}>
          <Text>{parseInline(line)}</Text>
        </View>
      );
    }
  }

  return elements;
}
