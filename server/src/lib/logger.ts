import { pino, stdSerializers, stdTimeFunctions, type LoggerOptions } from "pino";
import { env } from "../config/env.js";
import { getContext } from "./context.js";

const options: LoggerOptions = {
  level: env.LOG_LEVEL,
  base: {
    service: "ems-api",
    env: env.NODE_ENV,
    version: env.APP_VERSION,
    process: env.PROCESS_TYPE,
  },
  timestamp: stdTimeFunctions.isoTime,
  messageKey: "msg",
  formatters: {
    level: (label) => ({ level: label }),
  },
  // attach request/job context to every log line automatically
  mixin() {
    const ctx = getContext();
    return ctx
      ? { requestId: ctx.requestId, traceId: ctx.traceId, userId: ctx.userId, jobId: ctx.jobId }
      : {};
  },
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      'res.headers["set-cookie"]',
      "*.password",
      "*.newPassword",
      "*.token",
      "*.refreshToken",
      "*.accessToken",
      "*.secret",
      "*.payoutDetails",
      "*.provider_payload",
      "body.password",
    ],
    censor: "[REDACTED]",
  },
  serializers: {
    err: stdSerializers.err,
  },
  transport:
    env.NODE_ENV === "development"
      ? {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:HH:MM:ss.l", ignore: "pid,hostname" },
        }
      : undefined,
};

export const logger = pino(options);
export type Logger = typeof logger;
