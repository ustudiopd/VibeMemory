import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSystemUserFromSupabase } from '@/lib/system-user';
import { openai } from '@ai-sdk/openai';
import { generateText } from 'ai';

const MODEL = process.env.CHATGPT_MODEL || 'gpt-5-mini';

/**
 * POST /api/projects/[id]/idea/synthesize
 * 아이디어 프로젝트의 파일과 챗봇 대화를 기반으로 명세서 생성
 * 해결책.md 2.2.3장 참조
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
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
      .select('id, project_type, owner_id, project_name')
      .eq('id', projectId)
      .eq('owner_id', user.id)
      .single();

    if (projectError || !project) {
      return NextResponse.json(
        { error: '프로젝트를 찾을 수 없습니다.' },
        { status: 404 }
      );
    }

    if (project.project_type !== 'idea') {
      return NextResponse.json(
        { error: '이 API는 아이디어 프로젝트 전용입니다.' },
        { status: 400 }
      );
    }

    // 1. 아이디어 프로젝트 파일 내용 수집
    const { data: files, error: filesError } = await supabaseAdmin
      .from('idea_project_files')
      .select('id, file_name, storage_path')
      .eq('project_id', projectId)
      .is('deleted_at', null);

    if (filesError) {
      console.error('[SYNTHESIZE] Error fetching files:', filesError);
      return NextResponse.json(
        { error: '파일을 불러올 수 없습니다.', details: filesError.message },
        { status: 500 }
      );
    }

    // 파일 내용 읽기 (Storage에서)
    const fileContents: string[] = [];
    for (const file of files || []) {
      try {
        const { data, error: downloadError } = await supabaseAdmin.storage
          .from('idea-project-files')
          .download(file.storage_path);

        if (!downloadError && data) {
          const text = await data.text();
          fileContents.push(`[파일: ${file.file_name}]\n${text}`);
        }
      } catch (error) {
        console.error(`[SYNTHESIZE] Error reading file ${file.file_name}:`, error);
      }
    }

    // 2. 챗봇 대화 기록 수집
    const { data: sessions, error: sessionsError } = await supabaseAdmin
      .from('chat_sessions')
      .select('id')
      .eq('project_id', projectId)
      .eq('owner_id', user.id)
      .order('created_at', { ascending: false })
      .limit(10); // 최근 10개 세션

    const chatHistory: string[] = [];
    if (!sessionsError && sessions) {
      for (const session of sessions) {
        const { data: messages, error: messagesError } = await supabaseAdmin
          .from('chat_messages')
          .select('role, content')
          .eq('session_id', session.id)
          .order('created_at', { ascending: true })
          .limit(50); // 세션당 최대 50개 메시지

        if (!messagesError && messages) {
          const sessionHistory = messages
            .map((msg) => `${msg.role === 'user' ? '사용자' : 'AI'}: ${msg.content}`)
            .join('\n');
          if (sessionHistory) {
            chatHistory.push(`[세션 ${session.id}]\n${sessionHistory}`);
          }
        }
      }
    }

    // 3. 컨텍스트 구성 (최대 토큰 수 제한)
    const filesContext = fileContents.join('\n\n---\n\n');
    const chatContext = chatHistory.join('\n\n---\n\n');
    const fullContext = `[업로드된 파일]\n${filesContext}\n\n[챗봇 대화 기록]\n${chatContext}`;

    // 토큰 수 제한 (대략 8000 토큰, 약 6000자)
    const maxLength = 6000;
    const truncatedContext = fullContext.length > maxLength
      ? fullContext.substring(0, maxLength) + '\n\n... (내용이 길어 일부만 포함되었습니다)'
      : fullContext;

    // 4. AI 합성
    const prompt = `다음은 사용자가 업로드한 아이디어 파일과 챗봇 대화 기록입니다. 이를 기반으로 프로젝트 명세서를 작성해주세요.

${truncatedContext}

위 정보를 바탕으로 다음 형식으로 명세서를 작성해주세요:

# 프로젝트 명세서

## 1. 프로젝트 개요
- 프로젝트 목적
- 주요 기능
- 타겟 사용자

## 2. 기능 요구사항
- 핵심 기능
- 부가 기능
- 우선순위

## 3. 기술 스펙
- 기술 스택
- 아키텍처
- 데이터베이스

## 4. 사용자 경험
- UI/UX 요구사항
- 사용자 플로우

## 5. 개발 계획
- 개발 단계
- 마일스톤
- 예상 기간

명세서는 구체적이고 실현 가능하도록 작성해주세요.`;

    const { text: specification } = await generateText({
      model: openai(MODEL),
      prompt: prompt,
    });

    return NextResponse.json({
      success: true,
      specification: specification,
    });
  } catch (error) {
    console.error('[SYNTHESIZE] Error:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

