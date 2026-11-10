import type { Config } from "./config.ts"

/** Wire body for POST /v1/evaluate (https://docs.neuraltrust.ai/trustguard/api/evaluate). */
export interface EvaluateRequest {
  payload: Record<string, unknown>
  direction: "input" | "output"
  protocol: "llm" | "mcp" | "all"
  session_id?: string
  consumer_id?: string
  attributes?: Record<string, unknown>
}

export interface Finding {
  source?: { kind?: string; plugin?: string; detector_name?: string; gate_name?: string; policy_id?: string }
  signal?: { type?: string; confidence?: number }
  outcome?: { action?: string }
  evidence?: Record<string, unknown>
}

export interface EvaluateResponse {
  status?: "allow" | "report" | "transform" | "ask" | "block" | "skip" | string
  findings?: Finding[]
  trace_id?: string
  request_id?: string
  transformed_payload?: Record<string, unknown> | null
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

const MAX_RESPONSE_BYTES = 1 << 20

export class TrustGuardError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = "TrustGuardError"
  }
}

/**
 * Posts one payload to /v1/evaluate. Detections come back as HTTP 200 (including
 * `block`); any non-200, network error or timeout is thrown so the caller can
 * apply the configured fail mode.
 */
export async function evaluate(cfg: Config, req: EvaluateRequest, fetchImpl: FetchLike = fetch): Promise<EvaluateResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs)
  try {
    let res: Response
    try {
      res = await fetchImpl(`${cfg.dataURL}/v1/evaluate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify(req),
        signal: controller.signal,
      })
    } catch (err) {
      if (controller.signal.aborted) throw new TrustGuardError(`call trustguard: timed out after ${cfg.timeoutMs}ms`)
      throw new TrustGuardError(`call trustguard: ${(err as Error)?.message ?? String(err)}`)
    }
    const body = (await res.text()).slice(0, MAX_RESPONSE_BYTES)
    if (res.status !== 200) {
      throw new TrustGuardError(`trustguard HTTP ${res.status}: ${truncate(body, 200)}`, res.status)
    }
    try {
      return JSON.parse(body) as EvaluateResponse
    } catch {
      throw new TrustGuardError("decode evaluate response: invalid JSON")
    }
  } finally {
    clearTimeout(timer)
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + "…"
}
