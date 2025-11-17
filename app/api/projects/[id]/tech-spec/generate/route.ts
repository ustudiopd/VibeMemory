import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { embedText } from '@/lib/rag';
import { openai } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { getSystemUserFromSupabase } from '@/lib/system-user';
import { normalizeModel, getModelOptions } from '@/lib/model-utils';

// Node.js 런타임 사용 (긴 처리 시간 필요 - RAG 검색 + GPT 호출)
// Edge 런타임은 60초 제한이 있어 타임아웃 발생 가능
export const runtime = 'nodejs';
export const maxDuration = 300; // 5분 (Pro 플랜 기준)

const MODEL = normalizeModel(process.env.CHATGPT_MODEL);

/**
 * POST /api/projects/[id]/tech-spec/generate
 * 기술 리뷰를 기반으로 RAG 검색을 수행하고 GPT API로 기술 스펙을 정리
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 시스템 사용자 확인
    const user = await getSystemUserFromSupabase();
    if (!user) {
      return NextResponse.json(
        { error: '시스템 사용자를 찾을 수 없습니다.' },
        { status: 401 }
      );
    }

    const { id: projectId } = await params;

    // 프로젝트 소유 확인
    const { data: project, error: projectError } = await supabaseAdmin
      .from('projects')
      .select('id, repo_owner, repo_name')
      .eq('owner_id', user.id)
      .eq('id', projectId)
      .single();

    if (projectError || !project) {
      return NextResponse.json(
        { error: '프로젝트를 찾을 수 없습니다.' },
        { status: 404 }
      );
    }

    // 기술 리뷰 가져오기
    const { data: analysis, error: analysisError } = await supabaseAdmin
      .from('project_analysis')
      .select('tech_review')
      .eq('project_id', projectId)
      .single();

    if (analysisError || !analysis?.tech_review) {
      return NextResponse.json(
        { error: '기술 리뷰가 아직 생성되지 않았습니다.' },
        { status: 404 }
      );
    }

    const techReview = analysis.tech_review;

    // RAG 검색을 위한 쿼리 생성
    const searchQuery = `${techReview}\n\n기술 스택, 프레임워크, 라이브러리, 의존성, 패키지, 도구`;
    
    // 쿼리 임베딩 생성
    const queryEmbedding = await embedText(searchQuery);

    // RAG 검색 수행
    let searchResults: any[] = [];
    
    // 먼저 search_project_chunks_rrf 시도
    const { data: projectSearchResults, error: projectSearchError } = await supabaseAdmin.rpc(
      'search_project_chunks_rrf',
      {
        p_project_id: projectId,
        p_query_text: searchQuery,
        p_query_vec: queryEmbedding,
        p_limit: 15,
      }
    );

    if (projectSearchError) {
      console.warn('[TECH-SPEC] search_project_chunks_rrf failed, falling back to hybrid_search_rrf:', projectSearchError);
      // 폴백: 기존 hybrid_search_rrf 사용
      const { data: hybridResults, error: hybridError } = await supabaseAdmin.rpc(
        'hybrid_search_rrf',
        {
          p_query_text: searchQuery,
          p_query_embedding: queryEmbedding,
          p_project_id: projectId,
          p_limit: 15,
          p_memory_bank_weight: 1.2,
        }
      );

      if (hybridError) {
        console.error('[TECH-SPEC] hybrid_search_rrf also failed:', hybridError);
        // RAG 검색 실패해도 기술 리뷰만으로 진행
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

    // RAG 검색 결과를 컨텍스트로 구성
    const ragContext = searchResults
      .slice(0, 10) // 상위 10개만 사용
      .map((result: any, index: number) => {
        return `[${index + 1}] 파일: ${result.file_path}\n내용: ${result.content.substring(0, 500)}`;
      })
      .join('\n\n');

    // GPT API로 기술 스펙 정리
    console.log('[TECH-SPEC] Starting GPT generation...', {
      model: MODEL,
      techReviewLength: techReview.length,
      ragContextLength: ragContext.length,
    });

    const systemPrompt = `당신은 프로젝트의 기술 스펙을 구조화하여 정리하는 전문가입니다.
제공된 기술 리뷰와 코드베이스 검색 결과를 기반으로 프로젝트의 기술 스펙을 명확하고 체계적으로 정리해주세요.

다음 형식으로 마크다운으로 작성해주세요:
- 프레임워크/라이브러리
- 언어/런타임
- 데이터베이스
- 인프라/배포
- 기타 도구

각 항목은 구체적인 버전 정보와 함께 나열해주세요.`;

    // 프롬프트 길이 제한 (타임아웃 방지)
    const maxTechReviewLength = 3000; // 기술 리뷰 최대 길이
    const truncatedTechReview = techReview.length > maxTechReviewLength
      ? techReview.substring(0, maxTechReviewLength) + '\n\n... (내용이 길어 일부만 포함되었습니다)'
      : techReview;

    const userPrompt = `다음 기술 리뷰와 코드베이스 검색 결과를 기반으로 기술 스펙을 정리해주세요.

[기술 리뷰]
${truncatedTechReview}

${ragContext ? `[코드베이스 검색 결과]\n${ragContext}` : ''}

위 정보를 바탕으로 프로젝트의 기술 스펙을 구조화하여 정리해주세요.`;

    // Reasoning 모델 분기 처리 (해결책.md 2장)
    const modelOptions = getModelOptions(MODEL, 0.3);
    
    console.log('[TECH-SPEC] Calling generateText with options:', modelOptions);
    
    const { text: techSpec } = await generateText({
      model: openai(MODEL),
      system: systemPrompt,
      prompt: userPrompt,
      ...modelOptions, // Reasoning 모델이면 옵션 없음 (일반 모델이면 temperature: 0.3)
    });

    console.log('[TECH-SPEC] GPT generation completed, length:', techSpec?.length || 0);

    // 빈 응답 체크
    if (!techSpec || techSpec.trim().length === 0) {
      console.error('[TECH-SPEC] ⚠️ Empty response from GPT-5-mini.');
      return NextResponse.json(
        {
          error: 'AI 응답이 비어있습니다. 잠시 후 다시 시도해주세요.',
          details: 'GPT-5-mini에서 응답을 생성하지 못했습니다.',
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      tech_spec: techSpec,
    });
  } catch (error) {
    console.error('[TECH-SPEC] Error generating tech spec:', error);
    return NextResponse.json(
      {
        error: '기술 스펙 생성에 실패했습니다.',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

