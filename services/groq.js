export const GROQ_MODELS = [
  { id: 'llama-3.3-70b-versatile', label: 'llama-3.3-70b-versatile' },
  { id: 'llama-3.1-8b-instant', label: 'llama-3.1-8b-instant' },
  { id: 'openai/gpt-oss-120b', label: 'openai/gpt-oss-120b' },
  { id: 'qwen/qwen3-32b', label: 'qwen/qwen3-32b' },
  { id: 'meta-llama/llama-4-scout-17b-16e-instruct', label: 'llama-4-scout-17b' },
];

export async function streamGroqChat({
  apiKey,
  model,
  temperature,
  maxTokens,
  topP,
  systemPrompt,
  messages,
  sources = [],
  onToken,
  signal,
}) {
  let finalSystem = systemPrompt?.trim() || 'You are a helpful, friendly assistant. Be clear and accurate.';

  if (sources.length > 0) {
    const sourceBlock = sources
      .map((s, idx) => `[${idx + 1}] ${s.title} (${s.url})\n${s.snippet || ''}`)
      .join('\n\n');
    finalSystem += `\n\nUse these live web sources when relevant and cite them inline like [1], [2]:\n${sourceBlock}`;
  }

  const apiMessages = [
    { role: 'system', content: finalSystem },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey.trim()}`,
    },
    body: JSON.stringify({
      model,
      messages: apiMessages,
      temperature,
      max_tokens: maxTokens,
      top_p: topP,
      stream: true,
    }),
    signal,
  });

  if (!response.ok) {
    let errMsg = `Groq API error (${response.status})`;
    try {
      const errData = await response.json();
      if (errData?.error?.message) errMsg = errData.error.message;
    } catch {
      // ignore
    }
    throw new Error(errMsg);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let fullText = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') return fullText;
      try {
        const json = JSON.parse(payload);
        const delta = json.choices?.[0]?.delta?.content || '';
        if (delta) {
          fullText += delta;
          onToken(fullText);
        }
      } catch {
        // ignore partial chunks
      }
    }
  }

  return fullText;
}
