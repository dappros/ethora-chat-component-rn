import React from 'react';
import { Text, View, Linking, StyleSheet, TouchableOpacity } from 'react-native';

export const MarkDown = (text: string): (string | JSX.Element)[] => {
  if (typeof text !== 'string') {return [text];}

  let key = 0;
  const elements: (string | JSX.Element)[] = [];
  const lines = text.split('\n');

  let inCodeBlock = false;
  let codeLanguage = '';
  const codeBuffer: string[] = [];

  const parseInline = (input: string): (string | JSX.Element)[] => {
    const output: (string | JSX.Element)[] = [];

    const regex =
      /(\*\*\*[^*]+?\*\*\*|\*\*[^*]+?\*\*|\*[^*]+?\*|~~[^~]+?~~|`[^`]+?`|https:\/\/[\w.-]+(?:\.[\w.-]+)+[\w\-._~:/?#[\]@!$&'()*+,;=]+)/g;

    let lastIndex = 0;
    let match;

    while ((match = regex.exec(input)) !== null) {
      if (match.index > lastIndex) {
        output.push(input.slice(lastIndex, match.index));
      }

      const token = match[0];
      if (/^\*\*\*.*\*\*\*$/.test(token)) {
        output.push(
          <Text key={`b-${key++}`} style={styles.bold}>
            <Text style={styles.italic}>{token.slice(3, -3)}</Text>
          </Text>
        );
      } else if (/^\*\*.*\*\*$/.test(token)) {
        output.push(<Text key={`b-${key++}`} style={styles.bold}>{token.slice(2, -2)}</Text>);
      } else if (/^\*.*\*$/.test(token)) {
        output.push(<Text key={`i-${key++}`} style={styles.italic}>{token.slice(1, -1)}</Text>);
      } else if (/^~~.*~~$/.test(token)) {
        output.push(<Text key={`s-${key++}`} style={styles.strike}>{token.slice(2, -2)}</Text>);
      } else if (/^`.*`$/.test(token)) {
        output.push(
          <Text
            key={`code-${key++}`}
            style={styles.codeInline}
          >
            {token.slice(1, -1).trim()}
          </Text>
        );
      } else if (/^https:\/\//.test(token)) {
        output.push(
          <Text key={`link-${key++}`}>
            <Text
              onPress={() => Linking.openURL(token)}
              style={styles.link}
            >
              {token}
            </Text>
          </Text>
        );
      }

      lastIndex = match.index + token.length;
    }

    if (lastIndex < input.length) {
      output.push(input.slice(lastIndex));
    }

    return output;
  };

  const parseList = (
    startIndex: number
  ): { list: JSX.Element; newIndex: number } => {
    const items: JSX.Element[] = [];
    const line = lines[startIndex].trim();
    const match = line.match(/^(\d+)\./);
    const isOrdered = !!match;
    const start = match ? parseInt(match[1], 10) : 1;

    let i = startIndex;
    while (i < lines.length) {
      const currentLine = lines[i];
      if (/^(\d+\.\s+|\-\s+)/.test(currentLine)) {
        const itemText = currentLine.replace(/^(\d+\.\s+|\-\s+)/, '');
        items.push(
          <View key={`li-${key++}`} style={styles.listItem}>
            <Text style={styles.listMarker}>{isOrdered ? `${start + items.length - 1}.` : '•'}</Text>
            <View style={styles.listItemContent}>
              {parseInline(itemText).map((el, idx) => (
                <React.Fragment key={idx}>{el}</React.Fragment>
              ))}
            </View>
          </View>
        );
      } else if (currentLine.trim() === '') {
        break;
      } else {
        break;
      }
      i++;
    }

    const ListTag = isOrdered ? 'ol' : 'ul';
    return {
      list: (
        <View key={`list-${key++}`} style={styles.list}>
          {items}
        </View>
      ),
      newIndex: i - 1,
    };
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
        <View
          key={`pre-${key++}`}
          style={styles.codeBlock}
        >
          <Text style={styles.codeBlockText}>
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
      const level = line.match(/^#+/)![0].length;
      const content = line.replace(/^#{1,6}\s/, '');
      const headingStyle = styles[`h${level}` as keyof typeof styles] || styles.h1;
      elements.push(
        <Text key={`h-${key++}`} style={headingStyle}>
          {parseInline(content).map((el, idx) => (
            <React.Fragment key={idx}>{el}</React.Fragment>
          ))}
        </Text>
      );
      continue;
    }

    if (line.startsWith('>')) {
      elements.push(
        <View
          key={`quote-${key++}`}
          style={styles.quote}
        >
          {parseInline(line.replace(/^>\s*/, '')).map((el, idx) => (
            <React.Fragment key={idx}>{el}</React.Fragment>
          ))}
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
      elements.push(<View key={`br-${key++}`} style={styles.break} />);
    } else {
      elements.push(
        <Text key={`p-${key++}`} style={styles.paragraph}>
          {parseInline(line).map((el, idx) => (
            <React.Fragment key={idx}>{el}</React.Fragment>
          ))}
        </Text>
      );
    }
  }

  return elements;
};

const styles = StyleSheet.create({
  bold: {
    fontWeight: 'bold',
  },
  italic: {
    fontStyle: 'italic',
  },
  strike: {
    textDecorationLine: 'line-through',
  },
  codeInline: {
    backgroundColor: '#eee',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    fontFamily: 'monospace',
    fontSize: 14,
  },
  link: {
    color: 'blue',
    textDecorationLine: 'underline',
  },
  codeBlock: {
    backgroundColor: '#f0f0f0',
    padding: 10,
    borderRadius: 8,
    marginVertical: 8,
  },
  codeBlockText: {
    fontFamily: 'monospace',
    fontSize: 14,
  },
  h1: {
    fontSize: 32,
    fontWeight: 'bold',
    marginTop: 24,
    marginBottom: 16,
  },
  h2: {
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 20,
    marginBottom: 14,
  },
  h3: {
    fontSize: 20,
    fontWeight: 'bold',
    marginTop: 16,
    marginBottom: 12,
  },
  h4: {
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 14,
    marginBottom: 10,
  },
  h5: {
    fontSize: 16,
    fontWeight: 'bold',
    marginTop: 12,
    marginBottom: 8,
  },
  h6: {
    fontSize: 14,
    fontWeight: 'bold',
    marginTop: 12,
    marginBottom: 8,
  },
  quote: {
    borderLeftWidth: 3,
    borderLeftColor: '#ccc',
    paddingLeft: 10,
    marginVertical: 4,
  },
  list: {
    marginVertical: 8,
    paddingLeft: 20,
  },
  listItem: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  listMarker: {
    marginRight: 8,
    minWidth: 20,
  },
  listItemContent: {
    flex: 1,
  },
  paragraph: {
    marginVertical: 4,
  },
  break: {
    height: 8,
  },
});
