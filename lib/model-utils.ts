/**
 * 모델명 정규화 및 Reasoning 모델 감지 유틸리티
 * 해결책.md 2장, 5장 참조
 */

/**
 * 모델명 정규화: 비ASCII 하이픈을 ASCII '-'로 통일
 * 환경 변수 복붙 시 비ASCII 하이픈(‑ — − 등)이 섞이면 인식 실패 가능
 */
export function normalizeModel(raw?: string): string {
  return (raw ?? 'gpt-4o-mini').replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-').trim();
}

/**
 * Reasoning 모델 여부 확인
 * Reasoning 모델: gpt-5*, o4*, o3*
 */
export function isReasoningModel(model: string): boolean {
  return /^(gpt-5|o4|o3)/i.test(model);
}

/**
 * 모델별 옵션 생성
 * Reasoning 모델: 옵션 없음 (temperature, maxTokens 제거)
 * 일반 모델: temperature, maxTokens 사용 가능
 */
export function getModelOptions(model: string, defaultTemperature: number = 0.7, defaultMaxTokens?: number) {
  if (isReasoningModel(model)) {
    // Reasoning 모델: 옵션 없음
    return {};
  }
  
  // 일반 모델: 옵션 사용
  const opts: { temperature?: number; maxTokens?: number } = {
    temperature: defaultTemperature,
  };
  
  if (defaultMaxTokens) {
    opts.maxTokens = defaultMaxTokens;
  }
  
  return opts;
}

