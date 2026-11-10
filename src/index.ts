/**
 * NeuralTrust TrustGuard plugin for OpenCode.
 *
 * One default export serves both plugin APIs:
 *  - OpenCode V2 (`@opencode/plugin`) reads `id` + `setup(ctx)`.
 *  - OpenCode V1 (`@opencode-ai/plugin`, >= 1.18.29) reads `id` + `server()`.
 *
 * Hooks (same mapping as the TrustGuard hooks for Claude Code / Cursor):
 *  - before a tool runs     → POST /v1/evaluate (mcp tools/call, direction=input); block/ask/transform enforced
 *  - after a tool runs      → POST /v1/evaluate (mcp tool result, direction=output); result withheld or masked
 *  - user prompt submission → POST /v1/evaluate (llm messages, direction=input); block stops the prompt
 */
import type { Plugin as V1Plugin, Hooks as V1Hooks, PluginInput as V1Input } from "@opencode-ai/plugin"
import type { Plugin as V2 } from "@opencode/plugin"
type V2Setup = V2.Plugin["setup"]
import { loadConfig } from "./config.ts"
import { ASK_MESSAGE, BLOCKED_MESSAGE, Guard, LOG_PREFIX, type Logger } from "./guard.ts"
import type { FetchLike } from "./client.ts"

export { Guard, applyVerdict, primaryReason } from "./guard.ts"
export { loadConfig, type Config } from "./config.ts"
export { evaluate, type EvaluateRequest, type EvaluateResponse } from "./client.ts"

export const PLUGIN_ID = "neuraltrust.trustguard"
/** Permission action used to surface a TrustGuard `ask` verdict through OpenCode V2's approval prompt. */
export const APPROVAL_ACTION = "trustguard"

export class TrustGuardBlockedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TrustGuardBlockedError"
  }
}

/** Test seam: lets unit tests inject a mocked fetch / env without touching globals. */
export interface FactoryOptions {
  fetch?: FetchLike
  env?: Record<string, string | undefined>
  log?: Logger
}

// ---------------------------------------------------------------- V1 adapter

export function createV1Server(factory: FactoryOptions = {}): V1Plugin {
  return async (input: V1Input, options?: Record<string, unknown>): Promise<V1Hooks> => {
    const log: Logger =
      factory.log ??
      ((level, message) => {
        const client = (input as Partial<V1Input>)?.client as any
        if (client?.app?.log) {
          void client.app
            .log({ body: { service: LOG_PREFIX, level, message } })
            .catch(() => console.error(`${LOG_PREFIX}: ${message}`))
          return
        }
        if (level !== "debug") console.error(`${LOG_PREFIX}: ${message}`)
      })
    const guard = new Guard({
      config: loadConfig({ env: factory.env, options }),
      fetch: factory.fetch,
      log,
      hostAttributes: { host: "opencode", plugin_api: "v1", directory: input?.directory },
    })

    return {
      "tool.execute.before": async (event, output) => {
        const v = await guard.checkToolCall({
          tool: event.tool,
          args: output.args,
          sessionID: event.sessionID,
          callID: event.callID,
        })
        if (v.permission === "deny") throw new TrustGuardBlockedError(v.message || BLOCKED_MESSAGE)
        if (v.permission === "ask") {
          // V1 hooks cannot open an approval prompt: an `ask` verdict is enforced as a block.
          throw new TrustGuardBlockedError(
            `${v.message || ASK_MESSAGE} OpenCode V1 plugins cannot ask for approval, so the action was blocked.`,
          )
        }
      },

      "tool.execute.after": async (event, output) => {
        if (typeof output?.output !== "string") return
        const d = await guard.checkToolResult({
          tool: event.tool,
          args: event.args,
          sessionID: event.sessionID,
          callID: event.callID,
          output: output.output,
        })
        if (d.action === "replace") {
          output.output = d.text
          output.metadata = { ...(output.metadata ?? {}), trustguard: { replaced: true, reason: d.reason } }
        }
      },

      "chat.message": async (event, output) => {
        const text = (output?.parts ?? [])
          .filter((p: any) => p?.type === "text" && typeof p.text === "string" && !p.synthetic)
          .map((p: any) => p.text as string)
          .join("\n")
        const v = await guard.checkPrompt({ text, sessionID: event.sessionID, messageID: event.messageID })
        if (v.permission === "deny") throw new TrustGuardBlockedError(v.message || BLOCKED_MESSAGE)
      },
    }
  }
}

// ---------------------------------------------------------------- V2 adapter

export function createV2Setup(factory: FactoryOptions = {}): V2Setup {
  return async (ctx) => {
    const log: Logger = factory.log ?? ((level, message) => {
      if (level !== "debug") console.error(`${LOG_PREFIX}: ${message}`)
    })
    const guard = new Guard({
      config: loadConfig({ env: factory.env, options: (ctx as any).options as Record<string, unknown> }),
      fetch: factory.fetch,
      log,
      hostAttributes: { host: "opencode", plugin_api: "v2", directory: (ctx as any).location?.directory },
    })

    // Messages for pending TrustGuard approvals, keyed by tool call id.
    const pending = new Map<string, string>()

    await ctx.permission.hook("evaluate", (event) => {
      if (event.action !== APPROVAL_ACTION) return
      // A configured `deny` rule never reaches hooks; anything else becomes an approval prompt.
      event.effect = "ask"
      const message = (event.source && pending.get(event.source.id)) || ASK_MESSAGE
      event.message = message
    })

    await ctx.tool.hook("execute.before", async (event) => {
      const v = await guard.checkToolCall({
        tool: event.tool,
        args: event.input,
        sessionID: event.sessionID,
        callID: event.id,
        agent: event.agent,
        messageID: event.messageID,
      })
      if (v.permission === "deny") throw new TrustGuardBlockedError(v.message || BLOCKED_MESSAGE)
      if (v.permission === "ask") {
        const message = v.message || ASK_MESSAGE
        pending.set(event.id, message)
        try {
          // Opens OpenCode's approval prompt; rejects (and so blocks the tool) if the user declines.
          await ctx.permission.assert({
            sessionID: event.sessionID,
            agent: event.agent,
            action: APPROVAL_ACTION,
            resources: [event.tool],
            save: [],
            metadata: { tool: event.tool, reason: message, status: v.status },
            source: { type: "tool", messageID: event.messageID, id: event.id },
          } as any)
        } finally {
          pending.delete(event.id)
        }
      }
    })

    await ctx.tool.hook("execute.after", async (event) => {
      if (event.status !== "completed") return
      const text = resultText(event.result?.content)
      if (text === undefined) return
      const d = await guard.checkToolResult({
        tool: event.tool,
        args: event.input,
        sessionID: event.sessionID,
        callID: event.id,
        agent: event.agent,
        messageID: event.messageID,
        output: text,
      })
      if (d.action === "replace") {
        event.result = {
          ...event.result,
          output: undefined,
          content: d.text,
          metadata: { ...(event.result?.metadata ?? {}), trustguard: { replaced: true, reason: d.reason } },
        }
      }
    })

    await ctx.session.hook("prompt", async (event) => {
      const text = typeof event.prompt?.text === "string" ? event.prompt.text : ""
      const v = await guard.checkPrompt({ text, sessionID: event.sessionID, messageID: event.messageID })
      // V2 prompt hooks have no typed rejection API: throwing makes admission fail, so the prompt is not sent.
      if (v.permission === "deny") throw new TrustGuardBlockedError(v.message || BLOCKED_MESSAGE)
    })
  }
}

function resultText(content: unknown): string | undefined {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return undefined
  const texts = content.filter((c: any) => c?.type === "text" && typeof c.text === "string").map((c: any) => c.text as string)
  return texts.length ? texts.join("\n") : undefined
}

// ---------------------------------------------------------------- default export

const plugin = {
  id: PLUGIN_ID,
  setup: createV2Setup(),
  server: createV1Server(),
}

export default plugin
