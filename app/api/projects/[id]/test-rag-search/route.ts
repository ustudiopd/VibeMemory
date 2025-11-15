import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSystemUserFromSupabase } from '@/lib/system-user';
import { embedText } from '@/lib/rag';

/**
 * RAG 검색 테스트 API
 * 실제로 검색이 작동하는지 확인
 */
export async function GET(
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

    // 프로젝트 정보 조회
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

    // 테스트 쿼리들
    const testQueries = [
      {
        name: 'Idea Review Query',
        query: '프로젝트 목표 핵심 문제 타겟 사용자 기대 효과',
      },
      {
        name: 'Tech Review Query',
        query: '기술 스택 아키텍처 패턴 설계 원칙 시스템 구조',
      },
      {
        name: 'Korean Question - Project Overview',
        query: '이 프로젝트는 무엇을 하는 프로젝트인가요?',
      },
      {
        name: 'Korean Question - Main Features',
        query: 'EventLive 프로젝트의 주요 기능은 무엇인가요?',
      },
    ];

    const results = [];

    for (const testQuery of testQueries) {
      try {
        // 임베딩 생성
        const queryEmbedding = await embedText(testQuery.query);
        console.log(`[RAG TEST] Generated embedding for: ${testQuery.name}`);

        // RAG 검색 실행
        const { data: searchResults, error: searchError } = await supabaseAdmin.rpc(
          'hybrid_search_rrf',
          {
            p_query_text: testQuery.query,
            p_query_embedding: queryEmbedding,
            p_project_id: projectId,
            p_limit: 5,
            p_memory_bank_weight: 1.2,
          }
        );

        if (searchError) {
          results.push({
            query: testQuery.name,
            error: searchError.message,
            chunks_found: 0,
          });
        } else {
          results.push({
            query: testQuery.name,
            chunks_found: searchResults?.length || 0,
            chunks: searchResults?.slice(0, 3).map((chunk: any) => ({
              file_path: chunk.file_path,
              content_preview: chunk.content?.substring(0, 200) || '',
              rank_score: chunk.rank_score,
            })) || [],
          });
        }
      } catch (error) {
        results.push({
          query: testQuery.name,
          error: error instanceof Error ? error.message : 'Unknown error',
          chunks_found: 0,
        });
      }
    }

    // 청크 통계 확인
    const { data: chunksData, error: chunksError } = await supabaseAdmin
      .from('repo_file_chunks')
      .select('id, embedding, repo_file_id, repo_files!inner(project_id, path)', { count: 'exact', head: false })
      .eq('repo_files.project_id', projectId)
      .eq('is_current', true)
      .limit(10);

    const chunksWithEmbedding = chunksData?.filter((c: any) => c.embedding !== null).length || 0;
    const totalChunks = chunksData?.length || 0;

    return NextResponse.json({
      project: {
        id: project.id,
        repo_owner: project.repo_owner,
        repo_name: project.repo_name,
      },
      search_results: results,
      chunks_status: {
        total_chunks_sampled: totalChunks,
        chunks_with_embedding: chunksWithEmbedding,
        chunks_without_embedding: totalChunks - chunksWithEmbedding,
        sample_files: chunksData?.slice(0, 5).map((c: any) => ({
          path: c.repo_files?.path,
          has_embedding: c.embedding !== null,
        })) || [],
      },
    });
  } catch (error) {
    console.error('Error in GET /api/projects/[id]/test-rag-search:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

