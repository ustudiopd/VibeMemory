import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getRepositoryTree, getFileContent } from '@/lib/github';
import { chunkText, embedChunks } from '@/lib/rag';
import { analyzeProject } from '@/lib/analysisService';
import { uploadFileToStorage } from '@/lib/storage';

export async function GET(request: NextRequest) {
  try {
    // Verify cron secret (optional but recommended)
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const jobName = 'cron:sanity-check';
    const { data: claimResult, error: claimError } = await supabaseAdmin
      .schema('public')
      .rpc('claim_job', {
        p_job_name: jobName,
        p_duration: '2 hours',
      });

    if (claimError || !claimResult) {
      return NextResponse.json(
        { message: 'Cron job already running' },
        { status: 409 }
      );
    }

    // Get all active projects
    const { data: projects, error: projectsError } = await supabaseAdmin
      .from('projects')
      .select('id, repo_owner, repo_name, owner_id');

    if (projectsError || !projects) {
      return NextResponse.json(
        { error: 'Failed to fetch projects' },
        { status: 500 }
      );
    }

    const results = [];

    // 시스템 사용자 정보 가져오기
    const { getSystemUser, getSystemUserFromSupabase } = await import('@/lib/system-user');
    const systemUserConfig = getSystemUser();
    const systemUser = await getSystemUserFromSupabase();
    
    if (!systemUserConfig || !systemUserConfig.githubAccessToken || !systemUser) {
      return NextResponse.json(
        { error: '시스템 사용자 정보를 찾을 수 없습니다.' },
        { status: 500 }
      );
    }
    
    const accessToken = systemUserConfig.githubAccessToken;

    for (const project of projects) {
      // 시스템 사용자의 프로젝트만 처리
      if (project.owner_id !== systemUser.id) {
        continue;
      }
      
      try {

        // Get latest repository tree
        const tree = await getRepositoryTree(
          accessToken,
          project.repo_owner,
          project.repo_name
        );

        const mdFiles = tree.filter((item) => item.path?.endsWith('.md'));

        // Check for missing or outdated files
        const { data: dbFiles } = await supabaseAdmin
          .from('repo_files')
          .select('path, sha, is_current')
          .eq('project_id', project.id)
          .eq('is_current', true);

        const dbFileMap = new Map(
          dbFiles?.map((f) => [f.path, f.sha]) || []
        );

        let updatedCount = 0;

        for (const file of mdFiles) {
          if (!file.path || !file.sha) continue;

          const dbSha = dbFileMap.get(file.path);
          if (dbSha !== file.sha) {
            // File needs update
            try {
              const content = await getFileContent(
                accessToken,
                project.repo_owner,
                project.repo_name,
                file.path
              );

              // Upload to Storage
              const bucketPath = await uploadFileToStorage(project.id, file.sha, file.path, content);

              // Find or create repo_file
              // 트리거 함수에서 ON CONFLICT 처리하므로 insert 사용
              const { data: repoFile } = await supabaseAdmin
                .from('repo_files')
                .insert({
                  project_id: project.id,
                  path: file.path,
                  sha: file.sha,
                  size: content.length,
                  bucket_path: bucketPath,
                  is_current: true,
                })
                .select()
                .single();

              if (repoFile) {
                // Mark old chunks as not current
                await supabaseAdmin
                  .from('repo_file_chunks')
                  .update({ is_current: false })
                  .eq('repo_file_id', repoFile.id)
                  .eq('is_current', true);

                // Create new chunks
                const chunks = chunkText(content, file.path);
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
                  console.error(`Error inserting chunks for ${file.path}:`, chunksError);
                }

                updatedCount++;
              }
            } catch (error) {
              console.error(`Error updating file ${file.path}:`, error);
            }
          }
        }

        // Create snapshot
        const { data: progress } = await supabaseAdmin.rpc(
          'get_project_progress',
          {
            p_project_id: project.id,
          }
        );

        if (progress) {
          await supabaseAdmin.from('vibememory.project_phase_snapshots').insert({
            project_id: project.id,
            total_md: progress.P1?.total_md || 0,
            indexed_md: progress.P1?.indexed_md || 0,
            embedded_chunks: progress.P2?.embedded_chunks || 0,
            expected_chunks: progress.P2?.expected_chunks || 0,
            core_reviews_done: progress.P3?.core_done || 0,
            core_reviews_total: progress.P3?.core_total || 3,
            up_to_date_files: progress.P4?.up_to_date_files || 0,
          });
        }

        results.push({
          project_id: project.id,
          status: 'success',
          files_updated: updatedCount,
        });
      } catch (error) {
        console.error(`Error processing project ${project.id}:`, error);
        results.push({
          project_id: project.id,
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return NextResponse.json(
      {
        message: 'Sanity check completed',
        results,
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error in sanity check cron:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

