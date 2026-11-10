import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

/**
 * Runtime configuration. Mirrors the TrustGuard hooks for Claude Code, Cursor,
 * Copilot and Gemini CLI (same env vars, same defaults, same managed-mode lock).
 *
 * Resolution: env > plugin options (opencode.json) > user file > managed file > default.
 * In managed mode (the system file ships an api_key) the org key, its data_url
 * and fail_mode cannot be overridden by the developer.
 */
export interface Config {
  /** TrustGuard data-plane base URL (serves POST /v1/evaluate). */
  dataURL: string
  /** Collector API key (tgk_…). Without it the plugin allows everything. */
  apiKey: string
  /** Verdict when TrustGuard is unreachable or errors: "open" allows, "closed" denies. */
  failMode: "open" | "closed"
  /** How a `transform` verdict (DLP found PII/secrets) is applied to a tool call. */
  transformAction: "ask" | "deny" | "allow"
  /** Attach a notice when findings are report-only. */
  reportNotice: boolean
  /** Bound for each /v1/evaluate call, in milliseconds. */
  timeoutMs: number
  /** Tool results larger than this are truncated before evaluation. */
  maxContentBytes: number
  /** Optional consumer id sent with every evaluation. */
  consumerID: string
  /** Disable individual events, e.g. { "tool.execute.after": false }. */
  events: Record<string, boolean>
  /** True when an MDM-managed system file provided the API key. */
  managed: boolean
}

/** On-disk / plugin-options shape (snake_case, same keys as the other TrustGuard hooks). */
export interface FileConfig {
  data_url?: string
  api_key?: string
  fail_mode?: string
  transform_action?: string
  report_notice?: boolean
  timeout_ms?: number
  max_content_bytes?: number
  consumer_id?: string
  events?: Record<string, boolean>
}

export const DEFAULTS = {
  dataURL: "http://localhost:8081",
  failMode: "open",
  transformAction: "ask",
  timeoutMs: 5000,
  maxContentBytes: 256 * 1024,
} as const

export type Env = Record<string, string | undefined>

export function userConfigPath(env: Env = process.env): string {
  if (env.TRUSTGUARD_OPENCODE_CONFIG) return env.TRUSTGUARD_OPENCODE_CONFIG
  return join(homedir(), ".trustguard", "opencode.json")
}

export function systemConfigPath(env: Env = process.env, platform: string = process.platform): string {
  if (env.TRUSTGUARD_OPENCODE_SYSTEM_CONFIG) return env.TRUSTGUARD_OPENCODE_SYSTEM_CONFIG
  switch (platform) {
    case "darwin":
      return "/Library/Application Support/TrustGuard/opencode.json"
    case "win32":
      return join(env.ProgramData || "C:\\ProgramData", "TrustGuard", "opencode.json")
    default:
      return "/etc/trustguard/opencode.json"
  }
}

function readJSON(path: string): FileConfig | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"))
    return parsed && typeof parsed === "object" ? (parsed as FileConfig) : undefined
  } catch {
    return undefined
  }
}

export interface LoadOptions {
  env?: Env
  /** Options from the plugin entry in opencode.json (V1 tuple / V2 `options`). */
  options?: Record<string, unknown>
  readFile?: (path: string) => FileConfig | undefined
}

export function loadConfig(opts: LoadOptions = {}): Config {
  const env = opts.env ?? process.env
  const read = opts.readFile ?? readJSON
  const system = read(systemConfigPath(env)) ?? {}
  const managed = typeof system.api_key === "string" && system.api_key.trim() !== ""

  const raw: FileConfig = { ...system }
  for (const layer of [read(userConfigPath(env)) ?? {}, normalizeOptions(opts.options)]) {
    overlay(raw, layer, managed)
  }
  overlay(raw, envLayer(env), managed)
  return finalize(raw, managed)
}

function normalizeOptions(options: Record<string, unknown> | undefined): FileConfig {
  if (!options || typeof options !== "object") return {}
  const o = options as Record<string, unknown>
  const pick = (snake: string, camel: string) => (o[snake] !== undefined ? o[snake] : o[camel])
  return {
    data_url: str(pick("data_url", "dataURL") ?? o.dataUrl),
    api_key: str(pick("api_key", "apiKey")),
    fail_mode: str(pick("fail_mode", "failMode")),
    transform_action: str(pick("transform_action", "transformAction")),
    report_notice: typeof pick("report_notice", "reportNotice") === "boolean" ? (pick("report_notice", "reportNotice") as boolean) : undefined,
    timeout_ms: num(pick("timeout_ms", "timeoutMs")),
    max_content_bytes: num(pick("max_content_bytes", "maxContentBytes")),
    consumer_id: str(pick("consumer_id", "consumerID") ?? o.consumerId),
    events: o.events && typeof o.events === "object" ? (o.events as Record<string, boolean>) : undefined,
  }
}

function envLayer(env: Env): FileConfig {
  return {
    data_url: env.TRUSTGUARD_DATA_URL || undefined,
    api_key: env.TRUSTGUARD_API_KEY || undefined,
    fail_mode: env.TRUSTGUARD_FAIL_MODE || undefined,
    transform_action: env.TRUSTGUARD_TRANSFORM_ACTION || undefined,
    timeout_ms: num(env.TRUSTGUARD_TIMEOUT_MS),
    consumer_id: env.TRUSTGUARD_CONSUMER_ID || undefined,
  }
}

const LOCKED: ReadonlyArray<keyof FileConfig> = ["data_url", "api_key", "fail_mode"]

function overlay(target: FileConfig, layer: FileConfig, managed: boolean): void {
  for (const [key, value] of Object.entries(layer) as [keyof FileConfig, unknown][]) {
    if (value === undefined || value === "" || value === null) continue
    if ((key === "timeout_ms" || key === "max_content_bytes") && !((value as number) > 0)) continue
    if (managed && LOCKED.includes(key)) continue
    ;(target as Record<string, unknown>)[key] = value
  }
}

function finalize(raw: FileConfig, managed: boolean): Config {
  const transform = raw.transform_action
  return {
    dataURL: (raw.data_url || DEFAULTS.dataURL).replace(/\/+$/, ""),
    apiKey: (raw.api_key || "").trim(),
    failMode: raw.fail_mode === "closed" ? "closed" : "open",
    transformAction: transform === "deny" || transform === "allow" || transform === "ask" ? transform : DEFAULTS.transformAction,
    reportNotice: raw.report_notice !== false,
    timeoutMs: raw.timeout_ms && raw.timeout_ms > 0 ? raw.timeout_ms : DEFAULTS.timeoutMs,
    maxContentBytes: raw.max_content_bytes && raw.max_content_bytes > 0 ? raw.max_content_bytes : DEFAULTS.maxContentBytes,
    consumerID: raw.consumer_id || "",
    events: raw.events ?? {},
    managed,
  }
}

export function eventEnabled(cfg: Config, name: string): boolean {
  return cfg.events[name] !== false
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v : undefined
}

function num(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined
}
