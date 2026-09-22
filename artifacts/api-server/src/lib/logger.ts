import pino from "pino";
import { getAnalysisId } from "./log-context.js";

const isProduction = process.env.NODE_ENV === "production";

export interface LogSinkEntry {
  level: number;
  msg: string;
  obj: Record<string, unknown>;
}

type LogSink = (entry: LogSinkEntry) => void;

let logSink: LogSink | null = null;

export function setLogSink(sink: LogSink | null): void {
  logSink = sink;
}

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
  mixin() {
    const analysisId = getAnalysisId();
    return analysisId ? { analysisId } : {};
  },
  hooks: {
    logMethod(args, method, level) {
      method.apply(this, args);
      if (!logSink) return;
      try {
        const first = args[0];
        const second = args[1];
        const obj = first !== null && typeof first === "object"
          ? { ...(first as Record<string, unknown>) }
          : {};
        const analysisId = getAnalysisId();
        if (analysisId && obj.analysisId === undefined) obj.analysisId = analysisId;
        const msg = typeof first === "string"
          ? first
          : typeof second === "string"
            ? second
            : "";
        logSink({ level, msg, obj });
      } catch {
        // Logging must never fail because of the optional persistence sink.
      }
    },
  },
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
