import OpenAI from 'openai';

// OpenAI client for embeddings (still using OpenAI SDK directly)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export interface Chunk {
  content: string;
  metadata?: {
    file_path: string;
    chunk_index: number;
  };
}

const CHUNK_SIZE = 1000; // characters
const CHUNK_OVERLAP = 200; // characters

export function chunkText(content: string, filePath: string): Chunk[] {
  const chunks: Chunk[] = [];
  
  // 빈 내용 처리
  if (!content || content.length === 0) {
    return chunks;
  }
  
  // 최대 청크 수 제한 (안전장치)
  const MAX_CHUNKS = 10000;
  let start = 0;
  let iterationCount = 0;

  while (start < content.length && chunks.length < MAX_CHUNKS) {
    iterationCount++;
    
    // 무한 루프 방지
    if (iterationCount > MAX_CHUNKS * 2) {
      console.error(`[CHUNK] Infinite loop detected in chunkText for ${filePath}, breaking`);
      break;
    }
    
    const end = Math.min(start + CHUNK_SIZE, content.length);
    const chunkContent = content.slice(start, end);
    
    // 빈 청크 방지
    if (chunkContent.length === 0) {
      break;
    }

    chunks.push({
      content: chunkContent,
      metadata: {
        file_path: filePath,
        chunk_index: chunks.length,
      },
    });

    // 다음 시작 위치 계산 (오버랩 고려)
    const nextStart = end - CHUNK_OVERLAP;
    
    // 진행이 없으면 루프 종료
    if (nextStart <= start) {
      // 오버랩이 청크 크기보다 크거나 같으면 1씩 증가
      start = start + 1;
    } else {
      start = nextStart;
    }
    
    // 마지막 청크 처리 후 종료
    if (end >= content.length) {
      break;
    }
  }

  return chunks;
}

export async function embedChunks(chunks: Chunk[]): Promise<number[][]> {
  const texts = chunks.map((chunk) => chunk.content);

  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: texts,
    dimensions: 1536,
  });

  return response.data.map((item) => item.embedding);
}

export async function embedText(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
    dimensions: 1536,
  });

  return response.data[0].embedding;
}

