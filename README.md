# dsh-prompt-enhancer-plus

Adds a **✨ Enhance prompt** button to the DSH composer tool row, right after the permission control. One click turns a short or vague draft into a clearer, more detailed prompt, then writes the result back into the composer for you to review and edit.

- Works with the current session's model; no separate API key is needed.
- Keeps the original language: Chinese input stays Chinese, English stays English, mixed input keeps its mix.
- **Undo is built in:** after a replacement the original draft is kept for 10 seconds and can be restored with one click; if you edit the draft while the request is running, the result is not applied.
- Never sends anything by itself — you still review and submit the draft.
- Button is disabled for an empty draft and reports failures inline.
- Localized in English and Simplified Chinese.
- Calls the model only when you click; each click consumes a small number of tokens.

## Install

For a DSH Web profile:

```sh
dsh plugin --profile web add github:Erfan817/dsh-prompt-enhancer-plus
```

For DSH Desktop, install the package through its Plugin Manager once the npm package is available.

## Files

- `index.js` — Host half. Registers the authenticated `POST /api/prompt-enhancer-plus/enhance` route and calls the current session's model.
- `client.js` — Client half. Registers the button in `conversation.input.left` beside the permission control.
- `locale/*.json` — Plugin Manager metadata.
- `icon.svg` — Plugin icon.

## License

MIT
