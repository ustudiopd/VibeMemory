import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { embedText } from '@/lib/rag';
import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { getSystemUserFromSupabase } from '@/lib/system-user';

const MODEL = process.env.CHATGPT_MODEL || 'gpt-5-mini';

/**
 * POST /api/projects/[id]/chat
 * SSE 스트리밍 채팅 API (fetchEventSource 방식)
 * 해결책.md 4.2장 참조
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 시스템 사용자 확인
    const user = await getSystemUserFromSupabase();
    if (!user) {
      return new Response('시스템 사용자를 찾을 수 없습니다.', { status: 401 });
    }

    const { id: projectId } = await params;
    const body = await request.json();
    const { sessionId, message } = body;

    if (!message || typeof message !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Message is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 프로젝트 소유 확인 및 project_type 확인
    const { data: project, error: projectError } = await supabaseAdmin
      .from('projects')
      .select('id, repo_owner, repo_name, project_type')
      .eq('owner_id', user.id)
      .eq('id', projectId)
      .single();

    if (projectError || !project) {
      return new Response(
        JSON.stringify({ error: 'Project not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 세션이 있으면 소유 확인
    let session = null;
    if (sessionId) {
      const { data: sessionData, error: sessionError } = await supabaseAdmin
        .from('chat_sessions')
        .select('id, project_id, owner_id')
        .eq('id', sessionId)
        .eq('project_id', projectId)
        .eq('owner_id', user.id)
        .single();

      if (sessionError || !sessionData) {
        return new Response(
          JSON.stringify({ error: 'Session not found' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }
      session = sessionData;
    }

    // 1. 쿼리 임베딩
    const queryEmbedding = await embedText(message);

    // 2. 프로젝트 범위 RRF 검색 (project_type에 따라 다른 RPC 함수 사용)
    console.log('[CHAT] Calling RAG search...', { project_type: project.project_type });
    
    let searchResults: any[] = [];
    let searchError: any = null;

    // project_type에 따라 다른 RPC 함수 호출
    if (project.project_type === 'idea') {
      // 아이디어 프로젝트: search_idea_project_chunks_rrf 사용
      const { data: ideaSearchResults, error: ideaSearchError } = await supabaseAdmin.rpc(
        'search_idea_project_chunks_rrf',
        {
          p_project_id: projectId,
          p_query_text: message,
          p_query_vec: queryEmbedding,
          p_limit: 8,
        }
      );

      if (ideaSearchError) {
        console.error('[CHAT] ❌ search_idea_project_chunks_rrf failed');
        console.error('[CHAT] Error object:', ideaSearchError);
        console.error('[CHAT] Error message:', ideaSearchError?.message);
        console.error('[CHAT] Error code:', ideaSearchError?.code);
        console.error('[CHAT] Error details:', ideaSearchError?.details);
        console.error('[CHAT] Error hint:', ideaSearchError?.hint);
        console.error('[CHAT] Full error JSON:', JSON.stringify(ideaSearchError, Object.getOwnPropertyNames(ideaSearchError), 2));
        console.error('[CHAT] Query params:', {
          p_project_id: projectId,
          p_query_text: message,
          p_query_vec_length: queryEmbedding?.length,
          p_limit: 8,
        });
        searchError = ideaSearchError;
      } else {
        searchResults = ideaSearchResults || [];
        console.log('[CHAT] ✅ RPC function returned:', searchResults?.length || 0, 'results');
      }
    } else {
      // GitHub 프로젝트: search_project_chunks_rrf 사용
      const { data: projectSearchResults, error: projectSearchError } = await supabaseAdmin.rpc(
        'search_project_chunks_rrf',
        {
          p_project_id: projectId,
          p_query_text: message,
          p_query_vec: queryEmbedding,
          p_limit: 8,
        }
      );

      if (projectSearchError) {
        console.warn('[CHAT] search_project_chunks_rrf failed, falling back to hybrid_search_rrf:', projectSearchError);
        // 폴백: 기존 hybrid_search_rrf 사용
        const { data: hybridResults, error: hybridError } = await supabaseAdmin.rpc(
          'hybrid_search_rrf',
          {
            p_query_text: message,
            p_query_embedding: queryEmbedding,
            p_project_id: projectId,
            p_limit: 8,
            p_memory_bank_weight: 1.2,
          }
        );

        if (hybridError) {
          console.error('[CHAT] hybrid_search_rrf also failed:', hybridError);
          searchError = hybridError;
        } else {
          // hybrid_search_rrf 결과를 search_project_chunks_rrf 형식으로 변환
          searchResults = (hybridResults || []).map((r: any) => ({
            chunk_id: r.id,
            file_path: r.file_path,
            content: r.content,
            rrf_score: r.rank_score || 0,
          }));
        }
      } else {
        searchResults = projectSearchResults || [];
      }
    }

    console.log('[CHAT] Search results:', {
      hasResults: !!searchResults,
      resultCount: searchResults?.length || 0,
      hasError: !!searchError,
      projectType: project.project_type,
    });
    
    if (searchResults && searchResults.length > 0) {
      console.log('[CHAT] ✅ Found chunks from files:', searchResults.map((r: any) => r.file_path).join(', '));
    } else {
      console.warn('[CHAT] ⚠️ No chunks found. Make sure files are uploaded and processed.');
    }

    // 3. 컨텍스트 빌드
    const context = (searchResults || [])
      .map((result: any, index: number) => {
        return `[${index + 1}] 파일: ${result.file_path || 'unknown'}\n내용: ${result.content}`;
      })
      .join('\n\n');

    // 출처 정보 준비 (sources 이벤트용)
    const sources = (searchResults || []).map((result: any) => ({
      file_path: result.file_path,
      score: result.rrf_score,
      chunk_id: result.chunk_id,
    }));

    // 4. 프롬프트 구성 (해결책.md 5장 참조)
    // project_type에 따라 다른 시스템 프롬프트 사용
    const systemPrompt = project.project_type === 'idea'
      ? `당신은 사용자의 아이디어를 구체적인 명세서로 만들어주는 프로덕트 매니저입니다. 역으로 질문하고 기능을 구체화하도록 유도하세요.

**역할:**
- 사용자의 아이디어를 듣고 구체적인 기능 요구사항으로 발전시킵니다
- 불명확한 부분에 대해 질문하여 명확히 합니다
- 기술적 구현보다는 사용자 경험과 기능 요구사항에 집중합니다

**답변 작성 규칙:**
1. 제공된 컨텍스트(업로드된 파일, 이전 대화)를 기반으로 답변하세요
2. 답변은 마크다운 형식으로 작성하세요
3. 자연스러운 한국어 문장으로 작성하세요
4. 사용자의 아이디어를 발전시키기 위해 질문을 던지세요
5. 기능을 구체화하고 우선순위를 제안하세요

**컨텍스트:**
${context || '(아직 업로드된 파일이 없습니다. 사용자와 대화를 통해 아이디어를 발전시켜주세요.)'}`
      : `너는 프로젝트 문서(.md) 기반의 전문적인 기술 문서 분석가다.

**절대 금지 사항 (매우 중요):**
- 단어나 문장을 따옴표(")로 감싸는 것 - 절대로 하지 말라
- 모든 단어 사이에 따옴표를 넣는 것 - 절대로 하지 말라
- JSON 형식으로 답변하는 것
- 불필요한 특수문자나 이스케이프 문자 사용

**답변 작성 규칙:**
1. 제공된 컨텍스트만을 기반으로 답변하라.
2. 답변은 반드시 마크다운 형식으로 작성하라. 일반 텍스트가 아닌 마크다운 문법을 사용하라.
3. 자연스러운 한국어 문장으로 작성하라. 따옴표를 사용하지 말라.
4. 마크다운 형식을 적극 활용하라:
   - 제목: # ## ### (섹션 구분 시 사용)
   - 리스트: - 또는 1. 2. 3. (항목 나열 시 사용)
   - 강조: **굵게** 또는 *기울임* (중요 내용 강조)
   - 코드: \`인라인 코드\` 또는 \`\`\`언어\n코드\n\`\`\` (코드 블록)
   - 링크: [텍스트](URL) (참고 링크)
5. 기술 용어와 코드는 원문 그대로 유지하라.
6. 답변 하단에 참고한 파일 경로를 간단히 표시하라.

**올바른 예시:**
EventLive.ai는 B2B2C 멀티테넌시 구조의 인터랙티브 웨비나 SaaS 플랫폼입니다.

**잘못된 예시 (절대 사용하지 말 것):**
"EventLive.ai"는 "B2B2C" "멀티테넌시" "구조"의...`;

    const userPrompt = context.length > 0
      ? `다음은 프로젝트 문서에서 검색된 관련 컨텍스트입니다:

---
${context}
---

위 컨텍스트를 바탕으로 다음 질문에 답변해주세요.

질문: ${message}

**중요 지침:**
- 답변은 일반 텍스트로 작성하라. 절대로 단어나 문장을 따옴표로 감싸지 말라.
- 마크다운 형식(#, -, **)을 사용하여 구조화하라.
- 자연스러운 한국어 문장으로 작성하라.
- 답변 마지막에 참고한 파일 경로를 간단히 표시하라.`
      : `다음 질문에 답변해주세요. 단, 제공된 프로젝트 문서에 해당 정보가 없을 수 있습니다.

질문: ${message}

**중요:** 답변은 일반 텍스트로 작성하고, 절대로 단어나 문장을 따옴표로 감싸지 말라.`;

    // 기존 메시지 가져오기 (세션이 있는 경우)
    let previousMessages: any[] = [];
    if (session) {
      const { data: messages } = await supabaseAdmin
        .from('chat_messages')
        .select('role, content')
        .eq('session_id', session.id)
        .order('created_at', { ascending: true })
        .limit(20); // 최근 20개 메시지만

      previousMessages = (messages || []).map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));
    }

    // 5. LLM 스트리밍 호출
    console.log('[CHAT] Calling GPT-5-mini with:', {
      model: MODEL,
      systemPromptLength: systemPrompt.length,
      userPromptLength: userPrompt.length,
      previousMessagesCount: previousMessages.length,
      totalMessagesCount: previousMessages.length + 2,
    });

    const result = await streamText({
      model: openai(MODEL),
      messages: [
        { role: 'system', content: systemPrompt },
        ...previousMessages,
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
    });

    console.log('[CHAT] StreamText result created, starting to read stream...');

    // 6. SSE 스트림 생성
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let fullContent = '';
        let tokensInput = 0;
        let tokensOutput = 0;

        try {
          // 첫 토큰 직후 sources 이벤트 발행
          let sourcesSent = false;

          let chunkCount = 0;
          for await (const chunk of result.textStream) {
            chunkCount++;
            if (chunkCount === 1) {
              console.log('[CHAT] First chunk received, length:', chunk?.length || 0);
            }

            if (!sourcesSent && chunk) {
              // sources 이벤트 발행
              const sourcesEvent = `event: sources\ndata: ${JSON.stringify(sources)}\n\n`;
              controller.enqueue(encoder.encode(sourcesEvent));
              sourcesSent = true;
            }

            // token 이벤트 발행
            if (chunk) {
              fullContent += chunk;
              tokensOutput += chunk.length / 4; // 대략적인 토큰 수 추정
              // 줄바꿈을 보존한 채로 "하나의 이벤트"에 실어 보낸다
              // JSON.stringify를 사용하여 줄바꿈(\n)이 유지되도록 함
              const tokenEvent = `event: token\ndata: ${JSON.stringify(chunk)}\n\n`;
              controller.enqueue(encoder.encode(tokenEvent));
            }
          }

          console.log('[CHAT] Stream completed. Total chunks:', chunkCount, 'Content length:', fullContent.length);

          // GPT-5-mini 빈 응답 체크
          if (!fullContent || fullContent.trim().length === 0) {
            console.error('[CHAT] ⚠️ Empty response from GPT-5-mini. No content generated.');
            const errorEvent = `event: error\ndata: ${JSON.stringify({ 
              error: 'AI가 응답을 생성하지 못했습니다. 잠시 후 다시 시도해주세요.',
              details: 'GPT-5-mini에서 출력이 생성되지 않았습니다.'
            })}\n\n`;
            controller.enqueue(encoder.encode(errorEvent));
          }

          // done 이벤트 발행
          const doneEvent = `event: done\ndata: {}\n\n`;
          controller.enqueue(encoder.encode(doneEvent));

          // 7. DB에 메시지 저장
          if (session) {
            // 사용자 메시지 저장
            await supabaseAdmin.from('chat_messages').insert({
              session_id: session.id,
              role: 'user',
              content: message,
              model: MODEL,
            });

            // Assistant 메시지 저장 (usage는 스트림 완료 후에만 사용 가능)
            // GPT-5-mini의 경우 빈 응답 시 usage를 가져올 수 없으므로 선택적으로 처리
            try {
              // 스트림이 완료된 후 usage 가져오기 시도
              const usage = await result.usage;
              // AI SDK v2의 LanguageModelV2Usage 타입에 맞게 속성 접근
              tokensInput = (usage as any)?.promptTokens || 0;
              tokensOutput = (usage as any)?.completionTokens || Math.ceil(tokensOutput);
            } catch (error) {
              // AI_NoOutputGeneratedError는 GPT-5-mini가 응답을 생성하지 않았을 때 발생
              if (error instanceof Error && error.message.includes('No output generated')) {
                console.warn('[CHAT] GPT-5-mini did not generate output. Using estimated tokens.');
                // 빈 응답이면 토큰 수를 0으로 설정
                if (!fullContent || fullContent.trim().length === 0) {
                  tokensInput = 0;
                  tokensOutput = 0;
                }
              } else {
                console.error('[CHAT] Error getting usage:', error);
              }
              // usage를 가져오지 못해도 계속 진행 (추정값 사용)
            }

            // Assistant 메시지 저장
            const { data: assistantMessage, error: messageError } = await supabaseAdmin
              .from('chat_messages')
              .insert({
                session_id: session.id,
                role: 'assistant',
                content: fullContent,
                model: MODEL,
                tokens_input: tokensInput,
                tokens_output: tokensOutput,
                // sources jsonb 필드는 제거 (Citations 테이블 사용)
              })
              .select()
              .single();

            if (messageError) {
              console.error('[CHAT] Error saving assistant message:', messageError);
            }

            // Citations 테이블에 저장
            if (assistantMessage && sources && sources.length > 0) {
              // 아이디어 프로젝트의 경우 chunk_id는 idea_project_chunks를 참조하므로
              // repo_file_chunks를 참조하는 chat_message_citations에는 null로 설정
              const citations = sources.map((source: any) => ({
                message_id: assistantMessage.id,
                project_id: projectId,
                file_path: source.file_path || '',
                // GitHub 프로젝트만 chunk_id 저장, 아이디어 프로젝트는 null
                chunk_id: project.project_type === 'github' ? (source.chunk_id || null) : null,
                score: source.score || null,
              }));

              const { error: citationsError } = await supabaseAdmin
                .from('chat_message_citations')
                .insert(citations);

              if (citationsError) {
                console.error('[CHAT] Error saving citations:', citationsError);
              }
            }

            // 세션 업데이트 시간 갱신
            await supabaseAdmin
              .from('chat_sessions')
              .update({ updated_at: new Date().toISOString() })
              .eq('id', session.id);
          }
        } catch (error) {
          console.error('[CHAT] Stream error:', error);
          try {
            // 컨트롤러가 이미 닫혔는지 확인
            const errorEvent = `event: error\ndata: ${JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' })}\n\n`;
            controller.enqueue(encoder.encode(errorEvent));
          } catch (enqueueError) {
            // 컨트롤러가 이미 닫혔으면 무시
            console.error('[CHAT] Error enqueueing error event (controller may be closed):', enqueueError);
          }
        } finally {
          try {
            controller.close();
          } catch (closeError) {
            // 컨트롤러가 이미 닫혔으면 무시
            console.error('[CHAT] Error closing controller (may already be closed):', closeError);
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('[CHAT] Error:', error);
    // 에러 발생 시에도 SSE 스트림으로 에러 전송 (fetchEventSource가 기대하는 형식)
    const encoder = new TextEncoder();
    const errorStream = new ReadableStream({
      start(controller) {
        const errorEvent = `event: error\ndata: ${JSON.stringify({ 
          error: '챗봇 처리 중 오류가 발생했습니다.',
          details: error instanceof Error ? error.message : 'Unknown error'
        })}\n\n`;
        controller.enqueue(encoder.encode(errorEvent));
        controller.close();
      },
    });

    return new Response(errorStream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  }
}
