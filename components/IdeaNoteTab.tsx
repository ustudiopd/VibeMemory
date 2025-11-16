'use client';

import { useState, useEffect } from 'react';
import ChatInterface from './ChatInterface';

interface IdeaFile {
  id: string;
  file_name: string;
  file_type: string | null;
  file_size: number | null;
  mime_type: string | null;
  created_at: string;
}

interface IdeaNoteTabProps {
  projectId: string;
}

export default function IdeaNoteTab({ projectId }: IdeaNoteTabProps) {
  const [files, setFiles] = useState<IdeaFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchFiles();
  }, [projectId]);

  const fetchFiles = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/projects/${projectId}/idea/files`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '파일 목록을 불러올 수 없습니다.');
      }

      setFiles(data.files || []);
    } catch (err) {
      console.error('Error fetching files:', err);
      setError(err instanceof Error ? err.message : '파일 목록을 불러올 수 없습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles || selectedFiles.length === 0) return;

    setUploading(true);
    setError(null);

    try {
      const uploadPromises = Array.from(selectedFiles).map(async (file) => {
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch(`/api/projects/${projectId}/idea/files`, {
          method: 'POST',
          body: formData,
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || '업로드에 실패했습니다.');
        }

        return data.file;
      });

      await Promise.all(uploadPromises);
      await fetchFiles(); // 목록 새로고침
    } catch (err) {
      console.error('Error uploading files:', err);
      setError(err instanceof Error ? err.message : '업로드에 실패했습니다.');
    } finally {
      setUploading(false);
      // input 초기화
      e.target.value = '';
    }
  };

  const handleDeleteFile = async (fileId: string) => {
    if (!confirm('이 파일을 삭제하시겠습니까?')) return;

    try {
      // TODO: DELETE API 구현 필요
      // const response = await fetch(`/api/projects/${projectId}/idea/files/${fileId}`, {
      //   method: 'DELETE',
      // });
      // if (!response.ok) {
      //   throw new Error('삭제에 실패했습니다.');
      // }
      await fetchFiles();
    } catch (err) {
      console.error('Error deleting file:', err);
      alert(err instanceof Error ? err.message : '삭제에 실패했습니다.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="mb-4 md:mb-6 hidden md:block">
        <h2 className="text-xl md:text-2xl font-bold text-gray-900 mb-2">💡 아이디어 노트</h2>
        <p className="text-xs md:text-sm text-gray-600 mb-4">
          아이디어 관련 파일을 업로드하고 AI 챗봇과 대화하여 명세서로 발전시켜보세요.
        </p>
      </div>

      {/* 아이디어 캔버스 (파일 업로드) */}
      <div className="bg-white rounded-none md:rounded-lg p-4 md:p-6 border-x-0 md:border border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">아이디어 캔버스</h3>
          <label className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 cursor-pointer transition-colors">
            {uploading ? '업로드 중...' : '파일 업로드'}
            <input
              type="file"
              multiple
              accept=".md,.txt"
              className="hidden"
              onChange={handleFileUpload}
              disabled={uploading}
            />
          </label>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-600 mx-auto"></div>
            <p className="mt-4 text-gray-500">파일 목록을 불러오는 중...</p>
          </div>
        ) : files.length === 0 ? (
          <div className="text-center py-12 border-2 border-dashed border-gray-300 rounded-lg">
            <p className="text-gray-500 mb-4">아직 업로드된 파일이 없습니다.</p>
            <label className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 cursor-pointer inline-block">
              첫 파일 업로드
              <input
                type="file"
                multiple
                accept=".md,.txt"
                className="hidden"
                onChange={handleFileUpload}
              />
            </label>
          </div>
        ) : (
          <div className="space-y-2">
            {files.map((file) => (
              <div
                key={file.id}
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <div className="flex items-center space-x-3">
                  <span className="text-2xl">📄</span>
                  <div>
                    <p className="font-medium text-gray-900">{file.file_name}</p>
                    <p className="text-xs text-gray-500">
                      {file.file_size ? `${(file.file_size / 1024).toFixed(2)} KB` : ''} ·{' '}
                      {new Date(file.created_at).toLocaleDateString('ko-KR')}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => handleDeleteFile(file.id)}
                  className="px-3 py-1 text-sm text-red-600 hover:bg-red-50 rounded transition-colors"
                >
                  삭제
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 디벨롭 챗봇 */}
      <div className="bg-white rounded-none md:rounded-lg p-4 md:p-6 border-x-0 md:border border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">디벨롭 챗봇</h3>
        <p className="text-sm text-gray-600 mb-4">
          업로드한 파일과 대화를 통해 아이디어를 구체적인 명세서로 발전시켜보세요.
        </p>
        <ChatInterface projectId={projectId} />
      </div>

      {/* 명세서 생성 및 Cursor 내보내기 */}
      <SpecificationActions projectId={projectId} />
    </div>
  );
}

function SpecificationActions({ projectId }: { projectId: string }) {
  const [generating, setGenerating] = useState(false);
  const [specification, setSpecification] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerateSpec = async () => {
    setGenerating(true);
    setError(null);

    try {
      const response = await fetch(`/api/projects/${projectId}/idea/synthesize`, {
        method: 'POST',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '명세서 생성에 실패했습니다.');
      }

      if (data.success && data.specification) {
        setSpecification(data.specification);
        setShowModal(true);
      }
    } catch (err) {
      console.error('Error generating specification:', err);
      setError(err instanceof Error ? err.message : '명세서 생성에 실패했습니다.');
    } finally {
      setGenerating(false);
    }
  };

  const handleCopyToCursor = () => {
    if (!specification) return;

    const cursorPrompt = `다음 명세서를 기반으로 프로젝트를 생성해주세요:

${specification}

요구사항:
- 위 명세서의 모든 기능을 구현해주세요
- 코드 스타일은 명확하고 유지보수 가능하게 작성해주세요
- 필요한 의존성과 설정 파일을 포함해주세요
- README.md 파일에 프로젝트 설명과 설치 방법을 포함해주세요
`;

    navigator.clipboard.writeText(cursorPrompt).then(() => {
      alert('Cursor 프롬프트가 클립보드에 복사되었습니다. Cursor에서 새 프로젝트를 생성할 때 사용하세요.');
    }).catch((err) => {
      console.error('Error copying to clipboard:', err);
      alert('클립보드 복사에 실패했습니다.');
    });
  };

  return (
    <div className="bg-white rounded-none md:rounded-lg p-4 md:p-6 border-x-0 md:border border-gray-200">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">명세서 생성 및 내보내기</h3>
      <p className="text-sm text-gray-600 mb-4">
        업로드한 파일과 챗봇 대화를 기반으로 프로젝트 명세서를 자동 생성하고, Cursor로 내보낼 수 있습니다.
      </p>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}

      <div className="flex space-x-4">
        <button
          onClick={handleGenerateSpec}
          disabled={generating}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {generating ? '명세서 생성 중...' : '명세서 생성하기'}
        </button>

        {specification && (
          <button
            onClick={() => setShowModal(true)}
            className="px-6 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
          >
            명세서 보기
          </button>
        )}
      </div>

      {/* 명세서 모달 */}
      {showModal && specification && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-900">프로젝트 명세서</h2>
              <div className="flex space-x-2">
                <button
                  onClick={handleCopyToCursor}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                >
                  Cursor로 복사
                </button>
                <button
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  닫기
                </button>
              </div>
            </div>
            <div className="p-6 overflow-y-auto flex-1">
              <pre className="whitespace-pre-wrap font-mono text-sm bg-gray-50 p-4 rounded-lg">
                {specification}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

