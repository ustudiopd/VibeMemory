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
  
  return treeData.tree.filter((item) => item.path?.endsWith('.md'));
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
 * 파일 내용과 SHA를 함께 가져오기
 */
export async function getFileContentWithSha(
  accessToken: string,
  owner: string,
  repo: string,
  path: string
): Promise<{ content: string; sha: string }> {
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

