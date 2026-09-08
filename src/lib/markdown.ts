/**
 * A deliberately small Markdown renderer for lesson prose.
 *
 * Rustly authors its own content, so the input is trusted and the feature set
 * needed is narrow: headings, paragraphs, lists, fenced code, inline code,
 * emphasis, and links. A full CommonMark implementation would add weight to
 * every page for syntax we do not use.
 *
 * Everything is escaped before any markup is inserted, so this stays safe even
 * though the input is trusted — an assumption that holds today should not be
 * the only thing standing between a future community-authored lesson and an
 * injected script.
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Inline formatting, applied to already-escaped text. */
function inline(escaped: string): string {
  return escaped
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]*)\)/g,
      (_match, label: string, href: string) =>
        href.startsWith('http')
          ? `<a href="${href}" target="_blank" rel="noreferrer">${label}</a>`
          : `<a href="${href}">${label}</a>`,
    );
}

/** Render trusted Markdown to HTML. */
export function renderMarkdown(markdown: string): string {
  const out: string[] = [];
  const lines = markdown.split('\n');
  let index = 0;
  let listOpen: 'ul' | 'ol' | null = null;

  const closeList = () => {
    if (listOpen) {
      out.push(`</${listOpen}>`);
      listOpen = null;
    }
  };

  while (index < lines.length) {
    const line = lines[index] ?? '';

    // Fenced code. The language tag is kept as a class for future highlighting.
    const fence = /^```(\w*)\s*$/.exec(line);
    if (fence) {
      closeList();
      const language = fence[1] ?? '';
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index] ?? '')) {
        body.push(lines[index] ?? '');
        index += 1;
      }
      index += 1;
      const cls = language ? ` class="language-${language}"` : '';
      out.push(`<pre><code${cls}>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      const level = (heading[1] ?? '#').length + 1; // h1 is the page title.
      const capped = Math.min(level, 6);
      out.push(`<h${capped}>${inline(escapeHtml(heading[2] ?? ''))}</h${capped}>`);
      index += 1;
      continue;
    }

    const unordered = /^\s*[-*]\s+(.*)$/.exec(line);
    if (unordered) {
      if (listOpen !== 'ul') {
        closeList();
        out.push('<ul>');
        listOpen = 'ul';
      }
      out.push(`<li>${inline(escapeHtml(unordered[1] ?? ''))}</li>`);
      index += 1;
      continue;
    }

    const ordered = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (ordered) {
      if (listOpen !== 'ol') {
        closeList();
        out.push('<ol>');
        listOpen = 'ol';
      }
      out.push(`<li>${inline(escapeHtml(ordered[1] ?? ''))}</li>`);
      index += 1;
      continue;
    }

    if (line.trim() === '') {
      closeList();
      index += 1;
      continue;
    }

    // A paragraph runs until a blank line or a block-level construct.
    closeList();
    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index] ?? '';
      if (current.trim() === '' || /^(#{1,4}\s|```|\s*[-*]\s|\s*\d+\.\s)/.test(current)) break;
      paragraph.push(current.trim());
      index += 1;
    }
    out.push(`<p>${inline(escapeHtml(paragraph.join(' ')))}</p>`);
  }

  closeList();
  return out.join('\n');
}
