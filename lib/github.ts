import { Octokit } from '@octokit/rest';

export function createGitHubClient(accessToken: string) {
  return new Octokit({
    auth: accessToken,
  });
}

export async function getGitHubRepositories(accessToken: string) {
  const octokit = createGitHubClient(accessToken);
  const { data } = await octokit.repos.listForAuthenticatedUser({
    per_page: 100,
    sort: 'updated',
  });
  return data;
}

export async function createWebhook(
  accessToken: string,
  owner: string,
  repo: string,
  webhookUrl: string,
  webhookSecret: string
) {
  const octokit = createGitHubClient(accessToken);
  const { data } = await octokit.repos.createWebhook({
    owner,
    repo,
    config: {
      url: webhookUrl,
      content_type: 'json',
      secret: webhookSecret,
      insecure_ssl: '0',
    },
    events: ['push'],
    active: true,
  });
  return data;
}

export async function listWebhooks(
  accessToken: string,
  owner: string,
  repo: string
) {
  const octokit = createGitHubClient(accessToken);
  const { data } = await octokit.repos.listWebhooks({
    owner,
    repo,
  });
  return data;
}

export async function getRepositoryTree(
  accessToken: string,
  owner: string,
  repo: string,
  branch?: string
) {
  const octokit = createGitHubClient(accessToken);
  
  // 브랜치가 지정되지 않으면 기본 브랜치 가져오기
  if (!branch) {
    const { data: repoData } = await octokit.repos.get({
      owner,
      repo,
    });
    branch = repoData.default_branch || 'main';
  }
  
  // Get the latest commit SHA
  const { data: refData } = await octokit.git.getRef({
    owner,
    repo,
    ref: `heads/${branch}`,
  });
  
  const sha = refData.object.sha;
  
  // Get the tree recursively
  const { data: treeData } = await octokit.git.getTree({
    owner,
    repo,
    tree_sha: sha,
    recursive: '1',
  });
  
  // Check if tree was truncated (GitHub API limit: 100,000 entries)
  if (treeData.truncated) {
    console.warn(`[GITHUB] Repository tree was truncated. Total entries: ${treeData.tree.length}`);
    // TODO: Handle truncated trees by paginating or using alternative method
  }
  
  // Filter for .md files in memory_bank directory only
  const mdFiles = treeData.tree.filter(
    (item) => 
      item.type === 'blob' && 
      item.path?.endsWith('.md') &&
      item.path?.startsWith('memory_bank/')
  );
  
  console.log(`[GITHUB] Found ${mdFiles.length} .md files in memory_bank/ out of ${treeData.tree.length} total items`);
  if (mdFiles.length > 0) {
    console.log(`[GITHUB] MD file paths:`, mdFiles.map(f => f.path).join(', '));
  }
  
  return mdFiles;
}

export async function getFileContent(
  accessToken: string,
  owner: string,
  repo: string,
  path: string
): Promise<string> {
  const octokit = createGitHubClient(accessToken);
  const { data } = await octokit.repos.getContent({
    owner,
    repo,
    path,
  });
  
  if ('content' in data && data.encoding === 'base64') {
    return Buffer.from(data.content, 'base64').toString('utf-8');
  }
  
  throw new Error('Invalid file content');
}

/**
 * GitHub API 재시도 유틸리티 (지수 백오프)
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      
      // 429 (Rate Limit) 또는 5xx 에러만 재시도
      const statusCode = error?.status || error?.response?.status;
      if (statusCode && (statusCode === 429 || (statusCode >= 500 && statusCode < 600))) {
        if (attempt < maxAttempts - 1) {
          // 지수 백오프: 1s, 2s, 4s...
          const delay = baseDelay * Math.pow(2, attempt);
          console.warn(`[GITHUB] API error ${statusCode}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxAttempts})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
      }
      
      // 재시도 불가능한 에러 또는 최대 재시도 횟수 초과
      throw error;
    }
  }
  
  throw lastError || new Error('Unknown error');
}

/**
 * 파일 내용과 SHA를 함께 가져오기 (재시도 포함)
 */
export async function getFileContentWithSha(
  accessToken: string,
  owner: string,
  repo: string,
  path: string
): Promise<{ content: string; sha: string }> {
  return withRetry(async () => {
    const octokit = createGitHubClient(accessToken);
    const { data } = await octokit.repos.getContent({
      owner,
      repo,
      path,
    });
    
    if ('content' in data && data.encoding === 'base64' && 'sha' in data) {
      return {
        content: Buffer.from(data.content, 'base64').toString('utf-8'),
        sha: data.sha,
      };
    }
    
    throw new Error('Invalid file content');
  });
}

/**
 * 저장소의 커밋 히스토리 가져오기
 */
export async function getRepositoryCommits(
  accessToken: string,
  owner: string,
  repo: string,
  perPage: number = 30
) {
  const octokit = createGitHubClient(accessToken);
  const { data } = await octokit.repos.listCommits({
    owner,
    repo,
    per_page: perPage,
  });
  return data;
}

/**
 * 저장소 기본 정보 가져오기
 */
export async function getRepositoryInfo(
  accessToken: string,
  owner: string,
  repo: string
) {
  const octokit = createGitHubClient(accessToken);
  const { data } = await octokit.repos.get({
    owner,
    repo,
  });
  return data;
}

/**
 * Compare API로 변경 파일 목록 가져오기 (재시도 포함)
 * push 이벤트의 before/after SHA를 사용하여 정확한 변경 파일 목록을 얻습니다.
 */
export async function getChangedFilesFromCompare(
  accessToken: string,
  owner: string,
  repo: string,
  baseSha: string,
  headSha: string
): Promise<{
  modified: string[];
  added: string[];
  removed: string[];
}> {
  return withRetry(async () => {
    const octokit = createGitHubClient(accessToken);
    const { data } = await octokit.repos.compareCommits({
      owner,
      repo,
      base: baseSha,
      head: headSha,
    });

    const modified: string[] = [];
    const added: string[] = [];
    const removed: string[] = [];

    // files 배열에서 변경 유형별로 분류
    if (data.files) {
      for (const file of data.files) {
        // .md 파일만 필터링
        if (!file.filename?.endsWith('.md')) {
          continue;
        }

        if (file.status === 'modified') {
          modified.push(file.filename);
        } else if (file.status === 'added') {
          added.push(file.filename);
        } else if (file.status === 'removed') {
          removed.push(file.filename);
        } else if (file.status === 'renamed' && file.previous_filename) {
          // renamed는 이전 파일을 removed, 새 파일을 added로 처리
          if (file.previous_filename.endsWith('.md')) {
            removed.push(file.previous_filename);
          }
          if (file.filename.endsWith('.md')) {
            added.push(file.filename);
          }
        }
      }
    }

    return {
      modified: [...new Set(modified)], // 중복 제거
      added: [...new Set(added)],
      removed: [...new Set(removed)],
    };
  });
}

