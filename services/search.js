async function fetchBackendWebSearch(query, signal) {
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.results) ? data.results : [];
  } catch {
    return [];
  }
}

async function fetchWikipediaSearch(query, signal) {
  try {
    const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
      query
    )}&srlimit=4&format=json&origin=*`;
    const res = await fetch(url, { signal });
    if (!res.ok) return [];
    const data = await res.json();
    const items = data?.query?.search || [];
    return items.map((item) => ({
      title: item.title,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, '_'))}`,
      snippet: item.snippet
        .replace(/<[^>]+>/g, '')
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'"),
      source: 'Wikipedia',
    }));
  } catch {
    return [];
  }
}

async function fetchHackerNewsSearch(query, signal) {
  try {
    const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(
      query
    )}&hitsPerPage=3&tags=story`;
    const res = await fetch(url, { signal });
    if (!res.ok) return [];
    const data = await res.json();
    const hits = data?.hits || [];
    return hits
      .filter((h) => h.title && (h.url || h.objectID))
      .map((h) => ({
        title: h.title,
        url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
        snippet: h.story_text
          ? h.story_text.replace(/<[^>]+>/g, '').slice(0, 180)
          : `Hacker News · ${h.points ?? 0} points · ${h.num_comments ?? 0} comments`,
        source: 'Hacker News',
      }));
  } catch {
    return [];
  }
}

export async function performLiveSearch(query, signal) {
  const [webResults, wikiResults, hnResults] = await Promise.all([
    fetchBackendWebSearch(query, signal),
    fetchWikipediaSearch(query, signal),
    fetchHackerNewsSearch(query, signal),
  ]);

  const combined = [...webResults];
  const seenUrls = new Set(combined.map((r) => r.url));

  for (const item of [...wikiResults, ...hnResults]) {
    if (!seenUrls.has(item.url) && combined.length < 10) {
      seenUrls.add(item.url);
      combined.push(item);
    }
  }

  return combined;
}
