export default async function handler(req, res) {
  const q = (req.query?.q || '').toString().trim();
  if (!q) {
    return res.status(400).json({ error: 'Missing query' });
  }

  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      },
    });
    if (!response.ok) {
      return res.status(502).json({ error: 'Upstream search failed', results: [] });
    }
    const html = await response.text();
    const results = [];
    const blockRegex =
      /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>)?/g;
    let match;
    while ((match = blockRegex.exec(html)) !== null && results.length < 8) {
      let href = match[1];
      const uddgMatch = href.match(/uddg=([^&]+)/);
      if (uddgMatch) {
        href = decodeURIComponent(uddgMatch[1]);
      }
      const title = match[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      const snippet = (match[3] || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      if (title && href.startsWith('http')) {
        results.push({ title, url: href, snippet, source: 'Web' });
      }
    }
    return res.status(200).json({ results });
  } catch (err) {
    return res.status(500).json({ error: err.message, results: [] });
  }
}
