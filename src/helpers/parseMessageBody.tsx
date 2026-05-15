import React from 'react';
import {
  Text,
  View,
  Pressable,
  Linking,
  Platform,
  ScrollView,
  StyleProp,
  ViewStyle,
} from 'react-native';

let elementKeyCounter = 0;

export const decodeHTMLEntities = (text: string) => {
  const entities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&nbsp;': ' ',
    '&ndash;': '–',
    '&mdash;': '—',
    '&hellip;': '…',
    '&#8209;': '-',
  };
  return text.replace(/&[a-zA-Z0-9#]+;/g, (m) => entities[m] || m);
};

const styles = {
  bold: { fontWeight: 'bold' as const },
  italic: { fontStyle: 'italic' as const },
  strike: { textDecorationLine: 'line-through' as const },
  link: { color: '#0a66c2', textDecorationLine: 'underline' as const },

  codeInlineBox: {
    backgroundColor: '#f1f3f4',
    borderRadius: 3,
    paddingVertical: 1,
    paddingHorizontal: 4,
  },
  codeInlineText: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
    fontSize: 13,
    color: '#333',
  },

  codeBlock: {
    backgroundColor: '#f6f8fa',
    padding: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#e1e4e8',
    marginVertical: 8,
  } as const,
  codeBlockText: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
    fontSize: 14,
    color: '#24292f',
    lineHeight: 20,
  },

  h: [
    { fontWeight: 'bold' as const, fontSize: 32, marginTop: 24, marginBottom: 16 },
    { fontWeight: 'bold' as const, fontSize: 24, marginTop: 20, marginBottom: 14 },
    { fontWeight: 'bold' as const, fontSize: 20, marginTop: 16, marginBottom: 12 },
    { fontWeight: 'bold' as const, fontSize: 18, marginTop: 14, marginBottom: 10 },
    { fontWeight: 'bold' as const, fontSize: 16, marginTop: 12, marginBottom: 8 },
    { fontWeight: 'bold' as const, fontSize: 14, marginTop: 12, marginBottom: 8 },
  ],

  quote: {
    borderLeftWidth: 3,
    borderLeftColor: '#ccc',
    paddingLeft: 10,
    marginVertical: 4,
  },

  paragraph: { marginVertical: 6 },

  hr: { height: 1, backgroundColor: '#e1e4e8', marginVertical: 20 },

  listItemRow: { flexDirection: 'row' as const, alignItems: 'flex-start' as const },
  listMarker: { minWidth: 22, paddingTop: 2 },

  checkboxRow: { flexDirection: 'row' as const, alignItems: 'flex-start' as const },
  checkboxBox: {
    width: 16,
    height: 16,
    marginRight: 8,
    marginTop: 2,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: '#bbb',
    backgroundColor: '#fff',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  checkboxTick: { fontSize: 12, color: '#0a66c2' },

  tableContainer: { marginVertical: 12 } as StyleProp<ViewStyle>,
  tableInner: {
    borderWidth: 1,
    borderColor: '#d0d7de',
    borderRadius: 6,
    overflow: 'hidden' as const,
    backgroundColor: '#fff',
  },
  tableRow: { flexDirection: 'row' as const },
  th: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#f6f8fa',
    borderRightWidth: 1,
    borderRightColor: '#d0d7de',
  },
  td: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderTopWidth: 1,
    borderTopColor: '#e7e9ec',
    borderRightWidth: 1,
    borderRightColor: '#eef0f2',
  },
  lastCell: { borderRightWidth: 0 },
  cellText: { color: '#24292f', fontSize: 14, lineHeight: 20 } as const,
};

const renderTextWithLinks = (text: string) => {
  const urlRegex =
    /(https?:\/\/[\w.-]+(?:\.[\w.-]+)+[\w\-\._~:\/?#[\]@!\$&'()\*\+,;=.]+)/g;
  const nodes: Array<string | JSX.Element> = [];
  let lastIndex = 0;

  if (!text) {return nodes;}

  let match: RegExpExecArray | null;
  while ((match = urlRegex.exec(text)) !== null) {
    const url = match[0];
    const start = match.index;

    if (start > lastIndex) {nodes.push(text.slice(lastIndex, start));}

    nodes.push(
      <Pressable key={`link-${elementKeyCounter++}`} onPress={() => Linking.openURL(url)}>
        <Text style={styles.link}>{url}</Text>
      </Pressable>
    );

    lastIndex = start + url.length;
  }

  if (lastIndex < text.length) {nodes.push(text.slice(lastIndex));}
  return nodes;
};

const parseInline = (txt: string): (string | JSX.Element)[] => {
  const elements: (string | JSX.Element)[] = [];
  let remaining = decodeHTMLEntities(txt);

  const pattern = /(\*\*\*|\*\*|\*|`)(.*?)\1/;

  while (remaining.length > 0) {
    const match = remaining.match(pattern);
    if (!match) {
      elements.push(...renderTextWithLinks(remaining));
      break;
    }

    const fullMatch = match[0];
    const matchIndex = match.index ?? 0;
    const delimiter = match[1];
    const content = match[2];

    if (matchIndex > 0) {
      elements.push(...renderTextWithLinks(remaining.substring(0, matchIndex)));
    }

    if (delimiter === '`') {
      elements.push(
        <View key={`code-${elementKeyCounter++}`} style={styles.codeInlineBox}>
          <Text style={styles.codeInlineText}>{content}</Text>
        </View>
      );
    } else if (delimiter === '***') {
      elements.push(
        <Text key={`bi-${elementKeyCounter++}`} style={styles.bold}>
          <Text key={`i-${elementKeyCounter++}`} style={styles.italic}>
            {parseInline(content)}
          </Text>
        </Text>
      );
    } else if (delimiter === '**') {
      elements.push(
        <Text key={`b-${elementKeyCounter++}`} style={styles.bold}>
          {parseInline(content)}
        </Text>
      );
    } else if (delimiter === '*') {
      elements.push(
        <Text key={`i-${elementKeyCounter++}`} style={styles.italic}>
          {parseInline(content)}
        </Text>
      );
    }

    remaining = remaining.substring(matchIndex + fullMatch.length);
  }

  return elements;
};

const isTableSeparatorLine = (line: string) => {
  const trimmed = line.trim();
  return (
    /^\|?[\s]*[\-\:]+[\s\|\-\:]*\|?[\s]*$/.test(trimmed) && trimmed.includes('-')
  );
};

const parseTableRow = (line: string) => {
  const decodedLine = decodeHTMLEntities(line.trim()).replace(/\u00A0/g, ' ');
  const cleaned = decodedLine.replace(/^\||\|$/g, '');
  const cells = cleaned
    .split(/(?<!\\)\|/)
    .map((c) => c.replace(/\\\|/g, '|').trim());
  return cells.length > 0 ? cells : [''];
};

const renderMarkdownTableRN = (
  headers: string[],
  separator: string[],
  dataRows: string[][]
) => {
  const aligns: Array<'left' | 'center' | 'right'> = headers.map((_, idx) => {
    const seg = (separator[idx] || '').trim();
    const left = seg.startsWith(':');
    const right = seg.endsWith(':');
    if (left && right) {return 'center';}
    if (right) {return 'right';}
    return 'left';
  });

  return (
    <ScrollView
      key={`table-${elementKeyCounter++}`}
      horizontal
      bounces={false}
      showsHorizontalScrollIndicator={false}
      style={styles.tableContainer}
    >
      <View style={styles.tableInner}>
        <View style={styles.tableRow}>
          {headers.map((h, cIdx) => (
            <View
              key={`th-${elementKeyCounter++}-${cIdx}`}
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
          <View key={`tr-${elementKeyCounter++}-${rIdx}`} style={styles.tableRow}>
            {headers.map((_, cIdx) => {
              const cell = row[cIdx] ?? '';
              return (
                <View
                  key={`td-${elementKeyCounter++}-${cIdx}`}
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
};

export const parseMessageBody = (text: string): JSX.Element => {
  if (typeof text !== 'string') {
    return <View />;
  }

  const lines = text.split('\n');
  const elements: JSX.Element[] = [];
  elementKeyCounter = 0;

  let listBuffer: Array<{
    type: 'ul' | 'checkbox';
    content: string;
    depth: number;
    checked?: boolean;
  }> = [];

  let inCodeBlock = false;
  let codeLang = '';
  let codeLines: string[] = [];

  const flushList = () => {
    if (listBuffer.length === 0) {return;}

    const renderListItems = (items: typeof listBuffer, depth: number): JSX.Element[] => {
      const result: JSX.Element[] = [];
      let i = 0;

      while (i < items.length) {
        const item = items[i];

        if (item.depth === depth) {
          const subItems: typeof listBuffer = [];
          let j = i + 1;
          while (j < items.length && items[j].depth > depth) {
            subItems.push(items[j]);
            j++;
          }

          const nested = subItems.length > 0 ? renderListItems(subItems, depth + 1) : null;

          let contentEl: JSX.Element;
          if (item.type === 'checkbox') {
            contentEl = (
              <View key={`checkbox-${elementKeyCounter++}`} style={styles.checkboxRow}>
                <View style={[styles.checkboxBox, item.checked && { backgroundColor: '#e8f3ff', borderColor: '#0a66c2' }]}>
                  {item.checked ? <Text style={styles.checkboxTick}>✓</Text> : null}
                </View>
                <Text style={{ flex: 1 }}>{parseInline(item.content)}</Text>
              </View>
            );
          } else {
            contentEl = (
              <View key={`ulitem-${elementKeyCounter++}`} style={styles.listItemRow}>
                <Text style={styles.listMarker}>{'\u2022'}</Text>
                <Text style={{ flex: 1 }}>{parseInline(item.content)}</Text>
              </View>
            );
          }

          result.push(
            <View key={`liwrap-${elementKeyCounter++}`} style={{ marginBottom: 6, marginLeft: depth * 16 }}>
              {contentEl}
              {nested}
            </View>
          );
          i = j;
        } else {
          i++;
        }
      }
      return result;
    };

    const listContent = renderListItems(listBuffer, 0);
    elements.push(
      <View key={`list-${elementKeyCounter++}`} style={{ marginVertical: 8 }}>
        {listContent}
      </View>
    );

    listBuffer = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    if (trimmedLine.startsWith('```')) {
      flushList();
      inCodeBlock = !inCodeBlock;
      if (!inCodeBlock) {
        elements.push(
          <View key={`pre-${elementKeyCounter++}`} style={styles.codeBlock}>
            <Text style={styles.codeBlockText} selectable>
              {codeLines.join('\n')}
            </Text>
          </View>
        );
        codeLang = '';
      } else {
        codeLang = trimmedLine.slice(3).trim();
        codeLines = [];
      }
      continue;
    }
    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    const headingMatch = trimmedLine.match(/^(#{1,6})\s+(.*)/);
    if (headingMatch) {
      flushList();
      const level = Math.min(6, Math.max(1, headingMatch[1].length));
      const content = headingMatch[2];
      elements.push(
        <Text key={`h-${elementKeyCounter++}`} style={styles.h[level - 1]}>
          {parseInline(content)}
        </Text>
      );
      continue;
    }

    if (/^(\*|\-|\_){3,}$/.test(trimmedLine)) {
      flushList();
      elements.push(<View key={`hr-${elementKeyCounter++}`} style={styles.hr} />);
      continue;
    }

    if (
      trimmedLine.includes('|') &&
      trimmedLine !== '' &&
      !isTableSeparatorLine(trimmedLine) &&
      !trimmedLine.match(/^\s*-?\s*\[[\sxX]\]/)
    ) {
      let separatorIndex = i + 1;
      while (separatorIndex < lines.length && lines[separatorIndex].trim() === '') {
        separatorIndex++;
      }

      if (separatorIndex < lines.length && isTableSeparatorLine(lines[separatorIndex].trim())) {
        flushList();

        const rows: string[][] = [];
        const headers = parseTableRow(trimmedLine);
        const headerCount = headers.length;
        rows.push(headers);

        const sep = parseTableRow(lines[separatorIndex].trim());

        let current = separatorIndex + 1;
        while (current < lines.length) {
          const nextLine = lines[current].trim();
          if (nextLine === '') {
            current++;
            continue;
          }
          if (
            nextLine.includes('|') &&
            !isTableSeparatorLine(nextLine) &&
            !nextLine.match(/^\s*-?\s*\[[\sxX]\]/)
          ) {
            let rowCells = parseTableRow(nextLine);
            while (rowCells.length < headerCount) {rowCells.push('');}
            rowCells = rowCells.slice(0, headerCount);
            rows.push(rowCells);
            current++;
          } else {
            break;
          }
        }

        const dataRows = rows.slice(1);
        elements.push(renderMarkdownTableRN(headers, sep, dataRows));
        i = current - 1;
        continue;
      }
    }

    const listMatch = line.match(/^(\s*)(?:-|\*|\+)?\s*(\[[\sxX]\])\s*(.*)/);
    if (listMatch) {
      const leadingSpace = listMatch[1];
      const checkboxPart = listMatch[2];
      const content = listMatch[3];
      const depth = Math.floor(leadingSpace.length / 2);
      const checked = checkboxPart.toLowerCase() === '[x]';
      listBuffer.push({ type: 'checkbox', content: decodeHTMLEntities(content), depth, checked });
      continue;
    }

    const bulletMatch = line.match(/^(\s*)([-*+])\s+(.*)/);
    if (bulletMatch && bulletMatch[3].trim() !== '') {
      const depth = Math.floor(bulletMatch[1].length / 2);
      listBuffer.push({ type: 'ul', content: decodeHTMLEntities(bulletMatch[3]), depth });
      continue;
    }

    if (trimmedLine !== '') {
      flushList();
      elements.push(
        <View key={`p-${elementKeyCounter++}`} style={styles.paragraph}>
          <Text>{parseInline(trimmedLine)}</Text>
        </View>
      );
    } else {
      flushList();
    }
  }

  flushList();

  return (
    <View
      style={{
      }}
    >
      {elements}
    </View>
  );
};

export default parseMessageBody;
