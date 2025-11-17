/**
 * 모델명 정규화 유틸리티
 * 해결책.md 5장 참조
 */

/**
 * 모델명 정규화: 비ASCII 하이픈을 ASCII '-'로 통일
 * 환경 변수 복붙 시 비ASCII 하이픈(‑ — − 등)이 섞이면 인식 실패 가능
 */
export function normalizeModel(raw?: string): string {
  return (raw ?? 'gpt-4.1-mini').replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-').trim();
}

/**
 * 모델 옵션 생성
 * GPT-4.1-mini는 일반 모델이므로 temperature, maxTokens 사용 가능
 */
export function getModelOptions(model: string, defaultTemperature: number = 0.7, defaultMaxTokens?: number) {
  // GPT-4.1-mini는 일반 모델이므로 옵션 사용
  const opts: { temperature?: number; maxTokens?: number } = {
    temperature: defaultTemperature,
  };
  
  if (defaultMaxTokens) {
    opts.maxTokens = defaultMaxTokens;
  }
  
  return opts;
}

