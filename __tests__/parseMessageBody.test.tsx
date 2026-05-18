/**
 * parseMessageBody — render-based L1 tests.
 *
 * The function returns a React tree; we mount it with
 * `react-test-renderer` and walk the tree to verify what the user
 * sees. Focus is on the contract a chat message author cares about:
 *
 *   - plain text renders as text
 *   - inline markdown: **bold**, *italic*, ***bold-italic***, `code`
 *   - links render as Pressable (tappable) with link style
 *   - block-level: headings (#), horizontal rule, paragraphs
 *   - fenced code blocks (```)
 *   - unordered list (- / * / +) and task list ([ ] / [x])
 *   - defensive: non-string input doesn't throw
 */

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text, View } from 'react-native';
import { parseMessageBody } from '../src/helpers/parseMessageBody';

// parseMessageBody returns a JSX tree; wrap the render in async act
// to match the pattern used by the other L2 suites (without it, the
// renderer is unmounted by the act-warning teardown before we get
// a chance to inspect tree.root).
const renderAsync = async (input: any) => {
  let tree: renderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = renderer.create(parseMessageBody(input));
  });
  return tree!;
};

// Flatten all string descendants under `node` into a single string.
// Useful because parseMessageBody nests <Text> inside <Text> for
// styled inline runs.
const collectText = (node: any): string => {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {return node.map(collectText).join('');}
  if (node?.props?.children) {return collectText(node.props.children);}
  return '';
};

describe('parseMessageBody — defensive', () => {
  it('returns an empty View for a non-string input without throwing', async () => {
    const tree = await renderAsync(123 as any);
    // The non-string branch returns a bare <View />.
    const root = tree.root;
    expect(root.findAllByType(View).length).toBeGreaterThan(0);
    expect(root.findAllByType(Text).length).toBe(0);
  });

  it('returns an empty View for an empty string', async () => {
    const tree = await renderAsync('');
    expect(tree.root.findAllByType(Text).length).toBe(0);
  });
});

describe('parseMessageBody — plain text', () => {
  it('wraps a plain line in a paragraph with the text', async () => {
    const tree = await renderAsync('hello world');
    const texts = tree.root.findAllByType(Text);
    expect(texts.length).toBeGreaterThan(0);
    expect(collectText(texts[0])).toContain('hello world');
  });

  it('preserves multiple paragraphs across blank lines', async () => {
    const tree = await renderAsync('one\n\ntwo');
    const allText = collectText(tree.root);
    expect(allText).toContain('one');
    expect(allText).toContain('two');
  });
});

describe('parseMessageBody — inline markdown', () => {
  it('renders **bold** with bold font weight', async () => {
    const tree = await renderAsync('plain **bold** end');
    const all = collectText(tree.root);
    expect(all).toContain('plain ');
    expect(all).toContain('bold');
    expect(all).toContain(' end');
    // Find any Text node whose style includes fontWeight: 'bold'.
    const boldNodes = tree.root.findAllByType(Text).filter((t) => {
      const s = t.props.style;
      const styles = Array.isArray(s) ? s : [s];
      return styles.some((x: any) => x?.fontWeight === 'bold');
    });
    expect(boldNodes.length).toBeGreaterThan(0);
  });

  it('renders *italic* with italic font style', async () => {
    const tree = await renderAsync('a *slanted* word');
    const italicNodes = tree.root.findAllByType(Text).filter((t) => {
      const s = t.props.style;
      const styles = Array.isArray(s) ? s : [s];
      return styles.some((x: any) => x?.fontStyle === 'italic');
    });
    expect(italicNodes.length).toBeGreaterThan(0);
  });

  it('renders ***bold-italic*** with both styles', async () => {
    const tree = await renderAsync('a ***strong-and-slanted*** word');
    const all = tree.root.findAllByType(Text);
    const hasBold = all.some((t) => {
      const s = t.props.style;
      const styles = Array.isArray(s) ? s : [s];
      return styles.some((x: any) => x?.fontWeight === 'bold');
    });
    const hasItalic = all.some((t) => {
      const s = t.props.style;
      const styles = Array.isArray(s) ? s : [s];
      return styles.some((x: any) => x?.fontStyle === 'italic');
    });
    expect(hasBold).toBe(true);
    expect(hasItalic).toBe(true);
  });

  it('renders `inline code` with monospace styling', async () => {
    const tree = await renderAsync('see `monospace` here');
    const text = collectText(tree.root);
    expect(text).toContain('monospace');
    // The inline-code wrapper uses backgroundColor: '#f1f3f4'.
    const codeBoxes = tree.root.findAllByType(View).filter((v) => {
      const s = v.props.style;
      const styles = Array.isArray(s) ? s : [s];
      return styles.some((x: any) => x?.backgroundColor === '#f1f3f4');
    });
    expect(codeBoxes.length).toBeGreaterThan(0);
  });

  it('decodes &amp; and other HTML entities in inline runs', async () => {
    const tree = await renderAsync('a &amp; b');
    expect(collectText(tree.root)).toContain('a & b');
  });
});

describe('parseMessageBody — links', () => {
  it('renders a URL as a tappable link with link styling', async () => {
    // The regex requires at least one trailing path/punct char after
    // the TLD — a bare "example.com" doesn't match (regex omits the
    // ✓ branch when nothing follows). Use a path so the link is
    // captured.
    const tree = await renderAsync('visit https://example.com/docs today');

    // jest-expo's Pressable export resolves to a wrapped class whose
    // identity doesn't match the imported `Pressable` symbol — so
    // findAllByType(Pressable) is unreliable here. Instead, find the
    // Text nodes that carry the link style; the link Pressable always
    // wraps one.
    const linkTexts = tree.root.findAllByType(Text).filter((t) => {
      const s = t.props.style;
      const styles = Array.isArray(s) ? s : [s];
      return styles.some(
        (x: any) =>
          x?.color === '#0a66c2' && x?.textDecorationLine === 'underline'
      );
    });
    expect(linkTexts.length).toBeGreaterThan(0);
    // Walk up to confirm the link is wrapped in something tappable
    // (a Pressable with onPress) — without trusting type identity.
    const hasPressableAncestor = linkTexts.some((t) => {
      let p: any = t.parent;
      while (p) {
        const typeName =
          typeof p.type === 'string'
            ? p.type
            : p.type?.displayName || p.type?.name;
        if (typeName === 'Pressable') {return true;}
        p = p.parent;
      }
      return false;
    });
    expect(hasPressableAncestor).toBe(true);

    const all = collectText(tree.root);
    expect(all).toContain('visit ');
    expect(all).toContain('https://example.com/docs');
    expect(all).toContain(' today');
  });
});

describe('parseMessageBody — block constructs', () => {
  it('renders `# Heading` with the largest heading style', async () => {
    const tree = await renderAsync('# Big Title');
    const headings = tree.root.findAllByType(Text).filter((t) => {
      const s = t.props.style;
      const styles = Array.isArray(s) ? s : [s];
      return styles.some(
        (x: any) => x?.fontWeight === 'bold' && x?.fontSize === 32
      );
    });
    expect(headings.length).toBeGreaterThan(0);
    expect(collectText(tree.root)).toContain('Big Title');
  });

  it('renders `---` as an <hr/> (View with the hr style)', async () => {
    const tree = await renderAsync('---');
    // hr style includes height + backgroundColor; the only emitted
    // element should be a View with no text children.
    expect(tree.root.findAllByType(Text).length).toBe(0);
    expect(tree.root.findAllByType(View).length).toBeGreaterThan(0);
  });

  it('renders a fenced ```code block``` selectable monospace', async () => {
    const tree = await renderAsync('```\nlet x = 1;\nlet y = 2;\n```');
    const codeTexts = tree.root.findAllByType(Text).filter(
      (t) => t.props.selectable === true
    );
    expect(codeTexts.length).toBeGreaterThan(0);
    const all = collectText(tree.root);
    expect(all).toContain('let x = 1;');
    expect(all).toContain('let y = 2;');
  });

  it('renders a bulleted list as a flex row with the bullet glyph', async () => {
    const tree = await renderAsync('- one\n- two');
    const text = collectText(tree.root);
    expect(text).toContain('one');
    expect(text).toContain('two');
    expect(text).toContain('•');
  });

  it('renders a [x] checkbox as checked, [ ] as unchecked', async () => {
    const tree = await renderAsync('- [x] done\n- [ ] todo');
    const all = collectText(tree.root);
    expect(all).toContain('done');
    expect(all).toContain('todo');
    // Checked rows draw the tick character ✓
    expect(all).toContain('✓');
  });
});
