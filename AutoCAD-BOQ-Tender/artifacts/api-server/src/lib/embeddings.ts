import OpenAI from "openai";

// We keep embeddings independent of the chat-completion provider on purpose.
// Most OpenAI-compatible servers (Ollama, OpenRouter, Groq) don't expose
// embeddings, and where they do, the dimensions and quality vary so much that
// mixing them in one cosine space corrupts the index. So: OpenAI for
// embeddings if a key exists, else null → retrieval falls back to BM25 only.

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;

let cachedClient: OpenAI | null = null;
let warnedNoKey = false;

function getEmbeddingClient(): OpenAI | null {
  if (cachedClient) return cachedClient;
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    if (!warnedNoKey) {
      console.warn(
        "[embeddings] OPENAI_API_KEY not set — CAD retrieval will fall back to BM25 only."
      );
      warnedNoKey = true;
    }
    return null;
  }
  cachedClient = new OpenAI({ apiKey: key });
  return cachedClient;
}

export function isEmbeddingsEnabled(): boolean {
  return getEmbeddingClient() !== null;
}

const BATCH_SIZE = 96;
// How many embedding batches to send to the API at once. The OpenAI embeddings
// endpoint handles concurrent requests fine, and a big document (a 400-page
// tender → thousands of chunks → dozens of batches) was previously embedded
// strictly one batch at a time, so total latency = sum of every batch. Firing
// a few in parallel cuts that wall-clock by ~Nx. Env-tunable on the VPS.
function embedEnvInt(name: string, dflt: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : dflt;
}
const EMBED_CONCURRENCY = embedEnvInt("EMBED_CONCURRENCY", 5);

export async function embedTexts(texts: string[]): Promise<(number[] | null)[]> {
  if (texts.length === 0) return [];
  const client = getEmbeddingClient();
  if (!client) return texts.map(() => null);

  const out: (number[] | null)[] = new Array(texts.length).fill(null);

  // Build the list of batch start-offsets, then process them with bounded
  // concurrency (EMBED_CONCURRENCY in flight at once) instead of sequentially.
  const offsets: number[] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) offsets.push(i);

  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < offsets.length) {
      const i = offsets[cursor++];
      const batch = texts.slice(i, i + BATCH_SIZE);
      // Empty strings break the API; substitute a single space.
      const safe = batch.map(t => (t.trim().length > 0 ? t : " "));
      try {
        const res = await client!.embeddings.create({ model: EMBEDDING_MODEL, input: safe });
        for (let j = 0; j < res.data.length; j++) {
          out[i + j] = res.data[j].embedding as unknown as number[];
        }
      } catch (err) {
        // On batch failure, leave nulls — retrieval still works via BM25 for these.
        console.warn(`[embeddings] batch ${i} failed:`, err instanceof Error ? err.message : err);
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(EMBED_CONCURRENCY, offsets.length) }, () => worker()),
  );
  return out;
}

export async function embedQuery(text: string): Promise<number[] | null> {
  const [vec] = await embedTexts([text]);
  return vec;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
