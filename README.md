# dsh-prompt-enhancer-plus

Adds a **✨ Enhance prompt** button to the DSH composer tool row, right after the permission control. One click turns a short or vague draft into a clearer, more detailed prompt, then opens a preview for you to review before anything is written back.

- Works with the current session's model; no separate API key is needed.
- Keeps the original language: Chinese input stays Chinese, English stays English, mixed input keeps its mix.
- **Preview before applying:** inspect the result, switch modes, copy it, or replace the draft explicitly.
- **Four modes:** general enhancement, system prompt, task brief, and concise polish.
- **Undo is built in:** after replacing the draft, the original is kept for 10 seconds and can be restored with one click; if you edit the draft while a request is running, the result is not applied.
- **Recent history:** the last five enhancements per session stay on this device and can be reopened from the preview.
- **Usage metadata:** the preview shows the model route, token usage when the provider reports it, and elapsed time.
- Never sends anything by itself — you still review and submit the draft.
- Button is disabled for an empty draft and reports failures inline.
- Localized in English and Simplified Chinese; other active locales fall back to English.
- Calls the model only when you click; each click consumes a small number of tokens.

## Install

For a DSH Web profile:

```sh
dsh plugin --profile web add github:Erfan817/dsh-prompt-enhancer-plus
```

The GitHub release also carries a packaged tarball under the `v1.2.1` tag.

## Configuration

The bundle row under `dsh.profile.bundles` / `cordis.patch.yml` accepts these optional values:

```yaml
- id: prompt-enhancer-plus
  name: dsh-prompt-enhancer-plus
  config:
    maxInputChars: 12000
    maxOutputTokens: 3000
    timeoutMs: 90000
    # Optional: replaces the built-in mode prompt; the language-preservation
    # rule is still prepended automatically.
    systemPrompt: |
      Rewrite the user's request as a concise task brief.
```

All values are optional; invalid or non-positive numbers fall back to the defaults above.

## Files

- `index.js` — Host half. Registers the authenticated `POST /api/prompt-enhancer-plus/enhance` route, resolves the current session model, applies the selected mode, and returns text plus usage metadata.
- `client.js` — Client half. Registers the toolbar button and the floating preview in `conversation.input.overlay`.
- `locale/*.json` — Plugin Manager metadata.
- `icon.svg` — Plugin icon.

## Development

```sh
node --check index.js
node --check client.js
node test-host.mjs
node test-client.mjs
npm pack --dry-run
```

## Known limitations

- The plugin currently works on plain text drafts; reference chips inside a draft are not preserved when the enhanced text is written back.
- History is stored locally in the browser's localStorage and is per session.
- Other UI locales fall back to English until their dictionaries are added.

## License

MIT
