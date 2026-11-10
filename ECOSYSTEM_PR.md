# Draft PR: add TrustGuard to the OpenCode Ecosystem page

> Draft only. Nothing has been pushed or opened. Open it only after the package is published on npm and the
> GitHub repo `NeuralTrust/trustguard-opencode-plugin` is public (maintainers check both links).

## Target

- Repository: `anomalyco/opencode` (`sst/opencode` redirects here), base branch **`dev`**
- File: **`services/site/src/docs/v1/content/ecosystem.mdx`**
  (moved on 2026-11-10 by #63117 from `packages/web/src/content/docs/ecosystem.mdx`; translated copies under
  `services/site/src/docs/v1/content/<lang>/ecosystem.mdx` are not touched by plugin PRs)
- Section: `## Plugins` table, new last row right after `opencode-supabase` (recent PRs #38709, #49848 append at the end)
- The V2 docs (`services/site/src/docs/content/`) have no ecosystem page yet; the live page
  https://opencode.ai/docs/ecosystem/ is rendered from the V1 file above.

## Exact change (prettier 3.6.2, `semi: false`, `printWidth: 120` as in the repo; column widths unchanged)

```diff
--- a/services/site/src/docs/v1/content/ecosystem.mdx
+++ b/services/site/src/docs/v1/content/ecosystem.mdx
@@ -48,6 +48,7 @@
 | [opencode-goal-plugin](https://github.com/willytop8/OpenCode-goal-plugin)                          | Session-scoped `/goal` workflow that keeps objectives in context and auto-continues until complete                               |
 | [opencode-tavily](https://github.com/tavily-ai/opencode-tavily)                                    | Web search, extraction, crawling, and deep research via the Tavily CLI                                                           |
 | [opencode-supabase](https://github.com/supabase-community/opencode-supabase)                       | Supabase plugin for OpenCode: account login, Management API tools, bundled Supabase agent skills, and guided Supabase MCP setup. |
+| [@neuraltrust/opencode-trustguard](https://github.com/NeuralTrust/trustguard-opencode-plugin)      | Screen prompts, tool calls and tool output with NeuralTrust TrustGuard; block risky commands before they run                     |
 
 ---
 
```

Line to add (copy-paste):

```
| [@neuraltrust/opencode-trustguard](https://github.com/NeuralTrust/trustguard-opencode-plugin)      | Screen prompts, tool calls and tool output with NeuralTrust TrustGuard; block risky commands before they run                     |
```

The same diff is in `ecosystem.diff` (apply with `git apply ecosystem.diff` from the opencode repo root).

## PR title (conventional, as CONTRIBUTING requires)

```
docs(ecosystem): add @neuraltrust/opencode-trustguard plugin
```

## PR body (follows `.github/pull_request_template.md`; keep it short, the template warns that long AI-looking
descriptions get closed)

```markdown
### Issue for this PR

Closes #<issue number — optional for docs PRs, see note below>

### Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor / code improvement
- [x] Documentation

### What does this PR do?

Adds `@neuraltrust/opencode-trustguard` to the Ecosystem → Plugins table (one row).

The plugin checks prompts, tool calls and tool results with NeuralTrust TrustGuard and blocks risky commands
before they run (`tool.execute.before` on V1, `ctx.tool.hook("execute.before")` on V2). It is an external
plugin, no core changes.

- GitHub: https://github.com/NeuralTrust/trustguard-opencode-plugin
- npm: https://www.npmjs.com/package/@neuraltrust/opencode-trustguard

### How did you verify your code works?

Ran prettier on the file (no other lines changed) and checked the table renders. The plugin itself was tested
on OpenCode 1.19.5 and 2.2.7 against a TrustGuard endpoint: a blocked `rm -rf` never runs and the model gets
the reason as the tool error.

### Screenshots / recordings

<screenshot of the blocked tool call in the TUI>

### Checklist

- [x] I have tested my changes locally
- [x] I have not included unrelated changes in this PR
```

## What the reference PRs show

| PR | Title | Format | Review |
| --- | --- | --- | --- |
| [#26019 JFrog](https://github.com/anomalyco/opencode/pull/26019) | `docs: add opencode-jfrog-plugin to ecosystem list for JFrog integration` | 1 row appended at the end of the Plugins table, link to the GitHub repo | Opened 2026-05-06, merged next day by `rekram1-node`. The `pr-standards` bot first flagged the description; the author fixed the template sections and the bot then said it met the guidelines. Screenshot attached. |
| [#10917 Daytona](https://github.com/anomalyco/opencode/pull/10917) | `docs: add Daytona OpenCode plugin to ecosystem` | 1 row inserted at the top of the table, link to a repo subfolder | Opened and merged the same day (2026-01-28) by `rekram1-node`. Bot asked for a linked issue (the rule has since been relaxed for docs). Demo video attached; link later fixed in #11621, #15979, #42048. |
| [#15464 VibeGuard](https://github.com/anomalyco/opencode/pull/15464) | `docs(ecosystem): add opencode-vibeguard` | 1 row in the middle of the table | Opened 2026-02-28, merged next day by `nexxeln`, no comments. Author first opened feature issue [#15463](https://github.com/anomalyco/opencode/issues/15463) ("[FEATURE]: Add opencode-vibeguard to ecosystem plugins list") and wrote `Closes #15463`; verified with `bun run --cwd packages/web build`. |

Maintainer requirements gathered from `CONTRIBUTING.md`, the PR template and `triage-pr-standards.yml`:

- Conventional title `type(scope): summary` (`docs(ecosystem): …` is the usual one).
- Fill in every template section; PRs that skip the template are labelled and may be auto-closed.
- Documentation PRs are exempt from the linked-issue check today, but the VibeGuard route (short feature issue first,
  then `Closes #…`) is the safest path and was merged fastest without bot noise.
- Short, human description; long AI-generated descriptions "may be IGNORED or CLOSED".
- One focused change, base branch `dev`.
- Merges for this table are typically within 24 h, by `rekram1-node` or `nexxeln`.

## Optional feature issue (VibeGuard style), to open before the PR

Title: `[FEATURE]: Add @neuraltrust/opencode-trustguard to ecosystem plugins list`

```markdown
### Describe the enhancement you want to request

I'd like to add a community plugin to the Ecosystem → Plugins list.

Plugin: @neuraltrust/opencode-trustguard
- GitHub: https://github.com/NeuralTrust/trustguard-opencode-plugin
- npm: https://www.npmjs.com/package/@neuraltrust/opencode-trustguard

It checks prompts, tool calls and tool output with NeuralTrust TrustGuard and blocks risky tool calls before
they run. Purely an external plugin, no core changes. If that's OK I'll open a PR adding one row to
`services/site/src/docs/v1/content/ecosystem.mdx`.
```
