import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../markdown';

describe('renderMarkdown', () => {
  it('renders paragraphs, joining wrapped lines', () => {
    expect(renderMarkdown('one\ntwo\n\nthree')).toBe('<p>one two</p>\n<p>three</p>');
  });

  it('renders headings one level below the page title', () => {
    expect(renderMarkdown('## Section')).toBe('<h3>Section</h3>');
    expect(renderMarkdown('# Top')).toBe('<h2>Top</h2>');
  });

  it('renders fenced code without touching its contents', () => {
    const html = renderMarkdown('```rust\nlet a = 1 < 2;\n```');
    expect(html).toContain('<pre><code class="language-rust">');
    expect(html).toContain('let a = 1 &lt; 2;');
  });

  it('renders both kinds of list', () => {
    expect(renderMarkdown('- a\n- b')).toBe('<ul>\n<li>a</li>\n<li>b</li>\n</ul>');
    expect(renderMarkdown('1. a\n2. b')).toBe('<ol>\n<li>a</li>\n<li>b</li>\n</ol>');
  });

  it('renders inline code, emphasis, and links', () => {
    expect(renderMarkdown('use `String` here')).toContain('<code>String</code>');
    expect(renderMarkdown('**bold**')).toContain('<strong>bold</strong>');
    expect(renderMarkdown('[docs](https://doc.rust-lang.org)')).toContain(
      '<a href="https://doc.rust-lang.org" target="_blank" rel="noreferrer">docs</a>',
    );
    expect(renderMarkdown('[trials](/trials)')).toContain('<a href="/trials">trials</a>');
  });

  it('escapes HTML even though the input is trusted', () => {
    // The input is ours today. It should not be the only thing standing between
    // a future community lesson and an injected script.
    const html = renderMarkdown('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes inside code blocks too', () => {
    expect(renderMarkdown('```\n<img onerror=x>\n```')).not.toContain('<img');
  });

  it('does not turn a javascript: URL into a link', () => {
    const html = renderMarkdown('[click](javascript:alert(1))');
    expect(html).not.toContain('<a ');
  });

  it('handles an empty document', () => {
    expect(renderMarkdown('')).toBe('');
  });
});
