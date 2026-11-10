import http from "node:http"
import fs from "node:fs"
const LOG = "/workspace/e2e/trustguard-requests.jsonl"
const SCENARIO = process.env.SCENARIO_FILE || "/workspace/e2e/scenario.txt"

// ---- Mock TrustGuard data plane (port 8099)
http.createServer((req, res) => {
  let body = ""
  req.on("data", (c) => (body += c))
  req.on("end", () => {
    const parsed = body ? JSON.parse(body) : {}
    fs.appendFileSync(LOG, JSON.stringify({ path: req.url, auth: req.headers.authorization, body: parsed }) + "\n")
    const s = JSON.stringify(parsed.payload ?? {})
    let out = { status: "allow", findings: [], trace_id: "tr_mock" }
    if (s.includes("rm -rf")) out = { status: "block", trace_id: "tr_block", findings: [{ source: { kind: "detector", detector_name: "code_sanitation" }, signal: { type: "dangerous_command", confidence: 0.99 }, outcome: { action: "block" } }] }
    else if (parsed.direction === "output" && s.includes("SECRET-TOKEN")) out = { status: "transform", trace_id: "tr_tf", findings: [{ source: { detector_name: "dlp" }, signal: { type: "secret" }, outcome: { action: "transform" } }], transformed_payload: { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "token=[MASKED]" }] } } }
    else if (parsed.direction !== "output" && s.includes("ASK-ME")) out = { status: "ask", trace_id: "tr_ask", findings: [{ source: { gate_name: "Approve network calls" }, signal: { type: "gate_ask" }, outcome: { action: "ask" } }] }
    else if (s.includes("JAILBREAK-PLEASE")) out = { status: "block", trace_id: "tr_jb", findings: [{ source: { detector_name: "prompt_guard" }, signal: { type: "jailbreak", confidence: 0.98 }, outcome: { action: "block" } }] }
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify(out))
  })
}).listen(8099, "127.0.0.1")

// ---- Mock OpenAI-compatible LLM (port 8098)
function sse(res, chunks) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" })
  for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`)
  res.write("data: [DONE]\n\n")
  res.end()
}
const base = { id: "chatcmpl-1", object: "chat.completion.chunk", created: 1, model: "m" }
http.createServer((req, res) => {
  let body = ""
  req.on("data", (c) => (body += c))
  req.on("end", () => {
    if (!req.url.includes("chat/completions")) { res.writeHead(404); return res.end() }
    const parsed = JSON.parse(body)
    fs.appendFileSync("/workspace/e2e/llm-requests.jsonl", JSON.stringify({ n: parsed.messages.length, tools: (parsed.tools||[]).map(t=>t.function?.name), last: parsed.messages.at(-1) }) + "\n")
    const last = parsed.messages.at(-1)
    const userTurn = [...parsed.messages].reverse().find((m) => m.role === "user")
    const userText = typeof userTurn?.content === "string" ? userTurn.content : JSON.stringify(userTurn?.content)
    if (last.role === "tool" || !parsed.tools || /title|summar/i.test(JSON.stringify(parsed.messages[0]?.content ?? "")) && !parsed.tools) {
      return sse(res, [
        { ...base, choices: [{ index: 0, delta: { role: "assistant", content: "done" }, finish_reason: null }] },
        { ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
      ])
    }
    const [toolName, command] = fs.readFileSync(SCENARIO, "utf8").trim().split("|")
    sse(res, [
      { ...base, choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "call_e2e_1", type: "function", function: { name: toolName, arguments: "" } }] }, finish_reason: null }] },
      { ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ command, description: "e2e test command" }) } }] }, finish_reason: null }] },
      { ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    ])
  })
}).listen(8098, "127.0.0.1")
console.log("mock servers up")
