import { Request, Response, NextFunction } from "express";
import { logger, sanitizeUrl } from "../utils/logger";

const SENSITIVE_BODY_KEY = /password|passwd|token|secret|otp|authorization|api[-_]?key/i;

function redactSensitiveBody(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitiveBody);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      SENSITIVE_BODY_KEY.test(key) ? "[REDACTED]" : redactSensitiveBody(entry),
    ])
  );
}

export const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
  const startTime = Date.now();
  const requestId = req.id;
  const safeUrl = sanitizeUrl(req.originalUrl);

  // Log on request start
  logger.info(
    `HTTP ${req.method} ${safeUrl}`,
    {
      method: req.method,
      url: safeUrl,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
      body: redactSensitiveBody(req.body),
      query: req.query,
    },
    requestId
  );

  // Hook into response finish event
  res.on("finish", () => {
    const duration = Date.now() - startTime;
    const statusCode = res.statusCode;
    const logMethod =
      statusCode >= 500 ? logger.error : statusCode >= 400 ? logger.warn : logger.info;

    logMethod.call(
      logger,
      `HTTP ${req.method} ${safeUrl} responded with ${statusCode} in ${duration}ms`,
      {
        method: req.method,
        url: safeUrl,
        statusCode,
        durationMs: duration,
      },
      requestId
    );
  });

  next();
};
