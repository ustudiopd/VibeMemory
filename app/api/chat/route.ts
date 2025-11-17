import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { embedText } from '@/lib/rag';
import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { getSystemUserFromSupabase } from '@/lib/system-user';
import { normalizeModel, getModelOptions } from '@/lib/model-utils';

// Edge 런타임 + maxDuration 설정 (해결책.md 1장)
export const runtime = 'edge';
export const maxDuration = 60;

const MODEL = normalizeModel(process.env.CHATGPT_MODEL);

export async function POST(request: NextRequest) {
  try {
    // 시스템 사용자 확인
    const user = await getSystemUserFromSupabase();
    if (!user) {
      return new Response('시스템 사용자를 찾을 수 없습니다.', { status: 401 });
    }

    const { messages, projectId } = await request.json();

    if (!messages || messages.length === 0) {
      return new Response('Messages are required', { status: 400 });
    }

    const lastMessage = messages[messages.length - 1];
    const userMessage = lastMessage.content;

    // Embed user query
    const queryEmbedding = await embedText(userMessage);

    // Search RAG database
    const { data: searchResults, error: searchError } = await supabaseAdmin.rpc(
      'hybrid_search_rrf',
      {
        p_query_text: userMessage,
        p_query_embedding: queryEmbedding,
        p_project_id: projectId || null,
        p_limit: 10,
        p_memory_bank_weight: 1.2,
      }
    );

    if (searchError) {
      console.error('RAG search error:', searchError);
      return new Response('Search error', { status: 500 });
    }

    // Build context from search results
    const context = searchResults
      .map((result: any, index: number) => {
        return `[${index + 1}] 파일: ${result.file_path}\n내용: ${result.content}`;
      })
      .join('\n\n');

    // Create prompt
    const systemPrompt = `당신은 제공된 '컨텍스트'만을 기반으로 답변하는 AI 비서입니다.
- 컨텍스트에 답변이 없으면 "제공된 정보에 해당 내용이 없습니다."라고 말하십시오.
- 절대 당신의 사전 지식을 사용하지 마십시오.
- 제공된 '컨텍스트'를 인용하여 답변하십시오.`;

    // Build messages with context
    const messagesWithContext = [
      { role: 'system' as const, content: systemPrompt },
      ...messages.slice(0, -1), // Previous messages
      {
        role: 'user' as const,
        content: `컨텍스트:\n---\n${context}\n---\n\n질문: ${userMessage}\n답변:`,
      },
    ];

    // Stream response
    // GPT-4.1-mini는 일반 모델이므로 temperature, maxTokens 사용
    const modelOptions = getModelOptions(MODEL, 0.7, 2000);
    
    console.log('[CHAT] Calling OpenAI model with:', {
      model: MODEL,
      options: modelOptions,
    });

    const result = await streamText({
      model: openai(MODEL),
      messages: messagesWithContext,
      ...modelOptions, // temperature, maxTokens 사용
    });

    return result.toTextStreamResponse();
  } catch (error) {
    console.error('Chat error:', error);
    return new Response('Internal server error', { status: 500 });
  }
}

