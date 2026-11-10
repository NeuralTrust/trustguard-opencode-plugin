import type { FetchLike } from "../src/client.ts"

export interface Captured {
  url: string
  headers: Record<string, string>
  body: any
}

export function mockFetch(
  responder: (body: any, n: number) => { status?: number; json?: unknown; text?: string; delayMs?: number; throws?: Error },
): { fetch: FetchLike; calls: Captured[] } {
  const calls: Captured[] = []
  const fetch: FetchLike = async (url, init) => {
    const body = JSON.parse(String(init.body))
    calls.push({ url, headers: init.headers as Record<string, string>, body })
    const r = responder(body, calls.length)
    if (r.throws) throw r.throws
    if (r.delayMs) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, r.delayMs)
        init.signal?.addEventListener("abort", () => {
          clearTimeout(t)
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
        })
      })
    }
    const text = r.text ?? JSON.stringify(r.json ?? { status: "allow", findings: [] })
    return new Response(text, { status: r.status ?? 200, headers: { "content-type": "application/json" } })
  }
  return { fetch, calls }
}

export const ENV = {
  TRUSTGUARD_API_KEY: "tgk_test",
  TRUSTGUARD_DATA_URL: "https://tg.example.test/",
  TRUSTGUARD_OPENCODE_CONFIG: "/nonexistent/user.json",
  TRUSTGUARD_OPENCODE_SYSTEM_CONFIG: "/nonexistent/system.json",
}

export const silent = () => {}

export function blockResponse(signal = "dangerous_command", detector = "code_sanitation") {
  return {
    status: "block",
    trace_id: "tr_1",
    findings: [
      { source: { kind: "detector", detector_name: detector }, signal: { type: signal, confidence: 0.97 }, outcome: { action: "block" } },
    ],
  }
}
