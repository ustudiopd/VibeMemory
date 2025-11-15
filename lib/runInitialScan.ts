import { supabaseAdmin } from './supabase';
import { getRepositoryTree, getFileContent } from './github';
import { chunkText, embedChunks } from './rag';
import { analyzeProject } from './analysisService';
import { uploadFileToStorage, downloadFileFromStorage, getStoragePath } from './storage';
import { retryWithBackoff } from './utils/retry';
import { logger } from './utils/logger';

// 진행 상태 업데이트 헬퍼 함수
async function updateIngestionRun(
  runId: string,
  phase: string,
  status: string = 'running'
) {
  await supabaseAdmin
    .from('ingestion_runs')
    .update({ phase, status })
    .eq('id', runId);
}

async function updateScanProgress(
  runId: string,
  projectId: string,
  updates: {
    md_total?: number;
    md_indexed?: number;
    chunk_total?: number;
    review_done?: number;
    review_total?: number;
  }
) {
  // 기존 진행 상태 조회 또는 생성
  const { data: existing, error: selectError } = await supabaseAdmin
    .from('scan_progress')
    .select('id')
    .eq('run_id', runId)
    .eq('project_id', projectId)
    .maybeSingle();

  if (selectError && selectError.code !== 'PGRST116') { // PGRST116 = no rows returned
    logger.error('Error selecting scan_progress', { runId, projectId }, new Error(selectError.message));
    return selectError;
  }

  if (existing) {
    const { error: updateError } = await supabaseAdmin
      .from('scan_progress')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
    
    if (updateError) {
      logger.error('Error updating scan_progress', { runId, projectId }, new Error(updateError.message));
      return updateError;
    }
  } else {
    const { error: insertError } = await supabaseAdmin.from('scan_progress').insert({
      run_id: runId,
      project_id: projectId,
      ...updates,
    });
    
    if (insertError) {
      logger.error('Error inserting scan_progress', {
        runId,
        projectId,
        code: insertError.code,
        details: insertError.details,
        hint: insertError.hint,
      }, new Error(insertError.message));
      return insertError;
    }
  }
  
  return null;
}

export async function runInitialScan(
  projectId: string,
  accessToken: string,
  repoOwner: string,
  repoName: string,
  runId?: string
) {
  let currentRunId: string | undefined = runId;

  try {
    logger.info('Starting initial scan', { projectId, repoOwner, repoName, runId });

    // ingestion_run 생성 또는 가져오기
    if (!currentRunId) {
      // runId가 없으면 기존 pending/running run을 찾거나 새로 생성
      const { data: existingRun } = await supabaseAdmin
        .from('ingestion_runs')
        .select('id, status')
        .eq('project_id', projectId)
        .in('status', ['pending', 'running'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingRun) {
        currentRunId = existingRun.id;
        logger.info('Using existing ingestion_run', { 
          projectId, 
          runId: currentRunId, 
          status: existingRun.status 
        });
        
        // pending 상태면 running으로 변경
        if (existingRun.status === 'pending') {
          await supabaseAdmin
            .from('ingestion_runs')
            .update({ status: 'running' })
            .eq('id', currentRunId);
        }
      } else {
        // 새로 생성
        logger.info('Creating new ingestion_run', { projectId });
        const { data: newRun, error: runError } = await supabaseAdmin
          .from('ingestion_runs')
          .insert({
            project_id: projectId,
            phase: 'indexing',
            status: 'running',
          })
          .select()
          .single();

        if (runError || !newRun) {
          logger.error('Error creating ingestion run', {
            projectId,
            code: runError?.code,
            details: runError?.details,
            hint: runError?.hint,
          }, runError ? new Error(runError.message) : undefined);
          throw new Error(`Failed to create ingestion run: ${runError?.message || 'Unknown error'}`);
        }

        if (!newRun.id) {
          throw new Error('Failed to create ingestion run: ID is missing');
        }
        logger.info('Created ingestion_run', { projectId, runId: newRun.id });
        currentRunId = newRun.id;
      }
    } else {
      // runId가 제공된 경우, 상태를 running으로 업데이트
      await supabaseAdmin
        .from('ingestion_runs')
        .update({ status: 'running' })
        .eq('id', currentRunId);
    }

    // scan_progress 확인 및 생성 (없는 경우)
    if (currentRunId) {
      const { data: existingProgress } = await supabaseAdmin
        .from('scan_progress')
        .select('id')
        .eq('run_id', currentRunId)
        .maybeSingle();

      if (!existingProgress) {
        const progressError = await updateScanProgress(currentRunId, projectId, {
          md_total: 0,
          md_indexed: 0,
          chunk_total: 0,
          review_done: 0,
          review_total: 4,  // 프로젝트 개요 포함하여 4단계
        });
        
        if (progressError) {
          logger.error('Error creating scan_progress', { projectId, runId: currentRunId });
        } else {
          logger.info('Created scan_progress', { projectId, runId: currentRunId });
        }
      }
    }

    // P1: 인덱싱 단계
    if (!currentRunId) {
      throw new Error('currentRunId is required');
    }
    await updateIngestionRun(currentRunId, 'indexing', 'running');
    logger.info('Starting indexing phase', { projectId, runId: currentRunId, repoOwner, repoName });
    
    let mdFiles;
    try {
      // getRepositoryTree already returns filtered .md files
      mdFiles = await retryWithBackoff(
        () => getRepositoryTree(accessToken, repoOwner, repoName),
        {
          maxRetries: 3,
          initialDelay: 1000,
          onRetry: (attempt, error) => {
            logger.warn('Retrying getRepositoryTree', { 
              projectId, 
              attempt, 
              repoOwner, 
              repoName 
            });
          },
        }
      );
      logger.info('Retrieved markdown files from repository', { 
        projectId, 
        runId: currentRunId, 
        fileCount: mdFiles.length 
      });
    } catch (error: any) {
      logger.error('Error fetching repository tree', {
        projectId,
        runId: currentRunId,
        repoOwner,
        repoName,
        status: error.status,
        response: error.response?.data,
      }, error);
      throw new Error(`Failed to fetch repository tree: ${error.message}`);
    }

    await updateScanProgress(currentRunId, projectId, {
      md_total: mdFiles.length,
    });

    let indexedCount = 0;
    let totalChunks = 0;

    // 병렬 처리 설정: 3-5개 파일을 동시에 처리
    const BATCH_SIZE = 3;
    const PROGRESS_UPDATE_INTERVAL = 3; // 3개 파일마다 진행 상태 업데이트

    // 단일 파일 처리 함수
    async function processFile(item: { path?: string; sha?: string }, isFirstFile: boolean) {
      if (!item.path || !item.sha) {
        return { success: false, error: 'Missing path or sha' };
      }

      if (!currentRunId) {
        return { success: false, error: 'currentRunId is required' };
      }

      try {
        // 1. Get file content from GitHub (재시도 포함)
        const content = await retryWithBackoff(
          () => getFileContent(accessToken, repoOwner, repoName, item.path!),
          {
            maxRetries: 3,
            initialDelay: 1000,
            onRetry: (attempt) => {
              logger.warn('Retrying getFileContent', { 
                projectId, 
                runId: currentRunId, 
                filePath: item.path, 
                attempt 
              });
            },
          }
        );
        
        // 2. Upload file to Storage bucket
        const bucketPath = getStoragePath(projectId, item.sha, item.path);
        const uploadedPath = await uploadFileToStorage(projectId, item.sha, item.path, content);
        
        if (!uploadedPath) {
          logger.warn('Failed to upload file to storage', { 
            projectId, 
            runId: currentRunId, 
            filePath: item.path 
          });
          // Storage 업로드 실패해도 계속 진행 (GitHub에서 직접 가져올 수 있음)
        }

        // 3. Insert or update repo_file record (with bucket_path)
        // 트리거 함수에서 ON CONFLICT 처리하므로 upsert 대신 insert 사용
        const { data: repoFile, error: fileError } = await supabaseAdmin
          .from('repo_files')
          .insert({
            project_id: projectId,
            path: item.path,
            sha: item.sha,
            size: content.length,
            bucket_path: uploadedPath || null, // Storage 경로 저장
            is_current: true,
          })
          .select()
          .single();

        if (fileError || !repoFile) {
          logger.error('Error saving file', { 
            projectId, 
            runId: currentRunId, 
            filePath: item.path 
          }, fileError ? new Error(fileError.message) : undefined);
          return { success: false, error: fileError?.message || 'Unknown error' };
        }

        // P2: 임베딩 단계로 전환 (첫 파일 처리 시)
        if (isFirstFile) {
          await updateIngestionRun(currentRunId, 'embedding', 'running');
        }

        // Mark old chunks as not current
        await supabaseAdmin
          .from('repo_file_chunks')
          .update({ is_current: false })
          .eq('repo_file_id', repoFile.id)
          .eq('is_current', true);

        // Chunk the content
        const chunks = chunkText(content, item.path);

        // Embed chunks (재시도 포함)
        const embeddings = await retryWithBackoff(
          () => embedChunks(chunks),
          {
            maxRetries: 3,
            initialDelay: 2000,
            onRetry: (attempt) => {
              logger.warn('Retrying embedChunks', { 
                projectId, 
                runId: currentRunId, 
                filePath: item.path, 
                attempt 
              });
            },
          }
        );

        // Insert chunks with embeddings using RPC to handle vector type
        const chunksToInsert = chunks.map((chunk, index) => ({
          repo_file_id: repoFile.id,
          content: chunk.content,
          embedding: embeddings[index],
          embedding_version: 'text-embedding-3-small',
          is_current: true,
          chunk_index: index,
        }));

        // Use RPC function to insert chunks (handles vector type conversion)
        const { error: chunksError, data: insertResult } = await supabaseAdmin.rpc(
          'insert_repo_file_chunks',
          {
            p_chunks: chunksToInsert,
          }
        );

        if (chunksError) {
          logger.error('Error inserting chunks', { 
            projectId, 
            runId: currentRunId, 
            filePath: item.path 
          }, new Error(chunksError.message));
          throw new Error(`Failed to insert chunks: ${chunksError.message}`);
        }

        const insertedCount = insertResult?.[0]?.inserted_count || chunks.length;
        logger.info('Processed file', { 
          projectId, 
          runId: currentRunId, 
          filePath: item.path, 
          chunks: insertedCount 
        });

        return { 
          success: true, 
          chunks: insertedCount 
        };
      } catch (error) {
        logger.error('Error processing file', { 
          projectId, 
          runId: currentRunId, 
          filePath: item.path 
        }, error as Error);
        return { success: false, error: (error as Error).message };
      }
    }

    // 병렬 처리: 배치 단위로 파일 처리
    for (let i = 0; i < mdFiles.length; i += BATCH_SIZE) {
      const batch = mdFiles.slice(i, i + BATCH_SIZE);
      
      logger.info('Processing file batch', { 
        projectId, 
        runId: currentRunId, 
        batchStart: i + 1, 
        batchEnd: Math.min(i + BATCH_SIZE, mdFiles.length),
        totalFiles: mdFiles.length 
      });

      // 배치 내 파일들을 병렬로 처리
      const results = await Promise.allSettled(
        batch.map((item, batchIndex) => processFile(item, i === 0 && batchIndex === 0))
      );

      // 결과 처리
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value.success) {
          indexedCount++;
          totalChunks += result.value.chunks || 0;
        }
      }

      // 진행 상태 업데이트 (PROGRESS_UPDATE_INTERVAL마다 또는 마지막 배치)
      if (indexedCount % PROGRESS_UPDATE_INTERVAL === 0 || i + BATCH_SIZE >= mdFiles.length) {
        await updateScanProgress(currentRunId, projectId, {
          md_indexed: indexedCount,
          chunk_total: totalChunks,
        });
        logger.debug('Updated scan progress', { 
          projectId, 
          runId: currentRunId, 
          indexedCount, 
          totalChunks 
        });
      }
    }

    // P3: AI 리뷰 단계
    if (!currentRunId) {
      throw new Error('currentRunId is required');
    }
    await updateIngestionRun(currentRunId, 'review', 'running');
    logger.info('Starting AI review phase', { projectId, runId: currentRunId });
    
    await analyzeProject(projectId, accessToken, repoOwner, repoName, currentRunId);

    // 완료
    await updateIngestionRun(currentRunId, 'done', 'completed');
    await supabaseAdmin
      .from('ingestion_runs')
      .update({ finished_at: new Date().toISOString() })
      .eq('id', currentRunId);

    logger.info('Initial scan completed', { 
      projectId, 
      runId: currentRunId, 
      indexedCount, 
      totalChunks 
    });
  } catch (error) {
    logger.error('Error in initial scan', { 
      projectId, 
      runId: currentRunId 
    }, error as Error);
    
    // 실패 상태 업데이트
    if (currentRunId) {
      await updateIngestionRun(currentRunId, 'failed', 'failed');
      await supabaseAdmin
        .from('ingestion_runs')
        .update({ finished_at: new Date().toISOString() })
        .eq('id', currentRunId);
    }
    
    throw error;
  }
}

