import type { Env } from "./env";

/**
 * 调 LLM chat completion。
 * 优先走 Vercel AI Gateway(统一账单),回退直连 OpenAI。
 */
export async function aiChatComplete(env: Env, system: string, user: string): Promise<string | null> {
  const useGateway = Boolean(env.AI_GATEWAY_API_KEY);
  const apiKey = useGateway ? env.AI_GATEWAY_API_KEY : env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const baseUrl = useGateway ? "https://ai-gateway.vercel.sh/v1" : "https://api.openai.com/v1";
  const model = useGateway ? "anthropic/claude-haiku-4-5" : "gpt-4o-mini";
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
      max_tokens: 800
    })
  });
  if (!response.ok) {
    throw new Error(`ai chat ${response.status}: ${await response.text()}`);
  }
  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return payload.choices?.[0]?.message?.content ?? null;
}

/**
 * Embedding(1536 维默认,匹配 schema 的 knowledge_chunks.embedding)。
 */
export async function embedText(env: Env, text: string): Promise<number[] | null> {
  const useGateway = Boolean(env.AI_GATEWAY_API_KEY);
  const apiKey = useGateway ? env.AI_GATEWAY_API_KEY : env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const baseUrl =
    env.EMBEDDING_PROVIDER_URL ||
    (useGateway ? "https://ai-gateway.vercel.sh/v1" : "https://api.openai.com/v1");
  const model =
    env.EMBEDDING_MODEL || (useGateway ? "openai/text-embedding-3-small" : "text-embedding-3-small");

  const response = await fetch(`${baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({ model, input: text })
  });
  if (!response.ok) {
    throw new Error(`embedding ${response.status}: ${await response.text()}`);
  }
  const payload = (await response.json()) as { data: Array<{ embedding: number[] }> };
  return payload.data[0]?.embedding ?? null;
}
