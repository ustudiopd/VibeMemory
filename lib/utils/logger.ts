/**
 * 구조화된 로깅 유틸리티
 */

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

export interface LogContext {
  projectId?: string;
  runId?: string;
  phase?: string;
  filePath?: string;
  [key: string]: any;
}

/**
 * 구조화된 로그 엔트리
 */
interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: LogContext;
  error?: {
    message: string;
    stack?: string;
    name?: string;
  };
}

/**
 * 로그를 구조화된 형식으로 출력합니다.
 */
function log(level: LogLevel, message: string, context?: LogContext, error?: Error) {
  const entry: LogEntry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    context,
  };

  if (error) {
    entry.error = {
      message: error.message,
      stack: error.stack,
      name: error.name,
    };
  }

  // JSON 형식으로 출력 (추후 로그 수집 시스템으로 전송 가능)
  const logMessage = JSON.stringify(entry);
  
  // 레벨에 따라 적절한 콘솔 메서드 사용
  switch (level) {
    case LogLevel.DEBUG:
      console.debug(logMessage);
      break;
    case LogLevel.INFO:
      console.info(logMessage);
      break;
    case LogLevel.WARN:
      console.warn(logMessage);
      break;
    case LogLevel.ERROR:
      console.error(logMessage);
      break;
  }
}

export const logger = {
  debug: (message: string, context?: LogContext) => {
    log(LogLevel.DEBUG, message, context);
  },
  
  info: (message: string, context?: LogContext) => {
    log(LogLevel.INFO, message, context);
  },
  
  warn: (message: string, context?: LogContext) => {
    log(LogLevel.WARN, message, context);
  },
  
  error: (message: string, context?: LogContext, error?: Error) => {
    log(LogLevel.ERROR, message, context, error);
  },
};

