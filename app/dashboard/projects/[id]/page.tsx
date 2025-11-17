'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import ChatInterface from '@/components/ChatInterface';
import SessionSidebar from '@/components/SessionSidebar';
import ProgressBanner from '@/components/ProgressBanner';
import FileListPane from '@/components/FileListPane';
import ScreenshotGallery from '@/components/ScreenshotGallery';
import IdeaNoteTab from '@/components/IdeaNoteTab';

interface Progress {
  P0: { webhook_configured: boolean };
  P1: { total_md: number; indexed_md: number; progress: number };
  P2: { embedded_chunks: number; expected_chunks: number; progress: number };
  P3: { core_done: number; core_total: number; progress: number };
  P4: { up_to_date_files: number; total_md: number; progress: number };
  P5: { has_release_note: boolean };
}

interface ProjectAnalysis {
  idea_review: string | null;
  tech_review: string | null;
  patent_review: string | null;
  project_overview: string | null;
  latest_release_note: string | null;
}

interface ProjectOverview {
  overview: string;
  source_file: string | null;
}

type TabType = 'overview' | 'idea' | 'progress' | 'chat';

export default function ProjectDetailPage() {
  const params = useParams();
  const projectId = params.id as string;
  const [project, setProject] = useState<any>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [analysis, setAnalysis] = useState<ProjectAnalysis | null>(null);
  const [overview, setOverview] = useState<ProjectOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({
    project_name: '',
    description: '',
    tech_spec: '',
    deployment_url: '',
    repository_url: '',
    documentation_url: '',
  });
  const [saving, setSaving] = useState(false);
  const [expandedSections, setExpandedSections] = useState<{
    idea: boolean;
    tech: boolean;
    patent: boolean;
    overview: boolean;
    versionHistory: boolean;
    techSpec: boolean;
  }>({
    idea: true,
    tech: false,
    patent: false,
    overview: true,
    versionHistory: false,
    techSpec: false, // 기술 스펙은 기본적으로 접힘
  });
  const [commits, setCommits] = useState<any[]>([]);
  const [loadingCommits, setLoadingCommits] = useState(false);
  const [comments, setComments] = useState<any[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false); // 사이드바 기본 닫힘
  const [generatingTechSpec, setGeneratingTechSpec] = useState(false); // 기술 스펙 생성 중

  useEffect(() => {
    // 모바일 여부 감지
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768); // md breakpoint
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    if (projectId) {
      loadProjectData();
    }
  }, [projectId]);

  // 프로젝트 데이터 로드 (순차적으로 실행)
  const loadProjectData = async () => {
    setLoading(true);
    try {
      // 1. 기본 프로젝트 정보 로드
      await fetchProject();
      // 2. 상세 정보 로드 (기본 정보가 로드된 후)
      await fetchProjectDetails();
      // 3. 나머지 데이터는 병렬로 로드
      // project 상태는 비동기적으로 업데이트되므로, 
      // 약간의 지연 후 확인하거나 fetchProject에서 반환된 정보를 사용
      // 여기서는 간단하게 모든 데이터를 로드하고, 각 함수 내에서 project_type을 확인하도록 함
      Promise.all([
        fetchAnalysis(),
        fetchCommits(),
        fetchComments(),
      ]).catch((error) => {
        console.error('[PROJECT DETAIL] Error loading additional data:', error);
      });
    } catch (error) {
      console.error('[PROJECT DETAIL] Error loading project data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchCommits = async () => {
    setLoadingCommits(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/commits?per_page=30`);
      if (response.ok) {
        const data = await response.json();
        setCommits(data.commits || []);
      }
    } catch (error) {
      console.error('Error fetching commits:', error);
    } finally {
      setLoadingCommits(false);
    }
  };

  const fetchComments = async () => {
    setLoadingComments(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/comments`);
      if (response.ok) {
        const data = await response.json();
        setComments(data.comments || []);
      }
    } catch (error) {
      console.error('Error fetching comments:', error);
    } finally {
      setLoadingComments(false);
    }
  };

  const handleSubmitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim() || submittingComment) return;

    setSubmittingComment(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: newComment }),
      });

      if (response.ok) {
        const data = await response.json();
        setComments([data.comment, ...comments]);
        setNewComment('');
      } else {
        const errorData = await response.json();
        alert(`댓글 작성에 실패했습니다: ${errorData.error || '알 수 없는 오류'}`);
      }
    } catch (error) {
      console.error('Error submitting comment:', error);
      alert('댓글 작성 중 오류가 발생했습니다.');
    } finally {
      setSubmittingComment(false);
    }
  };

  const loadGitHubInfo = async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/github-info`);
      if (response.ok) {
        const data = await response.json();
        setEditData((prev) => ({
          ...prev,
          project_name: data.name || prev.project_name || '',
          description: data.description || prev.description || '',
          repository_url: data.html_url || prev.repository_url || '',
          deployment_url: data.homepage || prev.deployment_url || '',
        }));
        alert('GitHub 정보를 불러왔습니다.');
      } else {
        const errorData = await response.json();
        alert(`GitHub 정보를 불러오는데 실패했습니다: ${errorData.error || '알 수 없는 오류'}`);
      }
    } catch (error) {
      console.error('Error loading GitHub info:', error);
      alert('GitHub 정보를 불러오는 중 오류가 발생했습니다.');
    }
  };

  const fetchProject = async () => {
    try {
      console.log('[PROJECT DETAIL] Fetching project:', projectId);
      const response = await fetch(`/api/projects`);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('[PROJECT DETAIL] Failed to fetch projects:', response.status, errorData);
        throw new Error(`프로젝트 목록을 불러오는데 실패했습니다: ${errorData.error || response.statusText}`);
      }
      const data = await response.json();
      const foundProject = data.projects?.find((p: any) => p.id === projectId);
      if (foundProject) {
        console.log('[PROJECT DETAIL] Project found:', foundProject.project_name || foundProject.repo_name);
        setProject(foundProject);
        // 편집 데이터 초기화
        setEditData({
          project_name: foundProject.project_name || foundProject.repo_name || '',
          description: foundProject.description || '',
          tech_spec: foundProject.tech_spec || '',
          deployment_url: foundProject.deployment_url || '',
          repository_url: foundProject.repository_url || foundProject.repo_url || '',
          documentation_url: foundProject.documentation_url || '',
        });
      } else {
        console.warn('[PROJECT DETAIL] Project not found in list:', projectId);
        throw new Error('프로젝트를 찾을 수 없습니다.');
      }
    } catch (error) {
      console.error('[PROJECT DETAIL] Error fetching project:', error);
      throw error; // 상위 함수에서 처리하도록 에러 전파
    }
  };

  const fetchProjectDetails = async () => {
    try {
      console.log('[PROJECT DETAIL] Fetching project details:', projectId);
      const response = await fetch(`/api/projects/${projectId}/overview-edit`);
      if (!response.ok) {
        // 404는 정상일 수 있음 (프로젝트가 없거나 권한이 없는 경우)
        // 에러는 로그만 남기고 계속 진행
        if (response.status === 404) {
          console.warn('[PROJECT DETAIL] Project details not found (404):', projectId);
          return;
        }
        const errorData = await response.json().catch(() => ({}));
        console.error('[PROJECT DETAIL] Failed to fetch project details:', response.status, errorData);
        return;
      }
      const data = await response.json();
      if (data.project) {
        console.log('[PROJECT DETAIL] Project details loaded');
        // 이전 프로젝트 데이터와 병합 (null 체크)
        setProject((prev: any) => {
          if (!prev) {
            // 이전 데이터가 없으면 새로 설정
            return data.project;
          }
          // 이전 데이터가 있으면 병합
          return { ...prev, ...data.project };
        });
        setEditData((prev) => ({
          ...prev,
          project_name: data.project.project_name || data.project.repo_name || prev.project_name || '',
          description: data.project.description || prev.description || '',
          tech_spec: data.project.tech_spec || prev.tech_spec || '',
          deployment_url: data.project.deployment_url || prev.deployment_url || '',
          repository_url: data.project.repository_url || data.project.repo_url || prev.repository_url || '',
          documentation_url: data.project.documentation_url || prev.documentation_url || '',
        }));
      }
    } catch (error) {
      console.error('[PROJECT DETAIL] Error fetching project details:', error);
      // 상세 정보가 없을 수 있으므로 에러는 로그만 남김
    }
  };

  // 기술 스펙 자동 생성 함수
  const handleGenerateTechSpec = async () => {
    if (!analysis?.tech_review) {
      alert('기술 리뷰가 아직 생성되지 않았습니다.');
      return;
    }

    setGeneratingTechSpec(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/tech-spec/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      // Content-Type 확인 후 JSON 파싱
      const contentType = response.headers.get('content-type');
      let data;
      
      if (contentType && contentType.includes('application/json')) {
        data = await response.json();
      } else {
        // JSON이 아닌 경우 (504 에러 등)
        const text = await response.text();
        throw new Error(
          response.status === 504
            ? '요청 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.'
            : `서버 오류 (${response.status}): ${text.substring(0, 100)}`
        );
      }

      if (!response.ok) {
        throw new Error(data.error || data.details || '기술 스펙 생성에 실패했습니다.');
      }

      if (data.success && data.tech_spec) {
        setEditData({ ...editData, tech_spec: data.tech_spec });
        alert('기술 스펙이 생성되었습니다.');
      } else {
        throw new Error('기술 스펙 생성 결과가 올바르지 않습니다.');
      }
    } catch (error) {
      console.error('Error generating tech spec:', error);
      if (error instanceof SyntaxError) {
        alert('서버 응답을 파싱할 수 없습니다. 서버가 타임아웃되었을 수 있습니다. 잠시 후 다시 시도해주세요.');
      } else {
        alert(error instanceof Error ? error.message : '기술 스펙 생성에 실패했습니다.');
      }
    } finally {
      setGeneratingTechSpec(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/overview-edit`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(editData),
      });

      if (response.ok) {
        const data = await response.json();
        setProject((prev: any) => ({ ...prev, ...data.project }));
        setIsEditing(false);
        alert('저장되었습니다.');
      } else {
        const errorData = await response.json();
        alert(`저장에 실패했습니다: ${errorData.error || '알 수 없는 오류'}`);
      }
    } catch (error) {
      console.error('Error saving project:', error);
      alert('저장 중 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const fetchProgress = async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/progress`);
      if (response.ok) {
        const data = await response.json();
        setProgress(data);
      }
    } catch (error) {
      console.error('Error fetching progress:', error);
    }
  };

  const fetchAnalysis = async () => {
    try {
      console.log('[PROJECT DETAIL] Fetching analysis:', projectId);
      const response = await fetch(`/api/projects/${projectId}/analysis`);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('[PROJECT DETAIL] Failed to fetch analysis:', response.status, errorData);
        // 분석 데이터가 없을 수 있으므로 에러는 로그만 남김
        return;
      }
      const data = await response.json();
      console.log('[PROJECT DETAIL] Analysis data:', data.analysis ? 'Found' : 'Not found');
      setAnalysis(data.analysis);
      
      // 프로젝트 개요도 함께 설정 (project_analysis 테이블에 저장됨)
      if (data.analysis?.project_overview) {
        setOverview({
          overview: data.analysis.project_overview,
          source_file: null,
        });
      }
    } catch (error) {
      console.error('[PROJECT DETAIL] Error fetching analysis:', error);
      // 분석 데이터가 없을 수 있으므로 에러는 로그만 남김
    }
  };

  const handleRescan = async () => {
    if (confirm('재스캔을 시작하시겠습니까?')) {
      try {
        const response = await fetch(`/api/projects/${projectId}/rescan`, {
          method: 'POST',
        });
        if (response.ok) {
          alert('재스캔이 시작되었습니다.');
          window.location.reload();
        } else {
          const data = await response.json();
          alert(data.error || '재스캔에 실패했습니다.');
        }
      } catch (error) {
        console.error('Error triggering rescan:', error);
        alert('재스캔 요청 중 오류가 발생했습니다.');
      }
    }
  };

  // Markdown 형식의 텍스트를 HTML로 변환하는 함수
  const formatMarkdown = (text: string) => {
    if (!text) return '';
    
    let html = text;
    
    // 마크다운 테이블 처리 (개선된 버전)
    // 테이블 패턴: 헤더 행 | 구분선 | 데이터 행들
    const lines = html.split('\n');
    const processedLines: string[] = [];
    let i = 0;
    
    while (i < lines.length) {
      const line = lines[i];
      
      // 테이블 시작 감지 (|로 시작하고 끝나는 행)
      if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
        const tableLines: string[] = [line];
        let j = i + 1;
        
        // 구분선 확인
        if (j < lines.length && lines[j].trim().match(/^\|[\s\-:|]+\|$/)) {
          tableLines.push(lines[j]);
          j++;
          
          // 데이터 행들 수집
          while (j < lines.length && lines[j].trim().startsWith('|') && lines[j].trim().endsWith('|')) {
            tableLines.push(lines[j]);
            j++;
          }
          
          // 테이블이 최소 3줄(헤더, 구분선, 데이터) 이상이면 변환
          if (tableLines.length >= 3) {
            const headerLine = tableLines[0];
            const dataLines = tableLines.slice(2);
            
            // 헤더 파싱
            const headers = headerLine.split('|')
              .map(cell => cell.trim())
              .filter(cell => cell.length > 0);
            
            if (headers.length > 0) {
              // 테이블 HTML 생성
              let tableHtml = '<div class="overflow-x-auto my-6"><table class="min-w-full divide-y divide-gray-200 border border-gray-300 rounded-lg shadow-sm">';
              
              // 헤더
              tableHtml += '<thead class="bg-gray-50">';
              tableHtml += '<tr>';
              headers.forEach(header => {
                tableHtml += `<th class="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider border-b border-gray-300">${header}</th>`;
              });
              tableHtml += '</tr>';
              tableHtml += '</thead>';
              
              // 바디
              tableHtml += '<tbody class="bg-white divide-y divide-gray-200">';
              dataLines.forEach((dataLine, rowIndex) => {
                const cells = dataLine.split('|')
                  .map(cell => cell.trim())
                  .filter(cell => cell.length > 0);
                
                if (cells.length === headers.length) {
                  const isEven = rowIndex % 2 === 0;
                  tableHtml += `<tr class="${isEven ? 'bg-white' : 'bg-gray-50'} hover:bg-blue-50 transition-colors">`;
                  cells.forEach((cell, cellIndex) => {
                    const isFirst = cellIndex === 0;
                    tableHtml += `<td class="px-4 py-3 text-sm text-gray-700 ${isFirst ? 'font-medium text-gray-900' : ''} border-b border-gray-200">${cell}</td>`;
                  });
                  tableHtml += '</tr>';
                }
              });
              tableHtml += '</tbody>';
              tableHtml += '</table></div>';
              
              processedLines.push(tableHtml);
              i = j;
              continue;
            }
          }
        }
      }
      
      processedLines.push(line);
      i++;
    }
    
    html = processedLines.join('\n');
    
    // 나머지 마크다운 처리
    html = html
      .replace(/^### (.*$)/gim, '<h3 class="text-lg font-semibold text-gray-900 mt-6 mb-3">$1</h3>')
      .replace(/^## (.*$)/gim, '<h2 class="text-xl font-bold text-gray-900 mt-8 mb-4">$1</h2>')
      .replace(/^# (.*$)/gim, '<h1 class="text-2xl font-bold text-gray-900 mt-8 mb-4">$1</h1>')
      .replace(/\*\*(.*?)\*\*/gim, '<strong class="font-semibold text-gray-900">$1</strong>')
      .replace(/\*(.*?)\*/gim, '<em class="italic text-gray-700">$1</em>')
      .replace(/^- (.*$)/gim, '<li class="ml-4 mb-2">$1</li>')
      // 숫자 리스트 처리
      .replace(/^\d+\.\s+(.*$)/gim, '<li class="ml-4 mb-2 list-decimal">$1</li>')
      // 문단 구분 개선 (빈 줄 2개 이상을 문단 구분으로)
      .replace(/\n\n+/gim, '</p><p class="mb-4 text-gray-700 leading-relaxed">')
      .replace(/\n/gim, '<br>')
      .replace(/^<p/, '<p class="mb-4 text-gray-700 leading-relaxed"')
      .replace(/<li/gim, '<li class="ml-6 mb-2 list-disc"')
      // 문단 시작/끝 부분 정리
      .replace(/^<p class="mb-4 text-gray-700 leading-relaxed">\s*<br>\s*/gim, '<p class="mb-4 text-gray-700 leading-relaxed">')
      .replace(/<br>\s*<\/p>/gim, '</p>');
    
    return html;
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-slate-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">로딩 중...</p>
        </div>
      </div>
    );
  }

  const tabs = [
    // project_type에 따라 탭 목록 동적 생성
    ...(project?.project_type === 'idea'
      ? [
          { id: 'overview' as TabType, label: '개요', icon: '📋' },
          { id: 'idea' as TabType, label: '아이디어 노트', icon: '💡' },
          { id: 'chat' as TabType, label: '챗봇', icon: '💬' },
        ]
      : [
          { id: 'overview' as TabType, label: '개요', icon: '📋' },
          { id: 'idea' as TabType, label: 'AI 분석 결과', icon: '🤖' },
          { id: 'progress' as TabType, label: '진행 및 파일 목록', icon: '📊' },
          { id: 'chat' as TabType, label: '챗봇', icon: '💬' },
        ]),
  ];

  // 모바일 탭 제목 매핑
  const getMobileTabTitle = (tabId: TabType) => {
    const tab = tabs.find(t => t.id === tabId);
    return tab ? tab.label : '';
  };

  // 프로젝트 개요 가져오기
  const getProjectOverview = () => {
    // analysis에서 project_overview를 우선 확인
    if (analysis?.project_overview && analysis.project_overview.trim().length > 0) {
      return analysis.project_overview;
    }
    // overview state에서 확인 (하위 호환성)
    if (overview?.overview && overview.overview.trim().length > 0) {
      return overview.overview;
    }
    // 로딩 중이거나 데이터가 없을 때
    if (analysis === null) {
      return '프로젝트 개요를 불러오는 중...';
    }
    return `${project?.repo_name || '이 프로젝트'}는 ${project?.repo_owner || ''}에서 개발 중인 프로젝트입니다.`;
  };

  const toggleSection = (section: 'idea' | 'tech' | 'patent') => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  return (
    <div className={`min-h-screen bg-gray-50 ${activeTab === 'chat' && isMobile ? 'pb-32' : activeTab === 'chat' ? 'pb-0' : 'pb-20 md:pb-0'}`}>
      {/* 데스크톱 네비게이션 */}
      <nav className="hidden md:block bg-white shadow">
        <div className="mx-auto px-4 sm:px-6 lg:px-8" style={{ maxWidth: '1600px' }}>
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <Link href="/dashboard" className="text-xl font-bold text-gray-900">
                VibeMemory
              </Link>
            </div>
            <div className="flex items-center space-x-4">
              <Link
                href="/dashboard"
                className="text-sm text-gray-600 hover:text-gray-900"
              >
                ← 대시보드로 돌아가기
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* 모바일 헤더 */}
      <nav className="md:hidden bg-white shadow-sm border-b border-gray-200">
        <div className="px-3 py-2.5">
          <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0">
              <h1 className="text-base font-semibold text-gray-900 truncate">
                {project?.project_name || project?.repo_name || '프로젝트'} | {tabs.find(t => t.id === activeTab)?.icon} {getMobileTabTitle(activeTab)}
              </h1>
            </div>
            {/* 모바일 챗봇 탭에서만 목록 버튼 표시 */}
            {activeTab === 'chat' && (
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="ml-2 px-0 py-0 bg-transparent hover:opacity-70 transition-opacity flex items-center gap-1 flex-shrink-0"
                title={sidebarOpen ? '대화 목록 닫기' : '대화 목록 열기'}
              >
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 6h16M4 12h16M4 18h16"
                  />
                </svg>
                <span className="text-sm font-medium">목록</span>
              </button>
            )}
          </div>
        </div>
      </nav>

      <main className="mx-auto py-6 sm:px-6 lg:px-8" style={{ maxWidth: '1600px' }}>
        <div className="px-2 md:px-4 py-2 md:py-6 sm:px-0">
          {/* 데스크톱 헤더 */}
          <div className="hidden md:block mb-6">
            <h2 className="text-2xl font-bold text-gray-900">
              {project?.repo_name || '프로젝트'}
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              {project?.repo_owner || ''}
            </p>
          </div>

          {/* 탭 네비게이션 - 데스크톱 */}
          <div className="hidden md:block bg-white rounded-t-lg shadow-sm border-b border-gray-200">
            <div className="flex space-x-1 px-4">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`
                    px-6 py-4 text-sm font-medium transition-colors relative
                    ${activeTab === tab.id
                      ? 'text-blue-600 border-b-2 border-blue-600'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                    }
                  `}
                >
                  <span className="mr-2">{tab.icon}</span>
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* 탭 네비게이션 - 모바일 (하단 고정, 데스크톱에서는 숨김) */}
          <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg z-50 safe-bottom">
            <div className="flex justify-around items-center h-16">
              {/* 홈 버튼 */}
              <Link
                href="/dashboard"
                className="flex flex-col items-center justify-center flex-1 h-full transition-colors duration-200 min-h-[44px] touch-manipulation text-gray-600 active:bg-gray-100"
                aria-label="대시보드로 돌아가기"
              >
                <span className="text-2xl">🏠</span>
              </Link>
              {/* 탭 버튼들 (아이콘만) */}
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`
                    flex flex-col items-center justify-center flex-1 h-full
                    transition-colors duration-200 min-h-[44px] touch-manipulation
                    ${activeTab === tab.id
                      ? 'text-blue-600'
                      : 'text-gray-600 active:bg-gray-100'
                    }
                  `}
                  aria-label={tab.label}
                >
                  <span className="text-2xl">{tab.icon}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 탭 컨텐츠 */}
          <div className={`bg-white rounded-b-lg shadow ${activeTab !== 'chat' ? 'md:pb-0 pb-20' : ''}`}>
            {/* 개요 탭 */}
            {activeTab === 'overview' && (
              <div className="p-0 md:p-6 flex flex-col min-h-full">
                <div className="mb-3 md:mb-6 flex justify-between items-center px-3 md:px-0">
                  <h2 className="hidden md:block text-xl md:text-2xl font-bold text-gray-900">프로젝트 개요</h2>
                  {!isEditing ? (
                    <button
                      onClick={() => setIsEditing(true)}
                      className="ml-auto md:ml-0 px-2 py-1.5 md:px-4 md:py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-900 transition-colors text-xs md:text-sm font-medium min-h-[36px] md:min-h-[44px] touch-manipulation"
                    >
                      <span className="text-sm md:text-base">✏️</span>
                      <span className="ml-1 hidden md:inline">편집</span>
                    </button>
                  ) : (
                    <div className="hidden md:flex gap-2">
                      <button
                        onClick={() => {
                          setIsEditing(false);
                          // 편집 취소 시 원래 데이터로 복원
                          fetchProjectDetails();
                        }}
                        className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors text-sm font-medium min-h-[44px] touch-manipulation"
                      >
                        취소
                      </button>
                      <button
                        onClick={handleSave}
                        disabled={saving}
                        className="px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-900 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px] touch-manipulation"
                      >
                        <span className="text-base">💾</span>
                        <span className="ml-1">{saving ? '저장 중...' : '저장'}</span>
                      </button>
                    </div>
                  )}
                </div>

                {isEditing ? (
                  <div className="space-y-4 md:space-y-6 flex-1">
                    {/* GitHub 정보 불러오기 버튼 */}
                    <div className="bg-white border-x-0 md:border border-gray-200 rounded-none md:rounded-lg p-3 md:p-4">
                      <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-3 md:gap-0">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900">GitHub에서 기본 정보 불러오기</p>
                          <p className="text-xs text-gray-600 mt-1 break-words">저장소 이름, 설명, URL 등을 자동으로 채웁니다.</p>
                        </div>
                        <button
                          type="button"
                          onClick={loadGitHubInfo}
                          className="w-full md:w-auto flex-shrink-0 px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-900 active:bg-gray-950 transition-colors text-sm font-medium min-h-[44px] touch-manipulation flex items-center justify-center gap-2 whitespace-nowrap"
                        >
                          <span>🔄</span>
                          <span>불러오기</span>
                        </button>
                      </div>
                    </div>

                    {/* 프로젝트 이름 */}
                    <div className="px-3 md:px-0">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        프로젝트 이름 *
                      </label>
                      <input
                        type="text"
                        value={editData.project_name}
                        onChange={(e) => setEditData({ ...editData, project_name: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="프로젝트 이름을 입력하세요"
                      />
                    </div>

                    {/* 프로젝트 소개 */}
                    <div className="px-3 md:px-0">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        프로젝트 소개
                      </label>
                      <textarea
                        value={editData.description}
                        onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                        rows={6}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="프로젝트에 대한 소개를 입력하세요"
                      />
                    </div>

                    {/* 기술 스펙 */}
                    <div className="px-3 md:px-0">
                      <div className="flex justify-between items-center mb-2">
                        <label className="block text-sm font-medium text-gray-700">
                          기술 스펙
                        </label>
                        {analysis?.tech_review && (
                          <button
                            type="button"
                            onClick={handleGenerateTechSpec}
                            disabled={generatingTechSpec}
                            className="text-xs text-blue-600 hover:text-blue-800 underline disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                          >
                            {generatingTechSpec ? (
                              <>
                                <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-600"></div>
                                생성 중...
                              </>
                            ) : (
                              '🔍 기술 리뷰에서 불러오기'
                            )}
                          </button>
                        )}
                      </div>
                      <textarea
                        value={editData.tech_spec}
                        onChange={(e) => setEditData({ ...editData, tech_spec: e.target.value })}
                        rows={8}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
                        placeholder="사용된 기술 스택, 프레임워크, 라이브러리 등을 입력하세요&#10;예: Next.js 15, React 18, TypeScript, Supabase, Tailwind CSS"
                      />
                      <p className="mt-2 text-xs text-gray-500">
                        💡 기술 리뷰에서 자동으로 추출된 정보를 참고할 수 있습니다.
                      </p>
                    </div>

                    {/* 실행 URL */}
                    <div className="px-3 md:px-0">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        실행 URL (Deployment URL)
                      </label>
                      <input
                        type="url"
                        value={editData.deployment_url}
                        onChange={(e) => setEditData({ ...editData, deployment_url: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="https://your-project.vercel.app"
                      />
                    </div>

                    {/* 저장소 URL */}
                    <div className="px-3 md:px-0">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        저장소 URL
                      </label>
                      <input
                        type="url"
                        value={editData.repository_url}
                        onChange={(e) => setEditData({ ...editData, repository_url: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="https://github.com/owner/repo"
                      />
                    </div>

                    {/* 문서 URL */}
                    <div className="px-3 md:px-0">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        문서 URL (선택)
                      </label>
                      <input
                        type="url"
                        value={editData.documentation_url}
                        onChange={(e) => setEditData({ ...editData, documentation_url: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="https://docs.example.com"
                      />
                    </div>

                    {/* 취소/저장 버튼 */}
                    <div className="px-3 md:px-0 pt-4 pb-4 md:pb-0">
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            setIsEditing(false);
                            fetchProjectDetails();
                          }}
                          className="flex-1 px-4 py-3 bg-gray-500 text-white rounded-lg hover:bg-gray-600 active:bg-gray-700 transition-colors text-sm font-medium min-h-[44px] touch-manipulation"
                        >
                          취소
                        </button>
                        <button
                          onClick={handleSave}
                          disabled={saving}
                          className="flex-1 px-4 py-3 bg-gray-800 text-white rounded-lg hover:bg-gray-900 active:bg-gray-950 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px] touch-manipulation"
                        >
                          {saving ? '저장 중...' : '💾 저장'}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4 md:space-y-6">
                    {/* 프로젝트 기본 정보 */}
                    <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-none md:rounded-lg p-4 md:p-6 border-x-0 md:border border-blue-100">
                      <h3 className="text-lg font-semibold text-gray-900 mb-4">기본 정보</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <span className="text-sm font-medium text-gray-600">프로젝트 이름</span>
                          <p className="text-lg font-semibold text-gray-900 mt-1">
                            {project?.project_name || project?.repo_name || '-'}
                          </p>
                        </div>
                        <div>
                          <span className="text-sm font-medium text-gray-600">저장소</span>
                          <p className="text-lg text-gray-900 mt-1">
                            {project?.repository_url ? (
                              <a
                                href={project.repository_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:underline"
                              >
                                {project.repo_owner}/{project.repo_name}
                              </a>
                            ) : (
                              `${project?.repo_owner || ''}/${project?.repo_name || ''}`
                            )}
                          </p>
                        </div>
                        {project?.deployment_url && (
                          <div>
                            <span className="text-sm font-medium text-gray-600">실행 URL</span>
                            <p className="text-lg text-gray-900 mt-1">
                              <a
                                href={project.deployment_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:underline"
                              >
                                {project.deployment_url}
                              </a>
                            </p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* 프로젝트 소개 */}
                    {project?.description && (
                      <div className="bg-white rounded-none md:rounded-lg p-4 md:p-6 border-x-0 md:border border-gray-200">
                        <h3 className="text-lg font-semibold text-gray-900 mb-4">프로젝트 소개</h3>
                        <div
                          className="prose prose-lg max-w-none text-gray-700"
                          dangerouslySetInnerHTML={{ __html: formatMarkdown(project.description) }}
                        />
                      </div>
                    )}

                    {/* 댓글 섹션 */}
                    <div className="bg-white rounded-none md:rounded-lg p-4 md:p-6 border-x-0 md:border border-gray-200">
                      <h3 className="text-lg font-semibold text-gray-900 mb-4">댓글</h3>
                      
                      {/* 댓글 작성 폼 */}
                      <form onSubmit={handleSubmitComment} className="mb-6">
                        <textarea
                          value={newComment}
                          onChange={(e) => setNewComment(e.target.value)}
                          placeholder="댓글을 입력하세요..."
                          rows={3}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-slate-500"
                          disabled={submittingComment}
                        />
                        <div className="mt-2 flex justify-end">
                          <button
                            type="submit"
                            disabled={!newComment.trim() || submittingComment}
                            className="px-4 py-2 text-sm font-medium text-white bg-slate-600 rounded-md hover:bg-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {submittingComment ? '작성 중...' : '댓글 작성'}
                          </button>
                        </div>
                      </form>

                      {/* 댓글 목록 */}
                      {loadingComments ? (
                        <div className="text-center py-4">
                          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-slate-600 mx-auto"></div>
                          <p className="mt-2 text-sm text-gray-600">댓글을 불러오는 중...</p>
                        </div>
                      ) : comments.length === 0 ? (
                        <p className="text-sm text-gray-500 text-center py-4">아직 댓글이 없습니다.</p>
                      ) : (
                        <div className="space-y-4">
                          {comments.map((comment) => (
                            <div key={comment.id} className="border-b border-gray-200 pb-4 last:border-b-0 last:pb-0">
                              <div className="flex items-start justify-between mb-2">
                                <div className="flex-1">
                                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{comment.content}</p>
                                </div>
                              </div>
                              <p className="text-xs text-gray-500">
                                {new Date(comment.created_at).toLocaleString('ko-KR', {
                                  year: 'numeric',
                                  month: 'long',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* 기술 스펙 - 아코디언 */}
                    {project?.tech_spec && (
                      <div className="bg-white rounded-none md:rounded-lg border-x-0 md:border border-gray-200">
                        <button
                          type="button"
                          onClick={() => setExpandedSections(prev => ({ ...prev, techSpec: !prev.techSpec }))}
                          className="w-full px-4 md:px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
                        >
                          <h3 className="text-base md:text-xl font-bold text-gray-900">기술 스펙</h3>
                          <svg
                            className={`w-5 h-5 text-gray-500 transition-transform ${expandedSections.techSpec ? 'transform rotate-180' : ''}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                        {expandedSections.techSpec && (
                          <div className="px-4 md:px-6 pb-4 md:pb-6 border-t border-gray-200">
                            <div
                              className="prose prose-lg max-w-none text-gray-700 font-mono text-sm whitespace-pre-wrap mt-4"
                              dangerouslySetInnerHTML={{ __html: formatMarkdown(project.tech_spec) }}
                            />
                          </div>
                        )}
                      </div>
                    )}

                    {/* 스크린샷 갤러리 */}
                    <div className="bg-white rounded-none md:rounded-lg p-4 md:p-6 border-x-0 md:border border-gray-200">
                      <ScreenshotGallery projectId={projectId} />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* AI 분석 결과 탭 또는 아이디어 노트 탭 */}
            {activeTab === 'idea' && (
              <div className="p-0 md:p-6">
                {project?.project_type === 'idea' ? (
                  // 아이디어 프로젝트: 아이디어 노트 탭
                  <IdeaNoteTab projectId={projectId} />
                ) : (
                  // GitHub 프로젝트: AI 분석 결과 탭
                  <>
                    <div className="mb-4 md:mb-6 hidden md:block">
                      <h2 className="text-xl md:text-2xl font-bold text-gray-900 mb-2">🤖 AI 분석 결과</h2>
                      <p className="text-xs md:text-sm text-gray-600 mb-4">
                        프로젝트의 아이디어, 기술, 특허 가능성을 AI가 분석한 결과입니다.
                      </p>
                    </div>

                <div className="space-y-2 md:space-y-4">
                  {/* 프로젝트 개요 - 아코디언 */}
                  <div className="bg-gradient-to-r from-slate-50 to-gray-50 rounded-none md:rounded-xl border-x-0 md:border border-gray-200 overflow-hidden">
                    <button
                      onClick={() => setExpandedSections(prev => ({ ...prev, overview: !prev.overview }))}
                      className="w-full px-3 md:px-6 py-4 md:py-5 flex items-center justify-between hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-center">
                        <span className="text-xl md:text-2xl mr-2 md:mr-3">📋</span>
                        <h3 className="text-base md:text-xl font-bold text-gray-900">프로젝트 개요</h3>
                      </div>
                      <svg
                        className={`w-5 h-5 text-gray-500 transition-transform ${expandedSections.overview ? 'transform rotate-180' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {expandedSections.overview && (
                      <div className="px-3 md:px-6 pb-4 md:pb-6 pt-2">
                        {analysis?.project_overview && analysis.project_overview.trim().length > 0 ? (
                          <div 
                            className="prose prose-sm md:prose-lg max-w-none bg-white rounded-lg p-4 md:p-6 shadow-sm mt-3 md:mt-4 text-sm md:text-base leading-relaxed"
                            dangerouslySetInnerHTML={{ __html: formatMarkdown(analysis.project_overview) }}
                          />
                        ) : analysis === null ? (
                          <div className="bg-white rounded-lg p-6 text-center mt-4">
                            <p className="text-gray-500">프로젝트 개요를 불러오는 중...</p>
                          </div>
                        ) : (
                          <div className="bg-white rounded-lg p-6 text-center mt-4">
                            <p className="text-gray-500 mb-4">프로젝트 개요가 아직 생성되지 않았습니다.</p>
                            <button
                              onClick={async () => {
                                if (confirm('AI 분석을 다시 실행하여 프로젝트 개요를 생성하시겠습니까?')) {
                                  try {
                                    const response = await fetch(`/api/projects/${projectId}/analysis`, {
                                      method: 'POST',
                                    });
                                    if (response.ok) {
                                      alert('AI 분석이 시작되었습니다. 잠시 후 페이지를 새로고침해주세요.');
                                      setTimeout(() => {
                                        window.location.reload();
                                      }, 3000);
                                    } else {
                                      const data = await response.json();
                                      alert(`오류: ${data.error || 'AI 분석 실행에 실패했습니다.'}`);
                                    }
                                  } catch (error) {
                                    console.error('Error triggering analysis:', error);
                                    alert('AI 분석 실행 중 오류가 발생했습니다.');
                                  }
                                }
                              }}
                              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                            >
                              AI 분석 실행
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* 버전 히스토리 - 아코디언 */}
                  <div className="bg-gradient-to-r from-purple-50 to-pink-50 rounded-none md:rounded-xl border-x-0 md:border border-purple-100 overflow-hidden">
                    <button
                      onClick={() => setExpandedSections(prev => ({ ...prev, versionHistory: !prev.versionHistory }))}
                      className="w-full px-3 md:px-6 py-4 md:py-5 flex items-center justify-between hover:bg-purple-50 transition-colors"
                    >
                      <div className="flex items-center">
                        <span className="text-xl md:text-2xl mr-2 md:mr-3">📜</span>
                        <h3 className="text-base md:text-xl font-bold text-gray-900">버전 히스토리</h3>
                        {commits.length > 0 && (
                          <span className="ml-3 px-2 py-1 bg-purple-100 text-purple-700 text-xs font-medium rounded-full">
                            {commits.length}개
                          </span>
                        )}
                      </div>
                      <svg
                        className={`w-5 h-5 text-gray-500 transition-transform ${expandedSections.versionHistory ? 'transform rotate-180' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {expandedSections.versionHistory && (
                      <div className="px-6 pb-6 pt-2">
                        {loadingCommits ? (
                          <div className="bg-white rounded-lg p-6 text-center mt-4">
                            <p className="text-gray-500">커밋 히스토리를 불러오는 중...</p>
                          </div>
                        ) : commits.length > 0 ? (
                          <div className="bg-white rounded-lg p-4 mt-4 max-h-96 overflow-y-auto">
                            <div className="space-y-3">
                              {commits.map((commit: any) => (
                                <div
                                  key={commit.sha}
                                  className="border-b border-gray-200 pb-3 last:border-b-0 last:pb-0"
                                >
                                  <div className="flex items-start justify-between">
                                    <div className="flex-1">
                                      <div className="flex items-center gap-2 mb-1">
                                        <a
                                          href={commit.url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-sm font-mono text-blue-600 hover:underline"
                                        >
                                          {commit.sha.substring(0, 7)}
                                        </a>
                                        <span className="text-xs text-gray-500">
                                          {new Date(commit.date).toLocaleString('ko-KR', {
                                            year: 'numeric',
                                            month: 'long',
                                            day: 'numeric',
                                            hour: '2-digit',
                                            minute: '2-digit',
                                          })}
                                        </span>
                                      </div>
                                      <p className="text-sm text-gray-900 mb-2 whitespace-pre-wrap">
                                        {commit.message.split('\n')[0]}
                                      </p>
                                      <div className="flex items-center gap-2">
                                        {commit.author.avatar && (
                                          <img
                                            src={commit.author.avatar}
                                            alt={commit.author.name}
                                            className="w-5 h-5 rounded-full"
                                          />
                                        )}
                                        <span className="text-xs text-gray-600">
                                          {commit.author.name}
                                          {commit.author.login && ` (@${commit.author.login})`}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="bg-white rounded-lg p-6 text-center mt-4">
                            <p className="text-gray-500">커밋 히스토리가 없습니다.</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  {/* 아이디어 리뷰 - 아코디언 */}
                  <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-none md:rounded-xl border-x-0 md:border border-blue-100 overflow-hidden">
                    <button
                      onClick={() => toggleSection('idea')}
                      className="w-full px-3 md:px-6 py-4 md:py-5 flex items-center justify-between hover:bg-blue-100/50 transition-colors"
                    >
                      <div className="flex items-center">
                        <span className="text-xl md:text-2xl mr-2 md:mr-3">💡</span>
                        <h3 className="text-base md:text-xl font-bold text-gray-900">아이디어 리뷰</h3>
                      </div>
                      <div className="flex items-center space-x-3">
                        {analysis?.idea_review ? (
                          <span className="px-3 py-1 bg-green-100 text-green-800 text-xs font-semibold rounded-full">
                            완료
                          </span>
                        ) : (
                          <span className="px-3 py-1 bg-gray-100 text-gray-600 text-xs font-semibold rounded-full">
                            대기 중
                          </span>
                        )}
                        <svg
                          className={`w-5 h-5 text-gray-500 transition-transform ${
                            expandedSections.idea ? 'transform rotate-180' : ''
                          }`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </button>
                    {expandedSections.idea && (
                      <div className="px-3 md:px-6 pb-4 md:pb-6 pt-2">
                        {analysis?.idea_review ? (
                          <div 
                            className="prose prose-sm md:prose-lg max-w-none bg-white rounded-lg p-4 md:p-6 shadow-sm mt-3 md:mt-4 text-sm md:text-base leading-relaxed"
                            dangerouslySetInnerHTML={{ __html: formatMarkdown(analysis.idea_review) }}
                          />
                        ) : (
                          <div className="bg-white rounded-lg p-6 text-center mt-4">
                            <p className="text-gray-500">아이디어 리뷰가 아직 생성되지 않았습니다.</p>
                            <button
                              onClick={handleRescan}
                              className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
                            >
                              재스캔 실행
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* 기술 리뷰 - 아코디언 */}
                  <div className="bg-gradient-to-r from-purple-50 to-pink-50 rounded-none md:rounded-xl border-x-0 md:border border-purple-100 overflow-hidden">
                    <button
                      onClick={() => toggleSection('tech')}
                      className="w-full px-3 md:px-6 py-4 md:py-5 flex items-center justify-between hover:bg-purple-100/50 transition-colors"
                    >
                      <div className="flex items-center">
                        <span className="text-xl md:text-2xl mr-2 md:mr-3">⚙️</span>
                        <h3 className="text-base md:text-xl font-bold text-gray-900">기술 리뷰</h3>
                      </div>
                      <div className="flex items-center space-x-3">
                        {analysis?.tech_review ? (
                          <span className="px-3 py-1 bg-green-100 text-green-800 text-xs font-semibold rounded-full">
                            완료
                          </span>
                        ) : (
                          <span className="px-3 py-1 bg-gray-100 text-gray-600 text-xs font-semibold rounded-full">
                            대기 중
                          </span>
                        )}
                        <svg
                          className={`w-5 h-5 text-gray-500 transition-transform ${
                            expandedSections.tech ? 'transform rotate-180' : ''
                          }`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </button>
                    {expandedSections.tech && (
                      <div className="px-3 md:px-6 pb-4 md:pb-6 pt-2">
                        {analysis?.tech_review ? (
                          <div 
                            className="prose prose-sm md:prose-lg max-w-none bg-white rounded-lg p-4 md:p-6 shadow-sm mt-3 md:mt-4 text-sm md:text-base leading-relaxed"
                            dangerouslySetInnerHTML={{ __html: formatMarkdown(analysis.tech_review) }}
                          />
                        ) : (
                          <div className="bg-white rounded-lg p-6 text-center mt-4">
                            <p className="text-gray-500">기술 리뷰가 아직 생성되지 않았습니다.</p>
                            <button
                              onClick={handleRescan}
                              className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
                            >
                              재스캔 실행
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* 특허 분석 - 아코디언 */}
                  <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-none md:rounded-xl border-x-0 md:border border-green-100 overflow-hidden">
                    <button
                      onClick={() => toggleSection('patent')}
                      className="w-full px-3 md:px-6 py-4 md:py-5 flex items-center justify-between hover:bg-green-100/50 transition-colors"
                    >
                      <div className="flex items-center">
                        <span className="text-xl md:text-2xl mr-2 md:mr-3">🔬</span>
                        <h3 className="text-base md:text-xl font-bold text-gray-900">특허 분석</h3>
                      </div>
                      <div className="flex items-center space-x-3">
                        {analysis?.patent_review ? (
                          <span className="px-3 py-1 bg-green-100 text-green-800 text-xs font-semibold rounded-full">
                            완료
                          </span>
                        ) : (
                          <span className="px-3 py-1 bg-gray-100 text-gray-600 text-xs font-semibold rounded-full">
                            대기 중
                          </span>
                        )}
                        <svg
                          className={`w-5 h-5 text-gray-500 transition-transform ${
                            expandedSections.patent ? 'transform rotate-180' : ''
                          }`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </button>
                    {expandedSections.patent && (
                      <div className="px-3 md:px-6 pb-4 md:pb-6 pt-2">
                        {analysis?.patent_review ? (
                          <div 
                            className="prose prose-sm md:prose-lg max-w-none bg-white rounded-lg p-4 md:p-6 shadow-sm mt-3 md:mt-4 text-sm md:text-base leading-relaxed"
                            dangerouslySetInnerHTML={{ __html: formatMarkdown(analysis.patent_review) }}
                          />
                        ) : (
                          <div className="bg-white rounded-lg p-6 text-center mt-4">
                            <p className="text-gray-500">특허 분석이 아직 생성되지 않았습니다.</p>
                            <button
                              onClick={handleRescan}
                              className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
                            >
                              재스캔 실행
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* 릴리즈 노트 */}
                  {analysis?.latest_release_note && (
                    <div className="bg-gradient-to-r from-yellow-50 to-amber-50 rounded-none md:rounded-xl p-3 md:p-6 border-x-0 md:border border-yellow-100">
                      <div className="flex items-center justify-between mb-3 md:mb-4">
                        <h3 className="text-base md:text-xl font-bold text-gray-900 flex items-center">
                          <span className="text-xl md:text-2xl mr-2 md:mr-3">📝</span>
                          최신 릴리즈 노트
                        </h3>
                        <span className="px-2 md:px-3 py-1 bg-green-100 text-green-800 text-xs font-semibold rounded-full">
                          완료
                        </span>
                      </div>
                      <div 
                        className="prose prose-sm md:prose-lg max-w-none bg-white rounded-lg p-4 md:p-6 shadow-sm text-sm md:text-base leading-relaxed"
                        dangerouslySetInnerHTML={{ __html: formatMarkdown(analysis.latest_release_note) }}
                      />
                    </div>
                  )}

                  {/* 모든 리뷰가 없을 때 */}
                  {(!analysis || (!analysis.idea_review && !analysis.tech_review && !analysis.patent_review)) && (
                    <div className="bg-yellow-50 border-2 border-yellow-200 rounded-xl p-6 text-center">
                      <p className="text-yellow-800 font-medium mb-4">
                        ⚠️ AI 리뷰가 아직 생성되지 않았습니다.
                      </p>
                      <button
                        onClick={handleRescan}
                        className="px-6 py-3 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 font-medium transition-colors"
                      >
                        재스캔 실행하여 AI 리뷰 생성하기
                      </button>
                    </div>
                  )}
                </div>
                  </>
                )}
              </div>
            )}

            {/* 진행 및 파일 목록 탭 */}
            {activeTab === 'progress' && project?.project_type !== 'idea' && (
              <div className="p-0 md:p-6">
                <div className="mb-4 md:mb-6 hidden md:block">
                  <h2 className="text-xl md:text-2xl font-bold text-gray-900 mb-2">📊 진행 상황 및 파일 목록</h2>
                  <p className="text-xs md:text-sm text-gray-600">
                    프로젝트 스캔 진행 상황과 파일 목록을 확인할 수 있습니다.
                  </p>
                </div>

                <div className="space-y-2 md:space-y-6">
                  {/* 실시간 진행률 배너 */}
                  <div className="md:mb-0">
                    <ProgressBanner projectId={projectId} />
                  </div>

                  {/* 모바일: 재스캔 버튼 (파일 목록 위) */}
                  <div className="md:hidden px-3">
                    <button
                      onClick={handleRescan}
                      data-rescan-button
                      className="w-full px-3 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-900 active:bg-gray-950 transition-colors text-sm font-medium min-h-[44px] touch-manipulation flex items-center justify-center gap-2"
                    >
                      <span className="text-base">🔄</span>
                      <span>재스캔</span>
                    </button>
                  </div>

                  {/* 파일 목록 */}
                  <div className="md:mb-0">
                    <FileListPane projectId={projectId} enabled={activeTab === 'progress'} />
                  </div>
                </div>
              </div>
            )}

            {/* 챗봇 탭 */}
            {activeTab === 'chat' && (
              <div className="p-0 w-full flex flex-col" style={{ height: 'calc(100vh - 180px)', minHeight: '600px', maxHeight: 'calc(100vh - 180px)' }}>
                {/* 데스크톱 헤더 */}
                <div className="mb-4 md:mb-6 px-4 md:px-6 pt-4 md:pt-6 hidden md:block flex-shrink-0">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-2xl font-bold text-gray-900 mb-2">💬 프로젝트 챗봇</h2>
                      <p className="text-sm text-gray-600">
                        프로젝트에 대해 질문하고 AI의 답변을 받아보세요.
                      </p>
                    </div>
                    {/* 사이드바 토글 버튼 */}
                    <button
                      onClick={() => setSidebarOpen(!sidebarOpen)}
                      className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors flex items-center gap-2"
                      title={sidebarOpen ? '대화 목록 닫기' : '대화 목록 열기'}
                    >
                      <svg
                        className="w-5 h-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M4 6h16M4 12h16M4 18h16"
                        />
                      </svg>
                      <span className="text-sm">대화 목록</span>
                    </button>
                  </div>
                </div>

                {/* 모바일: 사이드바 (헤더 바로 아래) */}
                {isMobile && sidebarOpen && (
                  <div className="md:hidden border-b border-gray-200 bg-white flex-shrink-0" style={{ maxHeight: '50vh', overflow: 'hidden' }}>
                    <div className="h-full" style={{ maxHeight: '50vh' }}>
                      <SessionSidebar
                        projectId={projectId}
                        currentSessionId={selectedSessionId}
                        onSessionSelect={(sessionId) => {
                          setSelectedSessionId(sessionId);
                          setSidebarOpen(false); // 모바일에서 세션 선택 시 사이드바 닫기
                        }}
                        onNewSession={() => {
                          setSelectedSessionId(null);
                          setSidebarOpen(false); // 모바일에서 새 세션 시작 시 사이드바 닫기
                        }}
                      />
                    </div>
                  </div>
                )}

                <div className="flex-1 w-full overflow-hidden flex min-h-0">
                  {/* 데스크톱: 세션 사이드바 (토글 가능) */}
                  {!isMobile && sidebarOpen && (
                    <div className="flex-shrink-0 h-full">
                      <SessionSidebar
                        projectId={projectId}
                        currentSessionId={selectedSessionId}
                        onSessionSelect={(sessionId) => {
                          setSelectedSessionId(sessionId);
                        }}
                        onNewSession={() => {
                          setSelectedSessionId(null);
                        }}
                      />
                    </div>
                  )}
                  {/* 챗 인터페이스 */}
                  <div className="flex-1 overflow-hidden min-h-0">
                    <ChatInterface
                      projectId={projectId}
                      isMobile={isMobile}
                      initialSessionId={selectedSessionId}
                      onSessionChange={(sessionId) => {
                        setSelectedSessionId(sessionId);
                      }}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
