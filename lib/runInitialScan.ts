import { supabaseAdmin } from './supabase';
import { getRepositoryTree, getFileContent } from './github';
import { chunkText, embedChunks } from './rag';
import { analyzeProject } from './analysisService';
import { uploadFileToStorage, downloadFileFromStorage, getStoragePath } from './storage';

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
    console.error('[SCAN] Error selecting scan_progress:', selectError);
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
      console.error('[SCAN] Error updating scan_progress:', updateError);
      return updateError;
    }
  } else {
    const { error: insertError } = await supabaseAdmin.from('scan_progress').insert({
      run_id: runId,
      project_id: projectId,
      ...updates,
    });
    
    if (insertError) {
      console.error('[SCAN] Error inserting scan_progress:', {
        error: insertError,
        code: insertError.code,
        message: insertError.message,
        details: insertError.details,
        hint: insertError.hint,
        runId,
        projectId,
      });
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
    console.log(`Starting initial scan for project ${projectId}`);

    // ingestion_run 생성 (없는 경우)
    if (!currentRunId) {
      console.log(`[SCAN] Creating ingestion_run for project ${projectId}`);
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
        console.error('[SCAN] Error creating ingestion run:', {
          error: runError,
          code: runError?.code,
          message: runError?.message,
          details: runError?.details,
          hint: runError?.hint,
          projectId,
        });
        throw new Error(`Failed to create ingestion run: ${runError?.message || 'Unknown error'}`);
      }

      if (!newRun.id) {
        throw new Error('Failed to create ingestion run: ID is missing');
      }
      console.log(`[SCAN] Created ingestion_run: ${newRun.id}`);
      currentRunId = newRun.id;
      
      // 타입 가드: currentRunId는 이 시점에서 반드시 string임
      const progressError = await updateScanProgress(newRun.id, projectId, {
        md_total: 0,
        md_indexed: 0,
        chunk_total: 0,
        review_done: 0,
        review_total: 4,  // 프로젝트 개요 포함하여 4단계
      });
      
      if (progressError) {
        console.error('[SCAN] Error creating scan_progress:', progressError);
      } else {
        console.log(`[SCAN] Created scan_progress for run ${currentRunId}`);
      }
    }

    // P1: 인덱싱 단계
    if (!currentRunId) {
      throw new Error('currentRunId is required');
    }
    await updateIngestionRun(currentRunId, 'indexing', 'running');
    console.log(`[SCAN] Starting indexing phase for ${repoOwner}/${repoName}`);
    
    let mdFiles;
    try {
      // getRepositoryTree already returns filtered .md files
      mdFiles = await getRepositoryTree(accessToken, repoOwner, repoName);
      console.log(`[SCAN] Retrieved ${mdFiles.length} markdown files from repository`);
    } catch (error: any) {
      console.error('[SCAN] Error fetching repository tree:', {
        message: error.message,
        status: error.status,
        response: error.response?.data,
        repoOwner,
        repoName,
      });
      throw new Error(`Failed to fetch repository tree: ${error.message}`);
    }

    await updateScanProgress(currentRunId, projectId, {
      md_total: mdFiles.length,
    });

    let indexedCount = 0;
    let totalChunks = 0;

    // Process each .md file
    for (const item of mdFiles) {
      if (!item.path || !item.sha) continue;

      try {
        // 1. Get file content from GitHub
        const content = await getFileContent(accessToken, repoOwner, repoName, item.path);
        
        // 2. Upload file to Storage bucket
        const bucketPath = getStoragePath(projectId, item.sha, item.path);
        const uploadedPath = await uploadFileToStorage(projectId, item.sha, item.path, content);
        
        if (!uploadedPath) {
          console.error(`[SCAN] Failed to upload file to storage: ${item.path}`);
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
          console.error(`[SCAN] Error saving file ${item.path}:`, fileError);
          continue;
        }

        indexedCount++;
        await updateScanProgress(currentRunId, projectId, {
          md_indexed: indexedCount,
        });

        // P2: 임베딩 단계로 전환
        if (indexedCount === 1) {
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

        // Embed chunks
        const embeddings = await embedChunks(chunks);

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
          console.error(`Error inserting chunks for ${item.path}:`, chunksError);
          throw new Error(`Failed to insert chunks: ${chunksError.message}`);
        } else {
          const insertedCount = insertResult?.[0]?.inserted_count || chunks.length;
          totalChunks += insertedCount;
          await updateScanProgress(currentRunId, projectId, {
            chunk_total: totalChunks,
          });
          console.log(`Processed ${insertedCount} chunks for ${item.path}`);
        }
      } catch (error) {
        console.error(`Error processing file ${item.path}:`, error);
        continue;
      }
    }

    // P3: AI 리뷰 단계
    if (!currentRunId) {
      throw new Error('currentRunId is required');
    }
    await updateIngestionRun(currentRunId, 'review', 'running');
    await analyzeProject(projectId, accessToken, repoOwner, repoName, currentRunId);

    // 완료
    await updateIngestionRun(currentRunId, 'done', 'completed');
    await supabaseAdmin
      .from('ingestion_runs')
      .update({ finished_at: new Date().toISOString() })
      .eq('id', currentRunId);

    console.log(`Initial scan completed for project ${projectId}`);
  } catch (error) {
    console.error(`Error in initial scan for project ${projectId}:`, error);
    
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

