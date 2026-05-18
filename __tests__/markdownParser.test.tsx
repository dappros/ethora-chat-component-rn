/**
 * MarkDown — separate codepath from parseMessageBody.
 *
 * This parser returns an ARRAY of (string | JSX.Element) — not a
 * single root wrapped in <View />. Adds ~~strike~~ and `>` blockquote
 * (parseMessageBody doesn't), and uses a stricter inline regex that
 * doesn't allow nesting. We mount the array under a host wrapper so
 * react-test-renderer can introspect it.
 */

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { View, Text } from 'react-native';
import { MarkDown } from '../src/helpers/markdownParser';

const Wrapper: React.FC<{ src: string }> = ({ src }) => (
  <View>
    {MarkDown(src).map((el, i) => (
      <React.Fragment key={i}>{el}</React.Fragment>
    ))}
  </View>
);

const renderMd = async (src: any): Promise<renderer.ReactTestRenderer> => {
  let tree: renderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = renderer.create(<Wrapper src={src} />);
  });
  return tree!;
};

// Concatenate every string descendant under every <Text>. Using
// findAllByType + iterating .children directly avoids walking through
// React.Fragment indirection that breaks recursive `props.children`
// traversal once react-test-renderer flattens fragments.
const collectText = (root: any): string => {
  let out = '';
  const visit = (n: any) => {
    if (typeof n === 'string' || typeof n === 'number') {
      out += String(n);
      return;
    }
    if (Array.isArray(n)) {
      n.forEach(visit);
      return;
    }
    const kids = n?.children;
    if (kids) {
      (kids as any[]).forEach(visit);
    }
  };
  visit(root);
  return out;
};

describe('MarkDown — defensive', () => {
  it('returns a single-element array containing the non-string input', () => {
    const out = MarkDown(42 as any);
    expect(out).toEqual([42]);
  });
  it('empty string still produces one element (a `break` spacer) because `\'\'.split(\'\\n\')` is `[\'\']`', () => {
    // Documents the parser's contract: empty input is treated as a
    // single blank line, which the loop renders as a vertical-spacer
    // View. A consumer that needs "nothing" for empty input should
    // guard at the call site.
    const out = MarkDown('');
    expect(out).toHaveLength(1);
  });
});

describe('MarkDown — inline styles', () => {
  it('renders **bold**', async () => {
    const tree = await renderMd('plain **wow** end');
    const bolds = tree.root.findAllByType(Text).filter((t) => {
      const s = t.props.style;
      const styles = Array.isArray(s) ? s : [s];
      return styles.some((x: any) => x?.fontWeight === 'bold');
    });
    expect(bolds.length).toBeGreaterThan(0);
    expect(collectText(tree.root)).toContain('wow');
  });

  it('renders *italic*', async () => {
    const tree = await renderMd('a *slanted* word');
    const italics = tree.root.findAllByType(Text).filter((t) => {
      const s = t.props.style;
      const styles = Array.isArray(s) ? s : [s];
      return styles.some((x: any) => x?.fontStyle === 'italic');
    });
    expect(italics.length).toBeGreaterThan(0);
  });

  it('renders ~~strike~~ with line-through (markdownParser exclusive)', async () => {
    const tree = await renderMd('a ~~gone~~ word');
    const strikes = tree.root.findAllByType(Text).filter((t) => {
      const s = t.props.style;
      const styles = Array.isArray(s) ? s : [s];
      return styles.some((x: any) => x?.textDecorationLine === 'line-through');
    });
    expect(strikes.length).toBeGreaterThan(0);
  });

  it('renders `inline code` with monospace background', async () => {
    const tree = await renderMd('see `mono` here');
    const codes = tree.root.findAllByType(Text).filter((t) => {
      const s = t.props.style;
      const styles = Array.isArray(s) ? s : [s];
      return styles.some(
        (x: any) =>
          x?.backgroundColor === '#eee' && x?.fontFamily === 'monospace'
      );
    });
    expect(codes.length).toBeGreaterThan(0);
    expect(collectText(tree.root)).toContain('mono');
  });

  it('renders a URL as a tappable Text with the blue underline link style', async () => {
    const tree = await renderMd('visit https://example.com/docs today');
    // Find any Text node carrying { color: 'blue', textDecorationLine: 'underline' }.
    const links = tree.root.findAllByType(Text).filter((t) => {
      const s = t.props.style;
      const styles = Array.isArray(s) ? s : [s];
      return styles.some(
        (x: any) =>
          x?.color === 'blue' && x?.textDecorationLine === 'underline'
      );
    });
    expect(links.length).toBeGreaterThan(0);
    expect(links[0].props.onPress).toBeInstanceOf(Function);
  });
});

describe('MarkDown — block constructs', () => {
  it('renders `# Heading` with h1 style', async () => {
    const tree = await renderMd('# Big');
    const h1s = tree.root.findAllByType(Text).filter((t) => {
      const s = t.props.style;
      const styles = Array.isArray(s) ? s : [s];
      return styles.some(
        (x: any) => x?.fontWeight === 'bold' && x?.fontSize === 32
      );
    });
    expect(h1s.length).toBeGreaterThan(0);
  });

  it('renders `## Heading` with h2 style', async () => {
    const tree = await renderMd('## Medium');
    const h2s = tree.root.findAllByType(Text).filter((t) => {
      const s = t.props.style;
      const styles = Array.isArray(s) ? s : [s];
      return styles.some(
        (x: any) => x?.fontWeight === 'bold' && x?.fontSize === 24
      );
    });
    expect(h2s.length).toBeGreaterThan(0);
  });

  it('renders `> quoted` with the left-border quote style', async () => {
    const tree = await renderMd('> wisdom');
    const quotes = tree.root.findAllByType(View).filter((v) => {
      const s = v.props.style;
      const styles = Array.isArray(s) ? s : [s];
      return styles.some(
        (x: any) => x?.borderLeftWidth === 3 && x?.borderLeftColor === '#ccc'
      );
    });
    expect(quotes.length).toBeGreaterThan(0);
    expect(collectText(tree.root)).toContain('wisdom');
  });

  it('renders a fenced ```code block``` with the monospace block style', async () => {
    const tree = await renderMd('```\nlet x = 1;\n```');
    const blocks = tree.root.findAllByType(View).filter((v) => {
      const s = v.props.style;
      const styles = Array.isArray(s) ? s : [s];
      return styles.some(
        (x: any) =>
          x?.backgroundColor === '#f0f0f0' && x?.borderRadius === 8
      );
    });
    expect(blocks.length).toBeGreaterThan(0);
    expect(collectText(tree.root)).toContain('let x = 1;');
  });

  it('renders an unordered list with bullet markers', async () => {
    const tree = await renderMd('- one\n- two');
    const text = collectText(tree.root);
    expect(text).toContain('one');
    expect(text).toContain('two');
    expect(text).toContain('•');
  });

  it('renders an ordered list with numeric markers — off-by-one quirk pinned', async () => {
    // KNOWN QUIRK in markdownParser.tsx parseList:
    //   marker = `${start + items.length - 1}.`
    // Because items.length is read *before* push, the first marker is
    // `start - 1`, not `start`. So `3. first\n4. second` renders as
    // `2. first` / `3. second`. Documenting the current behaviour;
    // when the formula is fixed to `start + items.length`, flip the
    // expectations to /3\./ and /4\./.
    const tree = await renderMd('3. first\n4. second');
    const text = collectText(tree.root);
    expect(text).toContain('first');
    expect(text).toContain('second');
    expect(text).toMatch(/2\./);
    expect(text).toMatch(/3\./);
  });

  it('blank line becomes a `break` spacer View', async () => {
    const tree = await renderMd('one\n\ntwo');
    const breakViews = tree.root.findAllByType(View).filter((v) => {
      const s = v.props.style;
      const styles = Array.isArray(s) ? s : [s];
      return styles.some((x: any) => x?.height === 8);
    });
    expect(breakViews.length).toBeGreaterThan(0);
  });
});
