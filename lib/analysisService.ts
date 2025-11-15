import OpenAI from 'openai';
import { supabaseAdmin } from './supabase';
import { embedText } from './rag';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MODEL = process.env.CHATGPT_MODEL || 'gpt-4.1-mini';

async function updateScanProgress(
  runId: string,
  projectId: string,
  reviewDone: number
) {
  const { data: existing } = await supabaseAdmin
    .from('scan_progress')
    .select('id')
    .eq('run_id', runId)
    .eq('project_id', projectId)
    .single();

  if (existing) {
    await supabaseAdmin
      .from('scan_progress')
      .update({
        review_done: reviewDone,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
  }
}

export async function analyzeProject(
  projectId: string,
  accessToken: string,
  repoOwner: string,
  repoName: string,
  runId?: string
) {
  try {
    // Module 1: Idea Review - RAG 검색으로 관련 청크 가져오기
    const ideaQuery = '프로젝트 목표 핵심 문제 타겟 사용자 기대 효과';
    const ideaQueryEmbedding = await embedText(ideaQuery);
    
    const { data: ideaChunks, error: ideaSearchError } = await supabaseAdmin.rpc(
      'hybrid_search_rrf',
      {
        p_query_text: ideaQuery,
        p_query_embedding: ideaQueryEmbedding,
        p_project_id: projectId,
        p_limit: 15, // 메모리뱅크 우선순위 적용 (가중치 1.2)
        p_memory_bank_weight: 1.2,
      }
    );

    if (ideaSearchError) {
      console.error('[ANALYSIS] Error searching for idea review chunks:', ideaSearchError);
      throw new Error(`RAG search failed for idea review: ${ideaSearchError.message}`);
    }

    console.log(`[ANALYSIS] Idea review search found ${ideaChunks?.length || 0} chunks`);
    
    const ideaContext = ideaChunks && ideaChunks.length > 0
      ? ideaChunks.map((chunk: any, index: number) => `[${index + 1}] 파일: ${chunk.file_path}\n내용: ${chunk.content}`).join('\n\n')
      : '';
    
    if (!ideaContext) {
      console.warn('[ANALYSIS] No chunks found for idea review query');
    }

    const ideaReview = await generateIdeaReview(ideaContext);

    if (runId) {
      await updateScanProgress(runId, projectId, 1);
    }

    // Module 2: Tech Review - RAG 검색으로 관련 청크 가져오기
    const techQuery = '기술 스택 아키텍처 패턴 설계 원칙 시스템 구조';
    const techQueryEmbedding = await embedText(techQuery);
    
    const { data: techChunks, error: techSearchError } = await supabaseAdmin.rpc(
      'hybrid_search_rrf',
      {
        p_query_text: techQuery,
        p_query_embedding: techQueryEmbedding,
        p_project_id: projectId,
        p_limit: 15, // 메모리뱅크 우선순위 적용
        p_memory_bank_weight: 1.2,
      }
    );

    if (techSearchError) {
      console.error('[ANALYSIS] Error searching for tech review chunks:', techSearchError);
      throw new Error(`RAG search failed for tech review: ${techSearchError.message}`);
    }

    console.log(`[ANALYSIS] Tech review search found ${techChunks?.length || 0} chunks`);
    
    const techContext = techChunks && techChunks.length > 0
      ? techChunks.map((chunk: any, index: number) => `[${index + 1}] 파일: ${chunk.file_path}\n내용: ${chunk.content}`).join('\n\n')
      : '';
    
    if (!techContext) {
      console.warn('[ANALYSIS] No chunks found for tech review query');
    }

    const techReview = await generateTechReview(techContext);

    if (runId) {
      await updateScanProgress(runId, projectId, 2);
    }

    // Module 3: Patent Analysis - 아이디어와 기술 리뷰 결과를 기반으로 검색
    const patentQuery = `${ideaReview.substring(0, 200)} ${techReview.substring(0, 200)} 독창적인 기술 발명 아이디어 혁신`;
    const patentQueryEmbedding = await embedText(patentQuery);
    
    const { data: patentChunks, error: patentSearchError } = await supabaseAdmin.rpc(
      'hybrid_search_rrf',
      {
        p_query_text: patentQuery,
        p_query_embedding: patentQueryEmbedding,
        p_project_id: projectId,
        p_limit: 10,
        p_memory_bank_weight: 1.2,
      }
    );

    if (patentSearchError) {
      console.error('[ANALYSIS] Error searching for patent review chunks:', patentSearchError);
      // Patent search error는 치명적이지 않으므로 경고만
      console.warn('[ANALYSIS] Patent search failed, continuing with empty context');
    }

    console.log(`[ANALYSIS] Patent review search found ${patentChunks?.length || 0} chunks`);
    
    const patentContext = patentChunks && patentChunks.length > 0
      ? patentChunks.map((chunk: any, index: number) => `[${index + 1}] 파일: ${chunk.file_path}\n내용: ${chunk.content}`).join('\n\n')
      : '';

    const patentReview = await generatePatentReview(ideaReview, techReview, patentContext);

    if (runId) {
      await updateScanProgress(runId, projectId, 3);
    }

    // Module 4: Project Overview - 프로젝트 개요 생성
    const overviewQuery = '프로젝트 개요 아키텍처 기술 스택 개발 현황 완료된 기능 예정 작업';
    const overviewQueryEmbedding = await embedText(overviewQuery);
    
    const { data: overviewChunks, error: overviewSearchError } = await supabaseAdmin.rpc(
      'hybrid_search_rrf',
      {
        p_query_text: overviewQuery,
        p_query_embedding: overviewQueryEmbedding,
        p_project_id: projectId,
        p_limit: 10,
        p_memory_bank_weight: 1.5, // memory_bank 파일에 더 높은 가중치
      }
    );

    let projectOverview = '';
    if (!overviewSearchError && overviewChunks && overviewChunks.length > 0) {
      const overviewContext = overviewChunks.map((chunk: any, index: number) => 
        `[${index + 1}] 파일: ${chunk.file_path}\n내용: ${chunk.content}`
      ).join('\n\n');
      
      try {
        projectOverview = await generateProjectSummary(overviewContext);
      } catch (error) {
        console.error('[ANALYSIS] Error generating project overview:', error);
        projectOverview = `${repoName}는 ${repoOwner}에서 개발 중인 프로젝트입니다.`;
      }
    } else {
      projectOverview = `${repoName}는 ${repoOwner}에서 개발 중인 프로젝트입니다.`;
    }

    // Update project_analysis table
    // 직접 upsert 사용 (트리거 대신)
    const { error: upsertError } = await supabaseAdmin
      .from('project_analysis')
      .upsert({
        project_id: projectId,
        idea_review: ideaReview,
        tech_review: techReview,
        patent_review: patentReview,
        project_overview: projectOverview,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'project_id',
      });

    if (upsertError) {
      console.error(`Error upserting project_analysis for project ${projectId}:`, upsertError);
      throw new Error(`Failed to save project analysis: ${upsertError.message}`);
    }

    console.log(`AI analysis completed for project ${projectId}`);
  } catch (error) {
    console.error(`Error analyzing project ${projectId}:`, error);
    throw error;
  }
}

async function generateIdeaReview(context: string): Promise<string> {
  const prompt = `**역할:** Business Analyst
**지시:** RAG 검색을 통해 제공된 '프로젝트 문서 컨텍스트'를 분석하여, 다음 세 가지 섹션을 명확하게 분리하여 작성하십시오. 모든 답변은 제공된 컨텍스트에만 기반해야 합니다.

1.  **핵심 문제 (Problem):** 이 프로젝트가 해결하려는 근본적인 비즈니스 또는 기술적 문제.
2.  **최종 목표 (Goal):** 문제가 해결되었을 때 달성되는 이상적인 상태.
3.  **타겟 사용자 (User):** 정의된 각 사용자 페르소나와 그들의 핵심 역할.

**프로젝트 문서 컨텍스트 (RAG 검색 결과):**
---
${context || '(관련 문서를 찾을 수 없습니다)'}
---`;

  const response = await openai.chat.completions.create({
    model: MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
  });

  return response.choices[0].message.content || '';
}

async function generateTechReview(context: string): Promise<string> {
  const prompt = `**역할:** Principal Architect
**지시:** RAG 검색을 통해 제공된 '기술 문서 컨텍스트'를 종합하여, 이 프로젝트에서 다른 프로젝트가 참고할 만한 **독창적이고 재사용 가능한 핵심 기술 패턴 3가지**를 식별하십시오.
- **(중요) 제외 항목:** 'Next.js 15 사용' 또는 'Tailwind 사용' 같은 단순한 기술 스택 나열을 절대 금지합니다.
- **(필수) 구조:** 각 패턴에 대해 다음 3단계를 명확히 기술하십시오.
    1.  **패턴명:** (예: RLS + Admin 하이브리드 권한 패턴)
    2.  **문제 (Problem):** 이 패턴이 해결하려 했던 구체적인 문제 상황.
    3.  **해결 (Solution):** 문제를 해결한 구체적인 구현 방식.

**기술 문서 컨텍스트 (RAG 검색 결과):**
---

${context || '(관련 기술 문서를 찾을 수 없습니다)'}
---`;

  const response = await openai.chat.completions.create({
    model: MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
  });

  return response.choices[0].message.content || '';
}

async function generatePatentReview(
  ideaReview: string,
  techReview: string,
  context: string
): Promise<string> {
  const prompt = `**역할:** Software Patent Attorney
**지시:** 제공된 '아이디어 리뷰' (비즈니스 모델)와 '기술 리뷰' (기술 구현)의 **교집합**을 찾으십시오. 비즈니스 요구사항을 충족하기 위해 사용된 **독창적인(non-obvious) 기술적 해결책** 2가지를 제안하십시오.

**(필수) 구조:** 각 특허 아이디어에 대해 다음 3단계를 명확히 기술하십시오.
    1.  **아이디어 명칭:** (예: "계층형 멀티테넌시 환경의 하이브리드 데이터 접근 제어 시스템")
    2.  **핵심 개념:** 비즈니스 문제와 기술적 해결책을 엮어 설명.
    3.  **특허화 포인트 (Novelty):** 이 기술이 기존의 단순한 방식과 차별화되는 독창적인 지점.

**[입력 1: 아이디어 리뷰]**
---
${ideaReview}
---

**[입력 2: 기술 리뷰]**
---
${techReview}
---

**[입력 3: 추가 RAG 컨텍스트]**
---
${context || '(추가 컨텍스트를 찾을 수 없습니다)'}
---`;

  const response = await openai.chat.completions.create({
    model: MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
  });

  return response.choices[0].message.content || '';
}

export async function generateProjectSummary(context: string): Promise<string> {
  const prompt = `**역할:** Lead Analyst

**지시:** RAG 검색을 통해 제공된 '프로젝트 문서 컨텍스트'를 종합하여 프로젝트를 요약하는 **두 개의 문단**을 작성하십시오. 모든 답변은 제공된 컨텍스트에만 기반해야 합니다.

**문단 1 (아키텍처):**

1.  프로젝트의 핵심 정체성 (예: B2B2C 멀티테넌시 웨비나 SaaS 플랫폼)

2.  핵심 기술 스택 (예: Next.js 15(App Router), Supabase(PostgreSQL, RLS, Realtime))

3.  핵심 아키텍처 원칙 (예: 계층형 구조, RLS를 통한 데이터 격리)

**문단 2 (개발 현황):**

4.  현재 개발 단계 (예: Phase 3 진행 중)

5.  최근 완료된 주요 기능 (예: 실시간 채팅, Q&A, 설문/퀴즈, 추첨 등)

6.  다음 예정 작업 (예: 웨비나 등록 페이지, 초대 링크)

**프로젝트 문서 컨텍스트 (RAG 검색 결과):**

---

${context || '(관련 문서를 찾을 수 없습니다)'}

---`;

  const response = await openai.chat.completions.create({
    model: MODEL, // 'gpt-4.1-mini'
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
  });

  return response.choices[0].message.content || '';
}

export async function generateReleaseNote(commitMessages: string[]): Promise<string> {
  const prompt = `**역할:** 테크니컬 라이터
**지시:** 다음 'push' 이벤트에 포함된 커밋 메시지 목록을 분석하여, 이 변경 사항을 요약하는 **간결하고 명확한 '릴리즈 노트' 한 문단**을 작성하십시오.

**[커밋 메시지 목록]**
---

커밋 메시지:
${commitMessages.join('\n')}
---`;

  const response = await openai.chat.completions.create({
    model: MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
  });

  return response.choices[0].message.content || '';
}

