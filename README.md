# Prompt Spark

English · [中文](README.zh.md)

**Version 1.4.0 source.** GitHub Releases and npm are published separately; the source version alone does not imply a new packaged release.

The project is now named **Prompt Spark**. Its DSH/npm package identifier remains `dsh-prompt-enhancer-plus` for compatibility with existing installations.

One enhancement core, two entry points: improve drafts inside DeepSeek Harness, or use a standalone desktop window and paste its results into Claude, Codex, or another AI application. Nothing sends a chat message automatically.

## What's new

- **Full-text, editable previews:** a spacious DSH review window with an expanded view instead of a six-row text box. Long results use one document scroll area; arbitrarily long text cannot all fit on one screen.
- **Natural plain text by default:** proportional paragraphs rather than decorative headings, bold markers, or mandatory role/goal/constraints templates. Markdown remains an explicit output option.
- **Domain-neutral editing:** preserves language, facts, scope, and concrete syntax without assuming every request is a coding task.
- **Universal local companion:** Node.js plus your existing browser, with full-text editing, copy, fullscreen, and cancellation. Electron is optional, not required; native pin/global-shortcut features remain in its development entry point.
- **Shared rules:** both entry points use the dependency-free `prompt-core.js` and the same five built-in enhancement personas.

Existing reusable personas, stale-draft protection, five-entry recent history, and ten-second undo remain available in DSH.

## DSH workflow

Write your draft and click **Enhance prompt** in the composer toolbar. Read and edit the full result, then **Replace draft** or **Copy**. Those actions use the currently edited result, not the unedited original response. Replacement does not submit the draft.

General, system-prompt, task-brief, and concise modes remain available. Choosing a new mode or output format and regenerating makes another model request. Model usage, history, and persona management are secondary to the text. Escape closes the review window.

The captured insertion revision remains authoritative: an edited draft, even if its text is later restored, or a composer that no longer permits editing rejects a stale replacement. The original draft can be restored for ten seconds after a successful replacement.

### Reusable enhancement personas

Personas save **how to rewrite**, not a task. Presets are Balanced, Product manager, Engineering reviewer, Writing coach, and Minimalist. Duplicate a read-only preset to customize it; custom personas can be edited or deleted. Deleting the selected custom persona returns to Balanced.

**Save this direction as a persona** copies the directions captured for that request into an editable form. It never treats the task or generated result as reusable directions, never guesses a persona from legacy history, and never calls a model to save one. Mode chooses the output type; persona adds domain, style, or constraints. Neither changes the main assistant, its permissions, or the session system prompt.

The Host owns the library through DSH `storageDomain` (`prompt_enhancer_plus_personas`), shared across its sessions and independent of the Web port. Revision checks protect writes. Limits are 50 custom personas, 60-character names, 4000 characters per direction field, and 10000 total direction characters. Conflicts retain the form for review; failed writes are not reported as success.

## Cross-application desktop companion

“Cross-application” means the same enhancement window can produce text for different clients. It does not mean a Cordis package can be installed unchanged into every client.

From the repository root, with Node.js 22 or newer recommended:

```sh
npm install --ignore-scripts
npm run desktop
```

On Windows, `启动通用窗口.cmd` launches the default local companion directly. No Electron download or additional browser is required. It listens on a random loopback-only `127.0.0.1` port and opens your default browser; if opening fails, use the local URL printed in the terminal.

1. Open **Settings** and enter an API base URL, model ID, and your own API key.
2. Enter or paste your draft, select a mode and direction, and generate.
3. Read or edit the result, copy the complete text, and paste it manually into the target application.
4. Use `Ctrl/Cmd+Enter` to generate. Browser mode does not provide a native global shortcut or always-on-top control and does not read other applications' composers.
5. Keep the terminal running. Closing the browser tab does not stop the server; choose **Quit** in the interface or press `Ctrl+C` in the terminal. Task text and in-memory keys do not survive server exit.

The optional Electron development entry point retains native pin/global-shortcut features, but native startup crashes on the current machine and is not the default:

```sh
npm run desktop:setup
npm run desktop:electron
```

Setup downloads Electron only for that optional entry point. DSH and the default local window do not need it. Do not disable the sandbox or alter system permissions to work around native startup failures. The optional launcher clears an inherited `ELECTRON_RUN_AS_NODE` for its child without modifying the parent environment.

The initial standalone interface is Simplified Chinese. DSH retains English and Simplified Chinese localization, falling back to English for other locales.

### Model connections

| Adapter | Example API base URL | Model |
| --- | --- | --- |
| DeepSeek / OpenAI-compatible Chat Completions | `https://api.deepseek.com` or `https://api.openai.com/v1` | Provider's model ID |
| Local OpenAI-compatible endpoint | `http://localhost:1234/v1` | Local server's model ID; key may be empty |
| Anthropic Messages | `https://api.anthropic.com/v1` | Model ID from Anthropic Console |

A complete `/chat/completions` or `/messages` URL is also accepted. Remote endpoints require HTTPS; loopback `localhost`, `127.0.0.1`, and `::1` may use HTTP. Redirects are refused so authorization headers cannot follow an API redirect to another destination.

The first desktop adapter uses non-streaming text calls, a 12000-character input limit, a 3000-token output limit, and a 90-second timeout. A service without Chat Completions or Messages compatibility needs a separate adapter, and models requiring provider-specific parameters can reject these calls. Truncated, tool-call, or otherwise incomplete completions are not reported as complete prompts.

The target client and the enhancement model are independent. For example, enhance with DeepSeek and use the result in Claude. The companion does not automatically share any client's subscriptions, cookies, or login. Use a provider's supported API/authentication and billing path.

### Privacy and security

- No other client's composer, clipboard, credentials, or configuration is read. Copy writes plain text only on your explicit action; there is no automatic paste or send.
- Only generation sends the draft and directions to the configured API. Saving settings and selecting a direction do not call a model.
- Default browser mode keeps keys in the server process memory only. Only the optional Electron entry supports OS-backed `safeStorage` persistence; missing secure storage or Linux's `basic_text` backend refuses persistence rather than falling back to plaintext.
- Saved or in-memory keys are not returned to the page. Changing the API URL or adapter without supplying a fresh key clears the previous key to prevent accidental credential forwarding.
- The companion stores non-sensitive configuration and explicitly authored reusable directions, not task history. Its storage is separate from DSH's custom persona library; no automatic import or synchronization is performed.
- The loopback server checks exact Host/Origin and a random bearer token, exposes no CORS access, uses a static-file allowlist, and prevents cross-site embedding. Only its Node backend calls the model API.
- The optional Electron renderer disables Node access, enables context isolation/sandboxing, and denies external navigation/new windows.

### Compatibility boundary

This iteration provides a local browser-backed window and DSH-native entry point, not a native Claude/Codex composer extension, MCP server, MCP App, or automatic current-draft read/write. Those adapters can be built around the same core but require per-host verification. The local source targets desktop browsers on Windows/macOS/Linux; no claim of completed visual validation on all operating systems is made. No signed standalone installer is included.

## Plain text and literal symbols

Plain text is primarily enforced by generation instructions. It does not change a requested deliverable's format: a draft asking for a Markdown document still asks for a Markdown document.

Conservative normalization removes identifiable model wrappers and unambiguous newly introduced heading decorations. It does not globally delete asterisks, hashes, backticks, formulas, code, or examples. Meaningful `C#`, `*.ts`, tags, commands, and user-provided literal text remain protected. Ambiguous formatting is preserved rather than silently corrupting content; no model-independent guarantee of zero Markdown symbols is made.

## DSH installation and configuration

Public releases remain whatever is actually published. A source directory can be installed through DSH's plugin manager. Local installation links that directory, so do not subsequently move or delete it. Replacing an already loaded Host module may require a DSH restart; a page refresh alone does not necessarily load a new Host generation.

Existing configuration remains supported:

```yaml
- id: prompt-enhancer-plus
  name: dsh-prompt-enhancer-plus
  config:
    maxInputChars: 12000
    maxOutputTokens: 3000
    timeoutMs: 90000
    systemPrompt: |
      Rewrite the request as a concise task brief.
```

Requires DSH 0.2.2-rc.1 or a compatible newer release with `connection`, `llm`, `agents`, `agentDefaultModel`, and `storageDomain`. The existing original sparkle icon is retained; no third-party brand artwork is introduced.

`systemPrompt` replaces the built-in mode instruction, followed by persona directions and mandatory output-format/language/facts/scope/rewrite-only guards. These final guards override conflicting custom directions. The default enhancement still makes one auxiliary model call.

### API and core

`POST /api/prompt-enhancer-plus/enhance` retains `text`, `sessionId`, `mode`, and `personaId`. Optional `format` is `plain` (default) or `markdown`; the response adds `format` while retaining text, usage, elapsed time, model, and captured persona fields.

Authenticated persona HTTP actions remain `GET /api/prompt-enhancer-plus/personas` and `POST` actions `list`, `save`, `select`, `delete`. Mutations require the latest `expectedRevision`.

The `prompt_enhancer` agent tool uses the same application operations, with optional `format` on `enhance`. List before mutating personas. It does not send messages, replace composer text, or change permissions.

`prompt-core.js`, also exported as `dsh-prompt-enhancer-plus/core`, has five named exports: `resolveMode`, `resolveFormat`, `enhancementSystem`, `inputFor`, and `normalizeEnhancedText`. It has no DSH, Node, or model-SDK dependency.

## Development and validation

```sh
npm install --ignore-scripts
npm test
node --check index.js
node --check client.js
npm pack --dry-run
npm run desktop:smoke
```

Unit tests require no Electron and call no real model. They cover core rules and symbol preservation, Host/tool compatibility, persona persistence/conflicts, pure Client state, API adapters, secret storage, and loopback HTTP security. The default desktop smoke command starts the real Node service and verifies page serving/authenticated initialization with isolated temporary configuration, without opening a browser, taking screenshots, or calling a model, then cleans up. Optional native startup is tested separately with `npm run desktop:electron:smoke`, which has not passed on the current machine.

Automated checks do not establish visual quality. Manually check light/dark themes, narrow windows, long editable results, focus/Escape behavior, and the intended provider API. Slot registration and installation alone are not visual verification.

## Known limitations

- DSH enhancements operate on text, not attachment contents; replacing a structured draft can flatten reference chips. Review references before applying.
- DSH's five-entry recent task history remains in per-session browser localStorage and can include inputs/results. It is not migrated, uploaded, or cleared; a Web port change can make previous browser history unavailable.
- Older history without `format` remains readable without regenerating or silently rewriting its text.
- Custom personas and the default selection persist on the DSH Host; companion configuration is independent.

## Working-copy validation record

- The complete `npm test` passes: 14 core groups, 21 Host groups, 13 persona groups, 13 real loopback HTTP security/lifecycle groups, Client state checks, and API adapter/storage checks.
- The current DSH profile is re-linked to this source directory through the plugin manager, with `application: applied`, version 1.4.0. The broken old-directory link is replaced; persona storage is not cleared.
- The existing GUI reports the new `shell.overlay` workspace and session bridge registrations. One real enhancement tool call returns `format: plain`, preserves `C#` and `*.ts`, and does not submit or replace a chat draft.
- Browser control is unavailable, so final visual appearance, focus, clipboard behavior, and long-text scrolling remain unverified.
- **The default companion now runs on Node and the existing browser, without Electron.** `npm run desktop:smoke` passes a real local-server startup, page serving, authenticated initialization, five personas, and disabled key persistence, without opening a browser or calling a model.
- The optional Electron entry still fails native validation: both tool execution and direct user launch exit with `0x80000003`; an isolated diagnostic also encounters temporary-directory `mkdtemp EPERM`, without establishing its exact permission cause. Windows permissions/security settings and the production sandbox policy are unchanged. The default entry avoids that runtime; no native Claude/Codex composer integration is claimed.

## License

MIT
