import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParseModule = require('pdf-parse');
const pdfParse = (pdfParseModule.default || pdfParseModule) as (buf: Buffer) => Promise<{ text: string }>;

// ─── Types ────────────────────────────────────────────────────────────────────

interface KnowledgeChunk {
  text: string;
  source: string;
  /** Pre-tokenized lowercase words for fast scoring */
  words: Set<string>;
}

// ─── State ────────────────────────────────────────────────────────────────────

let chunks: KnowledgeChunk[] = [];
let loaded = false;

// ─── Loader ───────────────────────────────────────────────────────────────────

const KNOWLEDGE_DIR = join(process.cwd(), 'knowledge');
const CHUNK_SIZE = 600;    // chars per chunk
const CHUNK_OVERLAP = 100; // overlap between chunks to avoid cutting context

function splitIntoChunks(text: string, source: string): KnowledgeChunk[] {
  // Split by double newline (paragraphs), then re-join into ~CHUNK_SIZE blocks
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p.length > 30);
  const result: KnowledgeChunk[] = [];

  let current = '';
  for (const para of paragraphs) {
    if (current.length + para.length > CHUNK_SIZE && current.length > 0) {
      result.push(makeChunk(current.trim(), source));
      // Keep overlap from end of current chunk
      current = current.slice(-CHUNK_OVERLAP) + '\n' + para;
    } else {
      current = current ? current + '\n' + para : para;
    }
  }
  if (current.trim().length > 30) {
    result.push(makeChunk(current.trim(), source));
  }

  return result;
}

function makeChunk(text: string, source: string): KnowledgeChunk {
  const words = new Set(
    text
      .toLowerCase()
      .replace(/[^\wа-яёa-z\s]/gi, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3),
  );
  return { text, source, words };
}

async function loadPDF(filePath: string): Promise<string> {
  const buffer = readFileSync(filePath);
  const data = await pdfParse(buffer);
  return data.text;
}

export async function loadKnowledgeBase(): Promise<void> {
  if (loaded) return;

  let files: string[];
  try {
    files = readdirSync(KNOWLEDGE_DIR);
  } catch {
    console.warn('[Knowledge] knowledge/ folder not found, skipping');
    loaded = true;
    return;
  }

  const allChunks: KnowledgeChunk[] = [];

  for (const file of files) {
    const filePath = join(KNOWLEDGE_DIR, file);
    const source = file.replace(/\.(txt|pdf)$/i, '');

    try {
      let text = '';

      if (file.endsWith('.txt')) {
        text = readFileSync(filePath, 'utf-8');
      } else if (file.endsWith('.pdf')) {
        text = await loadPDF(filePath);
      } else {
        continue;
      }

      const fileChunks = splitIntoChunks(text, source);
      allChunks.push(...fileChunks);
      console.log(`[Knowledge] Loaded "${source}": ${fileChunks.length} chunks`);
    } catch (err) {
      console.error(`[Knowledge] Failed to load ${file}:`, err);
    }
  }

  chunks = allChunks;
  loaded = true;
  console.log(`[Knowledge] Total: ${chunks.length} chunks from ${files.length} files`);
}

// ─── Retrieval ────────────────────────────────────────────────────────────────

/**
 * Finds the most relevant knowledge chunks for a given query.
 * Uses keyword overlap scoring — no embeddings needed.
 */
export function findRelevantChunks(query: string, topK = 3): string {
  if (chunks.length === 0) return '';

  const queryWords = new Set(
    query
      .toLowerCase()
      .replace(/[^\wа-яёa-z\s]/gi, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3),
  );

  // Score each chunk by how many query words it contains
  const scored = chunks.map((chunk) => {
    let score = 0;
    for (const word of queryWords) {
      if (chunk.words.has(word)) score++;
    }
    return { chunk, score };
  });

  const top = scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  if (top.length === 0) return '';

  return (
    '=== БАЗА ЗНАНИЙ (релевантные фрагменты) ===\n' +
    top
      .map((s) => `[${s.chunk.source}]\n${s.chunk.text}`)
      .join('\n\n---\n\n')
  );
}
