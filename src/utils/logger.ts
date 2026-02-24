interface LogContext {
  correlationId?: string
  module?: string
  [key: string]: unknown
}

export function log(
  level: "debug" | "info" | "warn" | "error",
  message: string,
  context: LogContext = {},
) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...context,
  }
  console[level === "debug" ? "log" : level](JSON.stringify(entry))
}
