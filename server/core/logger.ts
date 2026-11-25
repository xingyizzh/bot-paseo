export interface Logger {
  info(feature: string, step: string, message: string): void;
  warn(feature: string, step: string, message: string): void;
  error(feature: string, step: string, code: string, message: string): void;
}

const SENSITIVE_RE = /\b(sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9_]{12,}|Bearer\s+[A-Za-z0-9._+/=-]{12,})\b/gi;

function redact(text: string): string {
  return text.replace(SENSITIVE_RE, "[REDACTED]");
}

export function createLogger(prefix = "paseo-bot"): Logger {
  return {
    info(feature, step, message) {
      console.info(`[${prefix}][${feature}::${step}] ${redact(message)}`);
    },
    warn(feature, step, message) {
      console.warn(`[${prefix}][${feature}::${step}] ${redact(message)}`);
    },
    error(feature, step, code, message) {
      console.error(`[${prefix}][${feature}::${step}::${code}] ${redact(message)}`);
    },
  };
}
