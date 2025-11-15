import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { getFileContentWithSha } from '@/lib/github';
import { chunkText, embedChunks } from '@/lib/rag';
import { generateReleaseNote, analyzeProject } from '@/lib/analysisService';

const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET!;

function verifySignature(payload: string, signature: string): boolean {
  const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET);
  const digest = 'sha256=' + hmac.update(payload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
}

export async function POST(request: NextRequest) {
  let jobName: string | null = null; // 에러 핸들링을 위해 스코프 밖에 선언
  
  try {
    console.log('[WEBHOOK] Webhook request received');
    const signature = request.headers.get('x-hub-signature-256');
    const payload = await request.text();

    if (!signature) {
      console.error('[WEBHOOK] Missing signature');
      return NextResponse.json(
        { error: 'Missing signature' },
        { status: 401 }
      );
    }

    // Verify HMAC signature
    if (!verifySignature(payload, signature)) {
      console.error('[WEBHOOK] Invalid signature');
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 401 }
      );
    }

    const event = JSON.parse(payload);
    const eventType = request.headers.get('x-github-event');
    console.log(`[WEBHOOK] Event type: ${eventType}`);

    if (eventType !== 'push') {
      console.log(`[WEBHOOK] Event ignored (type: ${eventType})`);
      return NextResponse.json({ message: 'Event ignored' }, { status: 200 });
    }

    const { repository, commits } = event;
    const repoOwner = repository.owner.login;
    const repoName = repository.name;
    const repoUrl = repository.html_url;
    
    console.log(`[WEBHOOK] Processing push event for ${repoOwner}/${repoName}`);
    console.log(`[WEBHOOK] Commits: ${commits.length}`);

    // Find project (시스템 사용자의 프로젝트만)
    const { getSystemUserFromSupabase } = await import('@/lib/system-user');
    const systemUser = await getSystemUserFromSupabase();
    
    if (!systemUser) {
      return NextResponse.json(
        { error: '시스템 사용자를 찾을 수 없습니다.' },
        { status: 404 }
      );
    }
    
    const { data: project, error: projectError } = await supabaseAdmin
      .from('projects')
      .select('id, owner_id')
      .eq('repo_url', repoUrl)
      .eq('owner_id', systemUser.id)
      .single();

    if (projectError || !project) {
      console.error(`[WEBHOOK] Project not found for ${repoUrl}`, projectError);
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    const projectId = project.id;
    jobName = `webhook:${repoOwner}/${repoName}`;
    console.log(`[WEBHOOK] Found project: ${projectId}`);

    // 커밋 히스토리 저장 (웹훅 수신 기준)
    if (commits && commits.length > 0) {
      try {
        // GitHub 웹훅의 커밋 구조: { id, message, timestamp, url, author: { name, email, username } }
        const commitRecords = commits.map((commit: any) => ({
          project_id: projectId,
          sha: commit.id || commit.sha,
          message: commit.message || '',
          author_name: commit.author?.name || '',
          author_email: commit.author?.email || '',
          author_login: commit.author?.username || commit.author?.name || '',
          author_avatar_url: '', // 웹훅에는 아바타 URL이 없음
          commit_date: commit.timestamp ? new Date(commit.timestamp).toISOString() : new Date().toISOString(),
          commit_url: commit.url || `https://github.com/${repoOwner}/${repoName}/commit/${commit.id || commit.sha}`,
        }));

        // UPSERT로 저장 (중복 방지)
        for (const commitRecord of commitRecords) {
          const { error: upsertError } = await supabaseAdmin
            .from('commit_history')
            .upsert(commitRecord, {
              onConflict: 'project_id,sha',
              ignoreDuplicates: false,
            });
          
          if (upsertError) {
            console.error(`[WEBHOOK] Error upserting commit ${commitRecord.sha}:`, upsertError);
          }
        }

        console.log(`[WEBHOOK] Saved ${commitRecords.length} commits to commit_history`);
      } catch (error) {
        console.error('[WEBHOOK] Error saving commit history:', error);
        // 커밋 히스토리 저장 실패해도 웹훅 처리는 계속 진행
      }
    }

    // CLAIM: Prevent concurrent processing
    // 먼저 만료된 잠금 정리
    const { error: cleanupError } = await supabaseAdmin
      .from('job_locks')
      .delete()
      .eq('job_name', jobName)
      .lt('expires_at', new Date().toISOString());

    if (cleanupError) {
      console.warn(`[WEBHOOK] Error cleaning up expired locks:`, cleanupError);
    }

    // 잠금 획득 시도 (최대 3번 재시도)
    let claimResult: boolean | null = false;
    let claimError: any = null;
    
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await supabaseAdmin.rpc('claim_job', {
        p_job_name: jobName,
        p_duration: '30 minutes',
      });
      
      claimResult = result.data;
      claimError = result.error;
      
      if (claimResult) {
        console.log(`[WEBHOOK] Successfully claimed job on attempt ${attempt + 1}`);
        break;
      }
      
      if (attempt < 2) {
        // 재시도 전에 잠금 다시 확인 및 정리
        console.log(`[WEBHOOK] claim_job failed (attempt ${attempt + 1}), retrying...`);
        await supabaseAdmin
          .from('job_locks')
          .delete()
          .eq('job_name', jobName);
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    // 모든 재시도 실패 시 force_claim_job 사용
    if (!claimResult) {
      console.log(`[WEBHOOK] All claim_job attempts failed, trying force_claim_job`);
      const { data: forceClaimResult, error: forceClaimError } = await supabaseAdmin.rpc('force_claim_job', {
        p_job_name: jobName,
        p_duration: '30 minutes',
      });
      
      if (forceClaimError || !forceClaimResult) {
        console.error(`[WEBHOOK] force_claim_job also failed:`, forceClaimError);
        return NextResponse.json(
          { message: 'Another webhook processing is in progress and could not be overridden' },
          { status: 409 }
        );
      }
      
      console.log(`[WEBHOOK] force_claim_job succeeded, proceeding with webhook processing`);
    }

    // Process modified/added/removed files
    const modifiedFiles = event.commits
      .flatMap((commit: any) => commit.modified || [])
      .filter((path: string) => path.endsWith('.md'));

    const addedFiles = event.commits
      .flatMap((commit: any) => commit.added || [])
      .filter((path: string) => path.endsWith('.md'));

    const removedFiles = event.commits
      .flatMap((commit: any) => commit.removed || [])
      .filter((path: string) => path.endsWith('.md'));

    console.log(`[WEBHOOK] Files to process - Modified: ${modifiedFiles.length}, Added: ${addedFiles.length}, Removed: ${removedFiles.length}`);
    if (modifiedFiles.length > 0) console.log(`[WEBHOOK] Modified files:`, modifiedFiles);
    if (addedFiles.length > 0) console.log(`[WEBHOOK] Added files:`, addedFiles);
    if (removedFiles.length > 0) console.log(`[WEBHOOK] Removed files:`, removedFiles);

    // 시스템 사용자의 GitHub Access Token 사용
    const { getSystemUser } = await import('@/lib/system-user');
    const systemUserConfig = getSystemUser();
    
    if (!systemUserConfig || !systemUserConfig.githubAccessToken) {
      console.warn('시스템 GitHub access token이 설정되지 않았습니다.');
      // Return success but skip file processing
      return NextResponse.json(
        { message: 'Webhook received but access token unavailable' },
        { status: 200 }
      );
    }
    
    const accessToken = systemUserConfig.githubAccessToken;

    // Process modified files (surgical update)
    const { uploadFileToStorage, getStoragePath } = await import('@/lib/storage');
    
    for (const filePath of modifiedFiles) {
      try {
        // Get latest file content and SHA from GitHub API
        const { content, sha: fileSha } = await getFileContentWithSha(accessToken, repoOwner, repoName, filePath);

        // Upload to Storage
        const bucketPath = await uploadFileToStorage(projectId, fileSha, filePath, content);

        // Find repo_file record
        const { data: repoFile } = await supabaseAdmin
          .from('repo_files')
          .select('id, sha')
          .eq('project_id', projectId)
          .eq('path', filePath)
          .eq('is_current', true)
          .single();

        if (repoFile) {
          // Update repo_file with new SHA and bucket_path
          await supabaseAdmin
            .from('repo_files')
            .update({
              sha: fileSha,
              bucket_path: bucketPath,
              size: content.length,
              updated_at: new Date().toISOString(),
            })
            .eq('id', repoFile.id);
          // Mark old chunks as not current
          await supabaseAdmin
            .from('repo_file_chunks')
            .update({ is_current: false })
            .eq('repo_file_id', repoFile.id)
            .eq('is_current', true);

          // Create new chunks
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

          // Use RPC function to insert chunks (handles vector type conversion)
          const { error: chunksError } = await supabaseAdmin.rpc('insert_repo_file_chunks', {
            p_chunks: chunksToInsert,
          });

          if (chunksError) {
            console.error(`Error inserting chunks for ${filePath}:`, chunksError);
          }
        }
      } catch (error) {
        console.error(`Error processing modified file ${filePath}:`, error);
      }
    }

    // Process added files
    for (const filePath of addedFiles) {
      try {
        // Get file content and SHA from GitHub API
        const { content, sha: fileSha } = await getFileContentWithSha(accessToken, repoOwner, repoName, filePath);

        // Upload to Storage
        const bucketPath = await uploadFileToStorage(projectId, fileSha, filePath, content);

        // Insert new repo_file record
        const { data: repoFile } = await supabaseAdmin
          .from('repo_files')
          .insert({
            project_id: projectId,
            path: filePath,
            sha: fileSha,
            size: content.length,
            bucket_path: bucketPath,
            is_current: true,
          })
          .select()
          .single();

        if (repoFile) {
          // Create chunks
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
        console.error(`Error processing added file ${filePath}:`, error);
      }
    }

    // Process removed files
    const { deleteFileFromStorage } = await import('@/lib/storage');
    
    for (const filePath of removedFiles) {
      try {
        // Find repo_file record
        const { data: repoFile } = await supabaseAdmin
          .from('repo_files')
          .select('id, bucket_path')
          .eq('project_id', projectId)
          .eq('path', filePath)
          .eq('is_current', true)
          .maybeSingle();

        if (repoFile) {
          // Delete from Storage if exists
          if (repoFile.bucket_path) {
            await deleteFileFromStorage(repoFile.bucket_path);
          }

          // Mark as not current
          await supabaseAdmin
            .from('repo_files')
            .update({ is_current: false })
            .eq('id', repoFile.id);
        }
      } catch (error) {
        console.error(`Error processing removed file ${filePath}:`, error);
      }
    }

    // Generate release note (P5)
    const commitMessages = commits.map((commit: any) => commit.message);
    const releaseNote = await generateReleaseNote(commitMessages);

    await supabaseAdmin
      .from('vibememory.project_analysis')
      .update({ latest_release_note: releaseNote })
      .eq('project_id', projectId);

    // Update AI reviews if core files were modified OR if analysis is outdated
    const coreFiles = ['projectbrief.md', 'techContext.md', 'systemPatterns.md', 'productContext.md', 'activeContext.md', 'progress.md'];
    const coreFilesModified = modifiedFiles.some((path: string) =>
      coreFiles.some((core) => path.includes(core))
    );

    // Check if AI analysis is outdated (older than 1 hour)
    const { data: existingAnalysis } = await supabaseAdmin
      .from('project_analysis')
      .select('updated_at')
      .eq('project_id', projectId)
      .single();

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const analysisOutdated = !existingAnalysis || 
      new Date(existingAnalysis.updated_at) < oneHourAgo;

    // Trigger AI analysis if:
    // 1. Core files were modified, OR
    // 2. Analysis is outdated (older than 1 hour) AND files were modified
    const shouldUpdateAnalysis = coreFilesModified || 
      (analysisOutdated && (modifiedFiles.length > 0 || addedFiles.length > 0));

    if (shouldUpdateAnalysis && accessToken) {
      console.log(`[WEBHOOK] Triggering AI analysis (coreFilesModified: ${coreFilesModified}, analysisOutdated: ${analysisOutdated})`);
      await analyzeProject(projectId, accessToken, repoOwner, repoName);
    } else {
      console.log(`[WEBHOOK] Skipping AI analysis (coreFilesModified: ${coreFilesModified}, analysisOutdated: ${analysisOutdated}, filesModified: ${modifiedFiles.length + addedFiles.length})`);
    }

    // 웹훅 처리 완료 후 잠금 해제
    await supabaseAdmin
      .from('job_locks')
      .delete()
      .eq('job_name', jobName);

    console.log(`[WEBHOOK] Successfully processed webhook for ${repoOwner}/${repoName}`);
    return NextResponse.json({ message: 'Webhook processed successfully' }, { status: 200 });
  } catch (error) {
    console.error('[WEBHOOK] Error processing webhook:', error);
    
    // 에러 발생 시에도 잠금 해제 시도
    if (jobName) {
      try {
        await supabaseAdmin
          .from('job_locks')
          .delete()
          .eq('job_name', jobName);
        console.log(`[WEBHOOK] Lock cleaned up after error for ${jobName}`);
      } catch (cleanupError) {
        console.error('[WEBHOOK] Error cleaning up lock after error:', cleanupError);
      }
    }
    
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

