# Manual end-to-end check (no real API key needed)

`mock-servers.mjs` starts a fake TrustGuard data plane on `127.0.0.1:8099` and a fake OpenAI-compatible model on
`127.0.0.1:8098` that always answers with one tool call read from `scenario.txt` (`<tool>|<command>`).
The fake TrustGuard blocks payloads containing `rm -rf` or `JAILBREAK-PLEASE`, returns `ask` for `ASK-ME` and a
DLP `transform` (masked text) for tool output containing `SECRET-TOKEN`. Requests are appended to
`trustguard-requests.jsonl`, model requests to `llm-requests.jsonl` (paths are set at the top of the file).

1. `npm pack` and `npm i ../neuraltrust-opencode-trustguard-<version>.tgz` in a scratch project.
2. V2 `opencode.json`: `"plugins": ["./node_modules/@neuraltrust/opencode-trustguard"]`, plus a `providers.mock`
   entry with `package: "@opencode/ai/providers/openai-compatible"` and `settings.baseURL: "http://127.0.0.1:8098/v1"`.
   V1: `.opencode/plugin/trustguard.js` with `export { default } from "@neuraltrust/opencode-trustguard"` and a
   `provider.mock` entry with `npm: "@ai-sdk/openai-compatible"`.
3. `TRUSTGUARD_API_KEY=tgk_fake TRUSTGUARD_DATA_URL=http://127.0.0.1:8099 opencode run --standalone --auto "..."`
   (V1: `opencode run "..."`).
