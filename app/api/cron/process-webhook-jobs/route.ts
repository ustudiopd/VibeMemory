import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getFileContentWithSha, getChangedFilesFromCompare } from '@/lib/github';
import { chunkText, embedChunks } from '@/lib/rag';
import { generateReleaseNote, analyzeProject } from '@/lib/analysisService';

// Node.js 런타임 사용 (긴 처리 시간 필요)
export const runtime = 'nodejs';
export const maxDuration = 300; // 5분 (Pro 플랜 기준)

const CRON_SECRET = process.env.CRON_SECRET;
const BATCH_SIZE = 5; // 한 번에 처리할 작업 수

/**
 * 웹훅 작업 큐 워커
 * Vercel Cron 또는 수동 트리거로 실행
 * 
 * GET /api/cron/process-webhook-jobs
 */
export async function GET(request: NextRequest) {
  // CRON_SECRET 검증 (운영 환경)
  if (CRON_SECRET) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
  } else {
    console.log('[WEBHOOK-WORKER] CRON_SECRET not set, allowing request (development mode)');
  }

  try {
    // pending 상태의 작업 조회 (최신순, 배치 크기만큼)
    const { data: jobs, error: fetchError } = await supabaseAdmin
      .from('webhook_jobs')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(BATCH_SIZE);

    if (fetchError) {
      console.error('[WEBHOOK-WORKER] Error fetching jobs:', fetchError);
      return NextResponse.json(
        { error: 'Failed to fetch jobs', details: fetchError },
        { status: 500 }
      );
    }

    if (!jobs || jobs.length === 0) {
      return NextResponse.json({
        message: 'No pending jobs',
        processed: 0,
      });
    }

    console.log(`[WEBHOOK-WORKER] Processing ${jobs.length} jobs`);

    const results = {
      processed: 0,
      succeeded: 0,
      failed: 0,
    };

    // 각 작업 처리
    for (const job of jobs) {
      const logContext = {
        jobId: job.id,
        deliveryId: job.delivery_id,
        projectId: job.project_id,
      };

      try {
        // 상태를 running으로 변경
        await supabaseAdmin
          .from('webhook_jobs')
          .update({ status: 'running' })
          .eq('id', job.id);

        console.log(`[WEBHOOK-WORKER] Processing job`, logContext);

        // 작업 처리
        await processWebhookJob(job);

        // 성공: 상태를 done으로 변경
        await supabaseAdmin
          .from('webhook_jobs')
          .update({
            status: 'done',
            processed_at: new Date().toISOString(),
          })
          .eq('id', job.id);

        // Delivery 기록 업데이트 (성공)
        await supabaseAdmin
          .from('webhook_deliveries')
          .update({
            status: 'done',
            processed_at: new Date().toISOString(),
          })
          .eq('delivery_id', job.delivery_id);

        results.succeeded++;
        console.log(`[WEBHOOK-WORKER] Job completed successfully`, logContext);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;

        console.error(`[WEBHOOK-WORKER] Job failed:`, { ...logContext, error: errorMessage });

        // 재시도 가능 여부 확인
        const retryCount = (job.retry_count || 0) + 1;
        const maxRetries = job.max_retries || 3;
        const shouldRetry = retryCount < maxRetries;

        if (shouldRetry) {
          // 재시도: 상태를 pending으로 되돌리고 retry_count 증가
          await supabaseAdmin
            .from('webhook_jobs')
            .update({
              status: 'pending',
              retry_count: retryCount,
              error_json: { error: errorMessage, retryCount },
            })
            .eq('id', job.id);
          console.log(`[WEBHOOK-WORKER] Job will be retried (${retryCount}/${maxRetries})`, logContext);
        } else {
          // 최대 재시도 횟수 초과: 상태를 error로 변경
          await supabaseAdmin
            .from('webhook_jobs')
            .update({
              status: 'error',
              retry_count: retryCount,
              error_json: { error: errorMessage, stack: errorStack, maxRetriesExceeded: true },
              processed_at: new Date().toISOString(),
            })
            .eq('id', job.id);

          // Delivery 기록 업데이트 (에러)
          await supabaseAdmin
            .from('webhook_deliveries')
            .update({
              status: 'error',
              processed_at: new Date().toISOString(),
              error_json: { error: errorMessage, maxRetriesExceeded: true },
            })
            .eq('delivery_id', job.delivery_id);
        }

        results.failed++;
      }

      results.processed++;
    }

    return NextResponse.json({
      message: 'Jobs processed',
      ...results,
    });
  } catch (error) {
    console.error('[WEBHOOK-WORKER] Error processing jobs:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

/**
 * 웹훅 작업 처리 (기존 웹훅 로직)
 */
async function processWebhookJob(job: any) {
  const { delivery_id, project_id, payload } = job;
  const event = payload;
  const { repository, commits } = event;
  const repoOwner = repository.owner.login;
  const repoName = repository.name;
  const repoUrl = repository.html_url;

  const logContext = {
    deliveryId: delivery_id,
    projectId: project_id,
    repoOwner,
    repoName,
  };

  // 커밋 히스토리 저장
  if (commits && commits.length > 0) {
    try {
      const commitRecords = commits.map((commit: any) => ({
        project_id: project_id,
        sha: commit.id || commit.sha,
        message: commit.message || '',
        author_name: commit.author?.name || '',
        author_email: commit.author?.email || '',
        author_login: commit.author?.username || commit.author?.name || '',
        author_avatar_url: '',
        commit_date: commit.timestamp ? new Date(commit.timestamp).toISOString() : new Date().toISOString(),
        commit_url: commit.url || `https://github.com/${repoOwner}/${repoName}/commit/${commit.id || commit.sha}`,
      }));

      for (const commitRecord of commitRecords) {
        const { error: upsertError } = await supabaseAdmin
          .from('commit_history')
          .upsert(commitRecord, {
            onConflict: 'project_id,sha',
            ignoreDuplicates: false,
          });

        if (upsertError) {
          console.error(`[WEBHOOK-WORKER] Error upserting commit ${commitRecord.sha}:`, { ...logContext, error: upsertError });
        }
      }

      console.log(`[WEBHOOK-WORKER] Saved ${commitRecords.length} commits`, logContext);
    } catch (error) {
      console.error('[WEBHOOK-WORKER] Error saving commit history:', { ...logContext, error });
    }
  }

  // Job Lock 획득
  const jobName = `webhook:${repoOwner}/${repoName}`;
  let claimResult: boolean | null = false;

  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await supabaseAdmin.rpc('claim_job', {
      p_job_name: jobName,
      p_duration: '30 minutes',
    });

    claimResult = result.data;

    if (claimResult) {
      console.log(`[WEBHOOK-WORKER] Successfully claimed job on attempt ${attempt + 1}`, logContext);
      break;
    }

    if (attempt < 2) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  if (!claimResult) {
    const { data: forceClaimResult } = await supabaseAdmin.rpc('force_claim_job', {
      p_job_name: jobName,
      p_duration: '30 minutes',
    });

    if (!forceClaimResult) {
      throw new Error('Failed to acquire job lock');
    }

    console.log(`[WEBHOOK-WORKER] force_claim_job succeeded`, logContext);
  }

  try {
    // GitHub Access Token 가져오기
    const { getSystemUser } = await import('@/lib/system-user');
    const systemUserConfig = getSystemUser();

    if (!systemUserConfig || !systemUserConfig.githubAccessToken) {
      throw new Error('GitHub access token unavailable');
    }

    const accessToken = systemUserConfig.githubAccessToken;

    // Compare API로 변경 파일 목록 재검증 (더 정확함)
    let modifiedFiles: string[] = [];
    let addedFiles: string[] = [];
    let removedFiles: string[] = [];

    const beforeSha = event.before;
    const afterSha = event.after;

    if (beforeSha && afterSha && beforeSha !== '0000000000000000000000000000000000000000') {
      try {
        // Compare API로 정확한 변경 파일 목록 가져오기
        const compareResult = await getChangedFilesFromCompare(
          accessToken,
          repoOwner,
          repoName,
          beforeSha,
          afterSha
        );
        modifiedFiles = compareResult.modified;
        addedFiles = compareResult.added;
        removedFiles = compareResult.removed;
        console.log(`[WEBHOOK-WORKER] Compare API result - Modified: ${modifiedFiles.length}, Added: ${addedFiles.length}, Removed: ${removedFiles.length}`, logContext);
      } catch (compareError) {
        console.warn(`[WEBHOOK-WORKER] Compare API failed, falling back to commit data:`, { ...logContext, error: compareError });
        // Fallback: push 이벤트의 commit 데이터 사용
        modifiedFiles = event.commits
          .flatMap((commit: any) => commit.modified || [])
          .filter((path: string) => path.endsWith('.md'));

        addedFiles = event.commits
          .flatMap((commit: any) => commit.added || [])
          .filter((path: string) => path.endsWith('.md'));

        removedFiles = event.commits
          .flatMap((commit: any) => commit.removed || [])
          .filter((path: string) => path.endsWith('.md'));

        // 중복 제거
        modifiedFiles = [...new Set(modifiedFiles)];
        addedFiles = [...new Set(addedFiles)];
        removedFiles = [...new Set(removedFiles)];
      }
    } else {
      // 초기 push (before가 0000...인 경우) 또는 before/after가 없는 경우
      // commit 데이터 사용
      modifiedFiles = event.commits
        .flatMap((commit: any) => commit.modified || [])
        .filter((path: string) => path.endsWith('.md'));

      addedFiles = event.commits
        .flatMap((commit: any) => commit.added || [])
        .filter((path: string) => path.endsWith('.md'));

      removedFiles = event.commits
        .flatMap((commit: any) => commit.removed || [])
        .filter((path: string) => path.endsWith('.md'));

      // 중복 제거
      modifiedFiles = [...new Set(modifiedFiles)];
      addedFiles = [...new Set(addedFiles)];
      removedFiles = [...new Set(removedFiles)];
    }

    console.log(`[WEBHOOK-WORKER] Files to process - Modified: ${modifiedFiles.length}, Added: ${addedFiles.length}, Removed: ${removedFiles.length}`, logContext);

    // Process modified files
    const { uploadFileToStorage } = await import('@/lib/storage');

    for (const filePath of modifiedFiles) {
      try {
        const { content, sha: fileSha } = await getFileContentWithSha(accessToken, repoOwner, repoName, filePath);
        const bucketPath = await uploadFileToStorage(project_id, fileSha, filePath, content);

        const { data: repoFile } = await supabaseAdmin
          .from('repo_files')
          .select('id, sha')
          .eq('project_id', project_id)
          .eq('path', filePath)
          .eq('is_current', true)
          .single();

        if (repoFile) {
          await supabaseAdmin
            .from('repo_files')
            .update({
              sha: fileSha,
              bucket_path: bucketPath,
              size: content.length,
              updated_at: new Date().toISOString(),
            })
            .eq('id', repoFile.id);

          await supabaseAdmin
            .from('repo_file_chunks')
            .update({ is_current: false })
            .eq('repo_file_id', repoFile.id)
            .eq('is_current', true);

          const chunks = chunkText(content, filePath);
          const embeddings = await embedChunks(chunks);

          const chunksToInsert = chunks.map((chunk, index) => ({
            repo_file_id: repoFile.id,
            content: chunk.content,
            embedding: embeddings[index],
            embedding_version: 'text-embedding-3-small',
            is_current: true,
            chunk_index: index,
          }));

          const { error: chunksError } = await supabaseAdmin.rpc('insert_repo_file_chunks', {
            p_chunks: chunksToInsert,
          });

          if (chunksError) {
            console.error(`[WEBHOOK-WORKER] Error inserting chunks for ${filePath}:`, { ...logContext, filePath, error: chunksError });
          }
        }
      } catch (error) {
        console.error(`[WEBHOOK-WORKER] Error processing modified file ${filePath}:`, { ...logContext, filePath, error });
      }
    }

    // Process added files
    for (const filePath of addedFiles) {
      try {
        const { content, sha: fileSha } = await getFileContentWithSha(accessToken, repoOwner, repoName, filePath);
        const bucketPath = await uploadFileToStorage(project_id, fileSha, filePath, content);

        const { data: repoFile } = await supabaseAdmin
          .from('repo_files')
          .insert({
            project_id: project_id,
            path: filePath,
            sha: fileSha,
            size: content.length,
            bucket_path: bucketPath,
            is_current: true,
          })
          .select()
          .single();

        if (repoFile) {
          const chunks = chunkText(content, filePath);
          const embeddings = await embedChunks(chunks);

          const chunksToInsert = chunks.map((chunk, index) => ({
            repo_file_id: repoFile.id,
            content: chunk.content,
            embedding: embeddings[index],
            embedding_version: 'text-embedding-3-small',
            is_current: true,
            chunk_index: index,
          }));

          await supabaseAdmin.rpc('insert_repo_file_chunks', {
            p_chunks: chunksToInsert,
          });
        }
      } catch (error) {
        console.error(`[WEBHOOK-WORKER] Error processing added file ${filePath}:`, { ...logContext, filePath, error });
      }
    }

    // Process removed files
    const { deleteFileFromStorage } = await import('@/lib/storage');

    for (const filePath of removedFiles) {
      try {
        const { data: repoFile } = await supabaseAdmin
          .from('repo_files')
          .select('id, bucket_path')
          .eq('project_id', project_id)
          .eq('path', filePath)
          .eq('is_current', true)
          .maybeSingle();

        if (repoFile) {
          if (repoFile.bucket_path) {
            await deleteFileFromStorage(repoFile.bucket_path);
          }

          await supabaseAdmin
            .from('repo_files')
            .update({ is_current: false })
            .eq('id', repoFile.id);
        }
      } catch (error) {
        console.error(`[WEBHOOK-WORKER] Error processing removed file ${filePath}:`, { ...logContext, filePath, error });
      }
    }

    // Generate release note
    const commitMessages = commits.map((commit: any) => commit.message);
    const releaseNote = await generateReleaseNote(commitMessages);

    await supabaseAdmin
      .from('project_analysis')
      .update({ latest_release_note: releaseNote })
      .eq('project_id', project_id);

    // Trigger AI analysis if needed
    const coreFiles = ['projectbrief.md', 'techContext.md', 'systemPatterns.md', 'productContext.md', 'activeContext.md', 'progress.md'];
    const coreFilesModified = modifiedFiles.some((path: string) =>
      coreFiles.some((core) => path.includes(core))
    );

    const { data: existingAnalysis } = await supabaseAdmin
      .from('project_analysis')
      .select('updated_at')
      .eq('project_id', project_id)
      .single();

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const analysisOutdated = !existingAnalysis ||
      new Date(existingAnalysis.updated_at) < oneHourAgo;

    const shouldUpdateAnalysis = coreFilesModified ||
      (analysisOutdated && (modifiedFiles.length > 0 || addedFiles.length > 0));

    if (shouldUpdateAnalysis && accessToken) {
      console.log(`[WEBHOOK-WORKER] Triggering AI analysis`, logContext);
      await analyzeProject(project_id, accessToken, repoOwner, repoName);
    } else {
      console.log(`[WEBHOOK-WORKER] Skipping AI analysis`, logContext);
    }
  } finally {
    // 잠금 해제
    try {
      await supabaseAdmin.rpc('force_claim_job', {
        p_job_name: jobName,
        p_duration: '0 seconds',
      });
    } catch (error) {
      console.log(`[WEBHOOK-WORKER] Lock cleanup attempted (may already be released)`, logContext);
    }
  }
}

