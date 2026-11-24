export function escapeHtml(str = '') {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInlineHtml(text, sources = []) {
  const escaped = escapeHtml(text);
  return escaped
    .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[(\d+)\]/g, (_, numStr) => {
      const num = parseInt(numStr, 10);
      const src = sources[num - 1];
      if (!src) return `[${num}]`;
      return `<a href="${escapeHtml(src.url)}" target="_blank" rel="noopener noreferrer" class="citation-pill" title="${escapeHtml(src.title)}">${num}</a>`;
    });
}

export function renderMarkdownToHtml(content, sources = []) {
  if (!content) return '';
  const lines = content.split('\n');
  const html = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim().startsWith('```')) {
      const lang = line.trim().slice(3).trim();
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      html.push(
        `<pre class="code-block">${
          lang ? `<span class="code-lang">${escapeHtml(lang)}</span>` : ''
        }<code>${escapeHtml(codeLines.join('\n'))}</code></pre>`
      );
      i++;
      continue;
    }

    if (line.startsWith('### ')) {
      html.push(`<h4>${renderInlineHtml(line.slice(4), sources)}</h4>`);
      i++;
      continue;
    }
    if (line.startsWith('## ')) {
      html.push(`<h3>${renderInlineHtml(line.slice(3), sources)}</h3>`);
      i++;
      continue;
    }
    if (line.startsWith('# ')) {
      html.push(`<h2>${renderInlineHtml(line.slice(2), sources)}</h2>`);
      i++;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(`<li>${renderInlineHtml(lines[i].replace(/^\s*[-*]\s+/, ''), sources)}</li>`);
        i++;
      }
      html.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(`<li>${renderInlineHtml(lines[i].replace(/^\s*\d+\.\s+/, ''), sources)}</li>`);
        i++;
      }
      html.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    if (!line.trim()) {
      i++;
      continue;
    }

    const para = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].startsWith('#') &&
      !lines[i].trim().startsWith('```') &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    html.push(`<p>${renderInlineHtml(para.join(' '), sources)}</p>`);
  }

  return `<div class="markdown-body">${html.join('')}</div>`;
}
