# Piano: plugin TrustGuard per OpenCode

Stato al 11/11/2026: bozza locale in `/workspace/trustguard-opencode-plugin`, build e 26 test verdi, caricata e
verificata end-to-end su OpenCode 1.19.5 (V1) e 2.2.7 (V2) con un TrustGuard finto. Niente publish, niente push,
nessuna PR aperta.

## 1. API TrustGuard (da riusare, uguale agli hook Claude Code e Cursor)

- Endpoint: `POST {TRUSTGUARD_DATA_URL}/v1/evaluate` (doc: https://docs.neuraltrust.ai/trustguard/api/evaluate).
  SaaS: `https://trustguard.neuraltrust.ai`, default del plugin (verificato con una chiave reale il 12/11/2026;
  gli hook Go usano ancora `http://localhost:8081`). Per altre regioni o self-hosted: tab **Connection** del collector.
- Auth: `Authorization: Bearer <tgk_…>` (chiave del collector, lega il collector lato server).
- Body: `{ payload, direction: input|output, protocol: llm|mcp|all, session_id?, consumer_id?, attributes }`.
  - Prompt utente → `protocol: llm`, `payload.messages=[{role:"user",content}]`.
  - Prima del tool → `protocol: mcp`, `tools/call` con `name` + `arguments`. Anche per la shell
    (scelta ENG-1620 del plugin Claude Code, ottobre 2026; il plugin Cursor v0.1.6 manda ancora la shell come
    `protocol: all`, `{input: cmd}`).
  - Dopo il tool → `protocol: mcp`, `direction: output`, `result.content[0].text` (troncato a 256 KiB).
  - `attributes`: `collector.type=ide`, `source.application=opencode-plugin`, `opencode.{tool,session_id,call_id,agent,…}`.
- Risposta: `status` ∈ allow · report · transform · ask · block · skip, `findings[]`, `trace_id`, `transformed_payload`.
  HTTP 200 anche per `block`; ogni non-200 (400/401/402/403/429/500/503), timeout o errore di rete → fail mode.
- Criterio (applyVerdict identico): block → deny; transform → `TRUSTGUARD_TRANSFORM_ACTION` (default ask);
  ask → ask; report → allow con notice; allow/skip/altro → allow. Motivo = primaryReason (finding applicato con
  confidenza più alta, nome del gate o `signal (detector)`).
- Config: `TRUSTGUARD_API_KEY`, `TRUSTGUARD_DATA_URL`, `TRUSTGUARD_FAIL_MODE` (open default), `TRUSTGUARD_TRANSFORM_ACTION`,
  `TRUSTGUARD_TIMEOUT_MS` (5000), `TRUSTGUARD_CONSUMER_ID`; file utente `~/.trustguard/opencode.json`, file gestito MDM
  `/etc/trustguard/opencode.json` (+ macOS/Windows) che blocca api_key/data_url/fail_mode. Senza chiave: allow + warning.

## 2. API plugin di OpenCode: tutti gli hook e cosa serve a TrustGuard

OpenCode ha due API. La npm `opencode-ai` latest è ancora **1.19.5 (V1)**; la V2 è `@opencode/cli` 2.2.7 e la doc
principale (opencode.ai/docs) ora è V2. Un solo pacchetto può servire entrambe: default export con `id` + `setup()`
(V2) e `server()` (V1, oggetto supportato da 1.18.29).

| Hook V1 (`@opencode-ai/plugin`) | Equivalente V2 (`@opencode/plugin`) | Per TrustGuard |
| --- | --- | --- |
| `tool.execute.before(input{tool,sessionID,callID}, output{args})` — throw blocca | `ctx.tool.hook("execute.before", e{tool,input,sessionID,agent,messageID,id})` — throw blocca, `e.input` modificabile | **Sì, principale** (= PreToolUse). Usato. |
| `tool.execute.after(input{tool,args,…}, output{title,output,metadata})` — output modificabile | `ctx.tool.hook("execute.after", e{status, result|error})` — `e.result` sostituibile | **Sì** (= PostToolUse): prompt injection indiretta e DLP sull'output. A differenza di Claude Code/Cursor qui si può **sostituire** il risultato (mascherato o trattenuto). Usato. |
| `chat.message(input{sessionID,…}, output{message,parts})` | `ctx.session.hook("prompt", e{prompt.text,…})` — throw = prompt non ammesso | **Sì** (= UserPromptSubmit): jailbreak/DLP sul prompt. Usato; il blocco funziona ma l'utente vede un errore generico (500). |
| `permission.ask(Permission, output{status})` | `ctx.permission.hook("evaluate", e{action,resources,effect,message})` | **V2 sì**: con `ctx.permission.assert({action:"trustguard"})` trasforma il verdetto `ask` in un vero prompt di approvazione. Usato su V2. In V1 non c'è modo di chiedere: `ask` → blocco. |
| `shell.env` | `ctx.shell.hook("create.before", {command,cwd,env,…})` | Facoltativo: la shell passa già da execute.before. Utile solo per un controllo extra sulla riga di comando effettiva. Non usato. |
| `chat.params`, `chat.headers`, `experimental.chat.system.transform`, `experimental.chat.messages.transform` | `ctx.session.hook("context" / "model.request" / "http.request" / "http.response")` | Possibile evoluzione: valutare l'intera richiesta al modello o la risposta (`direction: output`, protocollo llm) come fa l'hook Claude Enterprise. Non necessario per la v0.1. |
| `command.execute.before` | command transform / prompt hook | No (i comandi passano dal prompt). |
| `event` (session.idle, message.updated, permission.*, file.edited…) | `ctx.event.subscribe()` | Solo osservabilità/audit (es. inviare `report` asincroni). Non usato. |
| `tool.definition`, `tool` map | `ctx.tool.transform` | Facoltativo: scansione delle descrizioni dei tool MCP (tool poisoning). Idea per v0.2. |
| `config`, `auth`, `provider`, `experimental.session.compacting`, `experimental.text.complete` | transform di dominio, `session.hook("compaction")` | No. |

Installazione: V1 `"plugin": ["nome-npm"]` o file in `.opencode/plugin/`; V2 `"plugins": ["nome-npm" | "./dir"]`
(directory, non file singoli), `.opencode/plugins/`, oppure `opencode plugin add <nome>`.

## 3. Struttura del plugin (fatta)

```
trustguard-opencode-plugin/
├── src/config.ts    env > options > ~/.trustguard/opencode.json > file MDM > default (lock in managed mode)
├── src/client.ts    POST /v1/evaluate, Bearer, timeout con AbortController, limite 1 MiB, non-200 = errore
├── src/guard.ts     core host-agnostico: checkToolCall / checkToolResult / checkPrompt, applyVerdict, primaryReason
├── src/index.ts     adapter V1 (server) + V2 (setup), default export { id: "neuraltrust.trustguard", setup, server }
├── test/*.test.ts   26 test node:test con fetch mockato (config, client, verdetti, V1, V2)
├── test/e2e/        TrustGuard e LLM finti per la verifica manuale in OpenCode reale
├── examples/        opencode.json V1/V2 e file gestito MDM
├── README.md · LICENSE (Apache-2.0, come i plugin Claude Code/Cursor/Copilot/Gemini) · ECOSYSTEM_PR.md · ecosystem.diff
```

Zero dipendenze runtime (`Plugin.define` è un'identità, quindi solo `import type`); `@opencode/plugin` e
`@opencode-ai/plugin` sono peer opzionali + devDependencies.

## 4. Pacchetto npm

- Nome proposto: **`@neuraltrust/opencode-trustguard`** (libero al 11/11/2026; liberi anche `opencode-trustguard`,
  `@neuraltrust/trustguard-opencode-plugin`, `trustguard-opencode-plugin`). Lo scope `@neuraltrust` esiste già
  (trustguard-sdk, trustgate, n8n-nodes-trustguard) e gli altri pacchetti escono via GitHub Actions con trusted
  publishing OIDC.
- Repo proposto: `NeuralTrust/trustguard-opencode-plugin` (stessa convenzione `trustguard-<host>-plugin`).
- Contenuto (`npm pack --dry-run`): `dist/*.js`, `dist/*.d.ts`, README, LICENSE, package.json; `prepack` esegue la build.
- Passi per pubblicare (da fare solo con il via):
  1. creare il repo GitHub e fare push della bozza;
  2. aggiungere CI (build + test) e un workflow di release con `npm publish --provenance --access public`
     via trusted publisher, come per `@neuraltrust/trustguard-sdk`;
  3. tag `v0.1.0`, release;
  4. verificare il pacchetto installato da npm (`opencode plugin add @neuraltrust/opencode-trustguard`) su V2 e V1.

## 5. Test

- Fatto: 26 test unitari (fetch mockato, nessuna rete) — `npm test`.
- Fatto: e2e reale su OpenCode 1.19.5 e 2.2.7 con il tarball `npm pack` installato, un TrustGuard finto e un modello
  finto OpenAI-compatible: `rm -rf` bloccato (directory intatta, il modello riceve il motivo), output con segreto
  mascherato prima di arrivare al modello, prompt "jailbreak" mai inviato al modello, `ask` → richiesta di permesso
  V2 (approvata con `--auto`, rifiutata nei run non interattivi).
- Da fare con una chiave vera: collector `tgk_…` in un workspace di prova, policy con Prompt Guard, DLP, code
  sanitation e un gate Ask; ripetere gli scenari e controllare le valutazioni nella console (trace_id).
- Da fare: prompt `ask` nella TUI interattiva V2; installazione da npm su V1 (`"plugin": [nome]`); Windows/macOS.

## 6. PR sulla pagina Ecosystem

- File: `services/site/src/docs/v1/content/ecosystem.mdx` su `anomalyco/opencode` (branch `dev`); spostato il
  10/11/2026 da `packages/web/...` (#63117).
- Una riga in fondo alla tabella Plugins; diff pronto e formattato con prettier in `ecosystem.diff`; titolo
  `docs(ecosystem): add @neuraltrust/opencode-trustguard plugin`; body sul template in `ECOSYSTEM_PR.md`.
- Ordine consigliato: pubblicare su npm e rendere pubblico il repo → (facoltativo) issue feature come VibeGuard →
  fork, branch, commit della riga, PR con screenshot del blocco nella TUI.
- Riferimenti: JFrog #26019, Daytona #10917, VibeGuard #15464 (tutti mergiati entro ~24 h).

## 7. Punti aperti

- Tipo di collector: nella console c'è il catalogo "Coding agents" (Claude Code, Cursor, …); serve un tipo
  "OpenCode" o va usato un collector generico? Il plugin manda `collector.type=ide`, `source.application=opencode-plugin`.
- Shell come `mcp tools/call` (Claude Code, ENG-1620) o `all {input}` (Cursor v0.1.6): confermare con il team.
- Email utente: OpenCode non espone un account; si usa solo `TRUSTGUARD_CONSUMER_ID` se impostato.
- UX del blocco del prompt: OpenCode mostra un errore generico (500 / "Unexpected server error"); il motivo è nei log.
- V2 `ask` e `--auto`: `opencode run --auto` approva anche le richieste TrustGuard; se serve un ask non aggirabile
  usare `TRUSTGUARD_TRANSFORM_ACTION=deny` / gate Block.
- Doppia API: la PR va sulla doc V1 (l'unica con la pagina Ecosystem); la V1 object entrypoint richiede ≥ 1.18.29.
