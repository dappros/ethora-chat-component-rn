import React from 'react';
import { Text, View, Pressable, Linking, Platform, ScrollView } from 'react-native';

export const parseMessageBody = (text: string): (string | JSX.Element)[] => {
  if (typeof text !== 'string') return [text];

  let key = 0;
  const elements: (string | JSX.Element)[] = [];
  const lines = text.split('\n');

  let inCodeBlock = false;
  let codeLanguage = '';
  const codeBuffer: string[] = [];

  const styles = {
    bold: { fontWeight: 'bold' as const },
    italic: { fontStyle: 'italic' as const },
    strike: { textDecorationLine: 'line-through' as const },
    codeInline: {
      backgroundColor: '#eee',
      paddingVertical: 1,
      paddingHorizontal: 4,
      borderRadius: 4,
      fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
    },
    codeBlock: {
      backgroundColor: '#f0f0f0',
      padding: 10,
      borderRadius: 8,
      marginVertical: 4,
    },
    h: [
      { fontWeight: 'bold' as const, fontSize: 24, marginVertical: 6 }, // h1
      { fontWeight: 'bold' as const, fontSize: 20, marginVertical: 6 }, // h2
      { fontWeight: 'bold' as const, fontSize: 18, marginVertical: 6 }, // h3
      { fontWeight: 'bold' as const, fontSize: 16, marginVertical: 6 }, // h4
      { fontWeight: 'bold' as const, fontSize: 15, marginVertical: 6 }, // h5
      { fontWeight: 'bold' as const, fontSize: 14, marginVertical: 6 }, // h6
    ],
    quote: {
      borderLeftWidth: 3,
      borderLeftColor: '#ccc',
      paddingLeft: 10,
      marginVertical: 2,
    },
    listItemRow: { flexDirection: 'row' as const, alignItems: 'flex-start' as const },
    listMarker: { minWidth: 20 },
    link: { color: 'blue', textDecorationLine: 'underline' as const },
    paragraph: { marginVertical: 2 },
    tableContainer: { marginVertical: 8 },
  tableInner: { borderWidth: 1, borderColor: '#ccc', borderRadius: 6, overflow: 'hidden' as const },
  tableRow: { flexDirection: 'row' as const },
  th: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 6,
    backgroundColor: '#f9f9f9',
    borderRightWidth: 1,
    borderRightColor: '#ccc',
  },
  td: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderTopWidth: 1,
    borderTopColor: '#e3e3e3',
    borderRightWidth: 1,
    borderRightColor: '#eee',
  },
  lastCell: { borderRightWidth: 0 },
  cellText: { color: '#333' as const, fontSize: 14 },
  };

  const parseInline = (input: string): (string | JSX.Element)[] => {
    const output: (string | JSX.Element)[] = [];
    const regex =
      /(\*\*\*[^*]+?\*\*\*|\*\*[^*]+?\*\*|\*[^*]+?\*|~~[^~]+?~~|`[^`]+?`|https?:\/\/[\w.-]+(?:\.[\w.-]+)+[\w\-._~:/?#[\]@!$&'()*+,;=]+)/g;

    let lastIndex = 0, match;
    while ((match = regex.exec(input)) !== null) {
      if (match.index > lastIndex) output.push(input.slice(lastIndex, match.index));
      const token = match[0];
      if (/^\*\*\*.*\*\*\*$/.test(token)) {
        output.push(
          <Text key={`b-${key++}`} style={[styles.bold, styles.italic]}>
            {token.slice(3, -3)}
          </Text>
        );
      } else if (/^\*\*.*\*\*$/.test(token)) {
        output.push(
          <Text key={`b-${key++}`} style={styles.bold}>
            {token.slice(2, -2)}
          </Text>
        );
      } else if (/^\*.*\*$/.test(token)) {
        output.push(
          <Text key={`i-${key++}`} style={styles.italic}>
            {token.slice(1, -1)}
          </Text>
        );
      } else if (/^~~.*~~$/.test(token)) {
        output.push(
          <Text key={`s-${key++}`} style={styles.strike}>
            {token.slice(2, -2)}
          </Text>
        );
      } else if (/^`.*`$/.test(token)) {
        output.push(
          <Text key={`code-${key++}`} style={styles.codeInline}>
            {token.slice(1, -1).trim()}
          </Text>
        );
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

  const parseList = (
    startIndex: number
  ): { list: JSX.Element; newIndex: number } => {
    const items: JSX.Element[] = [];
    const line = lines[startIndex].trim();
    const match = line.match(/^(\d+)\./);
    const isOrdered = !!match;
    let listItemNumber = isOrdered ? parseInt(match?.[1] ?? '1', 10) : 1;

    let i = startIndex;
    while (i < lines.length) {
      const currentLine = lines[i];
      if (/^(\d+\.\s+|\-\s+)/.test(currentLine)) {
        const itemText = currentLine.replace(/^(\d+\.\s+|\-\s+)/, '');
        items.push(
          <View key={`li-${key++}`} style={styles.listItemRow}>
            <Text style={styles.listMarker}>{isOrdered ? `${listItemNumber++}.` : '\u2022'}</Text>
            <Text style={{ flex: 1 }}>{parseInline(itemText)}</Text>
          </View>
        );
      } else if (currentLine.trim() === '') {
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

  const parseTable = (
    startIndex: number
  ): { table: JSX.Element; newIndex: number } | null => {
    const rows: string[][] = [];
    let i = startIndex;
  
    while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) {
      const cols = lines[i]
        .trim()
        .slice(1, -1)
        .split('|')
        .map((c) => c.trim());
      rows.push(cols);
      i++;
    }
  
    if (rows.length < 2) return null;
  
    const headers = rows[0];
    const separator = rows[1] ?? [];
    const dataRows = rows.slice(2);
  
    const aligns: Array<'left' | 'center' | 'right'> = headers.map((_, idx) => {
      const seg = (separator[idx] || '').trim();
      const left = seg.startsWith(':');
      const right = seg.endsWith(':');
      if (left && right) return 'center';
      if (right) return 'right';
      return 'left';
    });
  
    const tableEl = (
      <ScrollView
        key={`table-${key++}`}
        horizontal
        bounces={false}
        showsHorizontalScrollIndicator={false}
        style={styles.tableContainer}
      >
        <View style={styles.tableInner}>
          <View style={styles.tableRow}>
            {headers.map((h, cIdx) => (
              <View
                key={`th-${key++}-${cIdx}`}
                style={[styles.th, cIdx === headers.length - 1 && styles.lastCell]}
              >
                <Text
                  style={[
                    styles.cellText,
                    { fontWeight: '700', textAlign: aligns[cIdx] },
                  ]}
                >
                  {parseInline(h)}
                </Text>
              </View>
            ))}
          </View>
  
          {dataRows.map((row, rIdx) => (
            <View key={`tr-${key++}-${rIdx}`} style={styles.tableRow}>
              {headers.map((_, cIdx) => {
                const cell = row[cIdx] ?? '';
                return (
                  <View
                    key={`td-${key++}-${cIdx}`}
                    style={[styles.td, cIdx === headers.length - 1 && styles.lastCell]}
                  >
                    <Text style={[styles.cellText, { textAlign: aligns[cIdx] }]}>
                      {parseInline(cell)}
                    </Text>
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>
    );
  
    return { table: tableEl, newIndex: i - 1 };
  };

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];

    if (!inCodeBlock && line.trim().startsWith('```')) {
      const match = line.trim().match(/^```(?:\s*(\w+))?/);
      inCodeBlock = true;
      codeLanguage = match?.[1] || '';
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
      codeBuffer.length = 0;
      codeLanguage = '';
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
        <Text key={`h-${key++}`} style={styles.h[level]}>
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
    
    if (/^\|.*\|$/.test(line.trim())) {
      const tableResult = parseTable(idx);
      if (tableResult) {
        elements.push(tableResult.table);
        idx = tableResult.newIndex;
        continue;
      }
    }

    if (/^(\-|\d+\.)\s+/.test(line) || /^\[\s?\]/.test(line)) {
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
};
