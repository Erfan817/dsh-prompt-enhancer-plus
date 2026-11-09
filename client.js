window.__ModuleLoader__.load({
  id: 'dsh-prompt-enhancer-plus',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'promptEnhancerPlus';
    const MODES = ['general', 'system', 'task', 'concise'];
    const HISTORY_LIMIT = 5;
    const HISTORY_PREFIX = 'dsh-prompt-enhancer-plus:history:';

    const EN = {
      button: 'Enhance prompt',
      busy: 'Enhancing…',
      doneShort: 'Enhanced',
      hint: 'Use the current model to turn a short draft into a clear, detailed prompt. Consumes a small amount of tokens.',
      noRoute: 'No model route is available. Choose a model in the composer first.',
      tooLong: 'The draft is too long to enhance.',
      emptyResult: 'The model returned no text.',
      emptyInput: 'Enter some text to enhance first.',
      changed: 'The draft changed while enhancing, so the result was not applied.',
      failed: 'Enhancement failed. Please try again.',
      aborted: 'The model call was cancelled.',
      undo: 'Undo',
      undoHint: 'Restore the draft from before this enhancement',
      previewTitle: 'Prompt preview',
      close: 'Close',
      apply: 'Replace draft',
      copy: 'Copy',
      copied: 'Copied',
      cancel: 'Cancel',
      original: 'Original draft',
      history: 'Recent',
      modeLabel: 'Mode',
      modeGeneral: 'General',
      modeSystem: 'System prompt',
      modeTask: 'Task brief',
      modeConcise: 'Concise',
      usageUnknown: 'usage unavailable',
    };
    const ZH = {
      button: '强化提示词',
      busy: '强化中…',
      doneShort: '已强化',
      hint: '调用当前模型，把简短描述扩充成清晰、具体、可执行的提示词（会消耗少量 token）',
      noRoute: '当前没有可用的模型，请先在输入框中选择模型',
      tooLong: '输入内容过长，无法强化',
      emptyResult: '模型没有返回内容',
      emptyInput: '请先在输入框里写点内容',
      changed: '强化期间输入已修改，未替换结果',
      failed: '强化失败，请稍后重试',
      aborted: '模型调用已取消',
      undo: '撤销',
      undoHint: '恢复强化前的输入',
      previewTitle: '提示词预览',
      close: '关闭',
      apply: '替换草稿',
      copy: '复制',
      copied: '已复制',
      cancel: '取消',
      original: '原始草稿',
      history: '最近记录',
      modeLabel: '模式',
      modeGeneral: '通用强化',
      modeSystem: '系统提示词',
      modeTask: '任务描述',
      modeConcise: '简洁润色',
      usageUnknown: '用量未知',
    };

    function SparkleIcon() {
      return h('svg', {
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.8,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
      },
      h('path', { d: 'M12 3.5 13.6 8l4.4 1.6-4.4 1.7L12 15.7l-1.6-4.4L6 9.6 10.4 8 12 3.5Z' }),
      h('path', { d: 'M18.5 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z' })
      );
    }

    function formatUsage(usage, t) {
      if (usage === null || typeof usage !== 'object') return t('usageUnknown');
      const total = Number(usage.totalTokens);
      if (Number.isFinite(total)) return `${total} tokens`;
      const input = Number(usage.inputTokens);
      const output = Number(usage.outputTokens);
      if (Number.isFinite(input) || Number.isFinite(output)) {
        return `${Number.isFinite(input) ? input : 0} in / ${Number.isFinite(output) ? output : 0} out`;
      }
      return t('usageUnknown');
    }

    function formatElapsed(elapsedMs) {
      return Number.isFinite(elapsedMs) ? `${(elapsedMs / 1000).toFixed(1)}s` : '';
    }

    function truncate(text, size = 90) {
      const value = String(text ?? '').replace(/\s+/gu, ' ').trim();
      return value.length > size ? `${value.slice(0, size)}…` : value;
    }

    function useStore(store) {
      const [state, setState] = React.useState(() => store.get());
      React.useEffect(() => {
        const unsubscribe = store.subscribe(() => setState(store.get()));
        setState(store.get());
        return unsubscribe;
      }, [store]);
      return state;
    }

    function localizedError(code, message, t) {
      switch (code) {
        case 'no-route': return t('noRoute');
        case 'too-long': return t('tooLong');
        case 'empty-output': return t('emptyResult');
        case 'empty-input': return t('emptyInput');
        case 'aborted': return t('aborted');
        default: return message || t('failed');
      }
    }

    function createStore(sessionId) {
      const historyKey = HISTORY_PREFIX + sessionId;
      let state = {
        status: 'idle',
        mode: 'general',
        originalDraft: '',
        enhanced: '',
        error: '',
        usage: null,
        elapsedMs: null,
        model: null,
        undo: null,
        history: [],
      };
      try {
        const saved = window.localStorage.getItem(historyKey);
        const parsed = saved === null ? [] : JSON.parse(saved);
        if (Array.isArray(parsed)) {
          state = {
            ...state,
            history: parsed.filter((entry) => entry !== null && typeof entry === 'object').slice(0, HISTORY_LIMIT),
          };
        }
      } catch {
        // Local history is optional; a blocked storage backend must not break the composer.
      }
      const listeners = new Set();
      const notify = () => {
        for (const listener of [...listeners]) listener();
      };
      return {
        get: () => state,
        subscribe: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        update(patch) {
          state = typeof patch === 'function' ? patch(state) : { ...state, ...patch };
          notify();
        },
        pushHistory(entry) {
          const history = [entry, ...state.history].slice(0, HISTORY_LIMIT);
          try {
            window.localStorage.setItem(historyKey, JSON.stringify(history));
          } catch {
            // Keep the in-memory history when storage is unavailable.
          }
          state = { ...state, history };
          notify();
        },
      };
    }

    async function requestEnhance(store, options) {
      const {
        text,
        originalDraft,
        sessionId,
        mode,
        t,
        signal,
        isCurrentDraft,
      } = options;
      store.update({ status: 'busy', mode, error: '', undo: null });
      const startedAt = Date.now();
      try {
        const response = await fetch('/api/prompt-enhancer-plus/enhance', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text, sessionId, mode }),
          signal,
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(localizedError(payload?.error?.code, payload?.error?.message, t));
        }
        const enhanced = payload?.enhanced;
        if (typeof enhanced !== 'string' || enhanced.trim().length === 0) {
          throw new Error(t('emptyResult'));
        }
        if (typeof isCurrentDraft === 'function' && !isCurrentDraft()) {
          store.update({ status: 'error', error: t('changed') });
          return;
        }
        const result = {
          status: 'preview',
          originalDraft,
          enhanced: enhanced.trim(),
          mode: typeof payload?.mode === 'string' ? payload.mode : mode,
          usage: payload?.usage ?? null,
          elapsedMs: Number.isFinite(payload?.elapsedMs) ? payload.elapsedMs : Date.now() - startedAt,
          model: payload?.model ?? null,
          error: '',
        };
        store.update(result);
        store.pushHistory({
          original: originalDraft,
          enhanced: result.enhanced,
          mode: result.mode,
          usage: result.usage,
          elapsedMs: result.elapsedMs,
          model: result.model,
          at: Date.now(),
        });
      } catch (error) {
        if (error?.name === 'AbortError') return;
        store.update({
          status: 'error',
          error: error instanceof Error ? error.message : t('failed'),
        });
      }
    }

    function PromptEnhancerButton(props) {
      const { useInput, inputActions, sessionId, store, t } = props;
      const draft = useInput((state) => state.draft);
      const state = useStore(store);
      const draftRef = React.useRef(draft);
      const abortRef = React.useRef(null);
      React.useEffect(() => {
        draftRef.current = draft;
      }, [draft]);
      React.useEffect(() => () => {
        if (abortRef.current !== null) abortRef.current.abort();
      }, []);
      React.useEffect(() => {
        if (state.undo === null) return undefined;
        const timer = window.setTimeout(() => store.update({ undo: null }), 10000);
        return () => window.clearTimeout(timer);
      }, [state.undo, store]);

      const text = typeof draft === 'string' ? draft.trim() : '';
      const disabled = state.status === 'busy' || text.length === 0 || inputActions === undefined;
      const run = React.useCallback(() => {
        if (state.status === 'busy' || text.length === 0 || inputActions === undefined) return;
        if (abortRef.current !== null) abortRef.current.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        void requestEnhance(store, {
          text,
          originalDraft: draft,
          sessionId,
          mode: state.mode,
          t,
          signal: controller.signal,
          isCurrentDraft: () => draftRef.current === draft,
        }).finally(() => {
          if (abortRef.current === controller) abortRef.current = null;
        });
      }, [draft, inputActions, sessionId, state.mode, state.status, store, t, text]);

      const canUndo = state.undo !== null && typeof draft === 'string' && draft.trim() === state.undo.applied;
      const undoDraft = () => {
        if (state.undo === null) return;
        inputActions.setDraft(state.undo.original);
        store.update({ undo: null, status: 'idle', error: '' });
      };
      const label = state.status === 'busy' ? t('busy') : t('button');

      return h('div', { className: 'pe-root' },
        h('button', {
          type: 'button',
          className: 'pe-button'
            + (state.status === 'preview' ? ' pe-open' : '')
            + (state.status === 'error' ? ' pe-error' : ''),
          disabled,
          title: state.status === 'error' && state.error ? state.error : t('hint'),
          'aria-label': t('button'),
          'aria-haspopup': 'dialog',
          'aria-expanded': state.status === 'preview',
          onClick: run,
        },
        h('span', { className: 'pe-icon', 'aria-hidden': true }, h(SparkleIcon)),
        h('span', null, label)),
        canUndo
          ? h('button', {
            type: 'button',
            className: 'pe-undo',
            title: t('undoHint'),
            onClick: undoDraft,
          }, t('undo'))
          : null,
        state.status === 'error' && state.error
          ? h('span', {
            className: 'pe-error-text',
            role: 'status',
            'aria-live': 'polite',
            title: state.error,
          }, state.error)
          : null,
        h('style', null, `
.pe-root{display:inline-flex;align-items:center;gap:6px;min-width:0;}
.pe-button{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 7px;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:1;cursor:pointer;white-space:nowrap;}
.pe-button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);}
.pe-button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;}
.pe-button:disabled{opacity:.42;cursor:default;}
.pe-button.pe-open{color:var(--dsw-alias-brand-primary);}
.pe-button.pe-error{color:var(--dsw-alias-state-error-primary);}
.pe-undo{height:24px;padding:0 4px;border:none;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:1;cursor:pointer;text-decoration:underline;text-underline-offset:2px;}
.pe-undo:hover{color:var(--dsw-alias-label-primary);}
.pe-undo:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;}
.pe-icon{display:inline-flex;width:13px;height:13px;align-items:center;justify-content:center;}
.pe-icon svg{width:13px;height:13px;display:block;}
.pe-error-text{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-state-error-primary);font-size:12px;}
`)
      );
    }

    function PromptEnhancerPreview(props) {
      const { inputActions, sessionId, store, t } = props;
      const state = useStore(store);
      const abortRef = React.useRef(null);
      const [copied, setCopied] = React.useState(false);
      React.useEffect(() => () => {
        if (abortRef.current !== null) abortRef.current.abort();
      }, []);
      React.useEffect(() => {
        if (!copied) return undefined;
        const timer = window.setTimeout(() => setCopied(false), 1600);
        return () => window.clearTimeout(timer);
      }, [copied]);

      const rerun = React.useCallback((mode) => {
        if (state.status !== 'preview') return;
        if (abortRef.current !== null) abortRef.current.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        void requestEnhance(store, {
          text: state.originalDraft.trim(),
          originalDraft: state.originalDraft,
          sessionId,
          mode,
          t,
          signal: controller.signal,
          isCurrentDraft: () => true,
        }).finally(() => {
          if (abortRef.current === controller) abortRef.current = null;
        });
      }, [sessionId, state.originalDraft, state.status, store, t]);

      const apply = () => {
        if (state.status !== 'preview') return;
        inputActions.setDraft(state.enhanced);
        store.update({
          status: 'idle',
          error: '',
          undo: { original: state.originalDraft, applied: state.enhanced },
        });
      };
      const cancel = () => {
        store.update({ status: 'idle', error: '', originalDraft: '', enhanced: '' });
      };
      const copy = async () => {
        try {
          await navigator.clipboard.writeText(state.enhanced);
          setCopied(true);
        } catch {
          // The textarea remains selectable; a failed clipboard write is not fatal.
        }
      };
      const applyHistory = (entry) => {
        store.update({
          status: 'preview',
          originalDraft: entry.original ?? '',
          enhanced: entry.enhanced ?? '',
          mode: typeof entry.mode === 'string' ? entry.mode : 'general',
          usage: entry.usage ?? null,
          elapsedMs: Number.isFinite(entry.elapsedMs) ? entry.elapsedMs : null,
          model: entry.model ?? null,
          error: '',
        });
      };

      if (state.status !== 'preview') return null;
      const meta = [];
      if (state.model?.model) meta.push(state.model.model);
      meta.push(formatUsage(state.usage, t));
      const elapsed = formatElapsed(state.elapsedMs);
      if (elapsed.length > 0) meta.push(elapsed);

      return h('div', {
        className: 'pe-panel',
        role: 'dialog',
        'aria-label': t('previewTitle'),
        onMouseDown: (event) => event.stopPropagation(),
        onClick: (event) => event.stopPropagation(),
      },
      h('div', { className: 'pe-panel-head' },
        h('div', { className: 'pe-panel-title' }, h(SparkleIcon), h('strong', null, t('previewTitle'))),
        h('button', {
          type: 'button',
          className: 'pe-close',
          onClick: cancel,
          'aria-label': t('close'),
          title: t('close'),
        }, '×')),
      h('div', { className: 'pe-meta' }, meta.join(' · ')),
      h('div', { className: 'pe-modes' },
        h('span', { className: 'pe-mode-label' }, t('modeLabel')),
        ...MODES.map((mode) => h('button', {
          key: mode,
          type: 'button',
          className: 'pe-mode' + (mode === state.mode ? ' pe-mode-on' : ''),
          onClick: () => rerun(mode),
        }, t(`mode${mode[0].toUpperCase()}${mode.slice(1)}`)))),
      h('textarea', {
        className: 'pe-preview-text',
        readOnly: true,
        value: state.enhanced,
        spellCheck: false,
        rows: 6,
      }),
      h('details', { className: 'pe-original' },
        h('summary', null, t('original')),
        h('pre', null, state.originalDraft)),
      h('div', { className: 'pe-actions' },
        h('button', { type: 'button', className: 'pe-action pe-primary', onClick: apply }, t('apply')),
        h('button', { type: 'button', className: 'pe-action', onClick: copy }, copied ? t('copied') : t('copy')),
        h('button', { type: 'button', className: 'pe-action pe-ghost', onClick: cancel }, t('cancel'))),
      state.history.length > 0
        ? h('details', { className: 'pe-history' },
          h('summary', null, `${t('history')} (${state.history.length})`),
          h('div', { className: 'pe-history-list' },
            state.history.map((entry, index) => h('button', {
              key: `${entry.at ?? 'history'}-${index}`,
              type: 'button',
              className: 'pe-history-item',
              onClick: () => applyHistory(entry),
            },
            h('span', { className: 'pe-history-text' }, truncate(entry.enhanced)),
            h('span', { className: 'pe-history-meta' },
              `${t(`mode${String(entry.mode ?? 'general')[0].toUpperCase()}${String(entry.mode ?? 'general').slice(1)}`)}${entry.elapsedMs ? ` · ${formatElapsed(entry.elapsedMs)}` : ''}`)))),
        )
        : null,
      h('style', null, `
.pe-panel{position:absolute;left:0;right:0;bottom:calc(100% + 8px);z-index:20;box-sizing:border-box;width:min(640px,calc(100vw - 48px));max-height:min(70vh,560px);overflow:auto;margin:0 auto;padding:12px;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;box-shadow:0 8px 30px color-mix(in srgb,var(--dsw-alias-label-primary) 12%,transparent);color:var(--dsw-alias-label-primary);font-size:13px;}
.pe-panel-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;}
.pe-panel-title{display:inline-flex;align-items:center;gap:6px;font-weight:600;}
.pe-panel-title svg{width:14px;height:14px;color:var(--dsw-alias-brand-primary);}
.pe-close{width:24px;height:24px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:18px;line-height:1;cursor:pointer;}
.pe-close:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);}
.pe-meta{margin-bottom:8px;color:var(--dsw-alias-label-secondary);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.pe-modes{display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin-bottom:8px;}
.pe-mode-label{margin-right:2px;color:var(--dsw-alias-label-secondary);font-size:12px;}
.pe-mode{height:24px;padding:0 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:1;cursor:pointer;}
.pe-mode:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);}
.pe-mode.pe-mode-on{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);}
.pe-preview-text{box-sizing:border-box;width:100%;min-height:140px;max-height:32vh;resize:vertical;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;line-height:1.55;white-space:pre-wrap;}
.pe-preview-text:focus{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;}
.pe-original{margin-top:8px;color:var(--dsw-alias-label-secondary);font-size:12px;}
.pe-original summary{cursor:pointer;}
.pe-original pre{max-height:120px;overflow:auto;white-space:pre-wrap;margin:6px 0 0;font:inherit;color:var(--dsw-alias-label-secondary);}
.pe-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px;}
.pe-action{height:28px;padding:0 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:1;cursor:pointer;}
.pe-action:hover{background:var(--dsw-alias-bg-layer-2);}
.pe-action:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;}
.pe-primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);}
.pe-primary:hover{opacity:.92;background:var(--dsw-alias-brand-primary);}
.pe-ghost{border-color:transparent;color:var(--dsw-alias-label-secondary);}
.pe-history{margin-top:10px;border-top:1px solid var(--dsw-alias-border-l1);padding-top:8px;color:var(--dsw-alias-label-secondary);font-size:12px;}
.pe-history summary{cursor:pointer;}
.pe-history-list{display:flex;flex-direction:column;gap:4px;margin-top:6px;}
.pe-history-item{display:flex;flex-direction:column;gap:2px;width:100%;padding:5px 7px;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;text-align:left;cursor:pointer;}
.pe-history-item:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);}
.pe-history-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.pe-history-meta{font-size:11px;opacity:.8;}
`)
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en: EN, zh: ZH }), 'prompt-enhancer-plus: locale');
        const t = ctx.locale.bind(NS);
        const stores = new Map();
        const storeFor = (sessionId) => {
          const key = sessionId === undefined ? 'none' : String(sessionId);
          let store = stores.get(key);
          if (store === undefined) {
            store = createStore(key);
            stores.set(key, store);
          }
          return store;
        };
        ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
          name: 'conversation.input.left',
          id: 'prompt-enhancer-plus',
          order: 0,
          locale: NS,
          label: () => t('button'),
        }, (props) => h(PromptEnhancerButton, {
          ...props,
          t,
          store: storeFor(props.sessionId),
        })));
        ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({
          name: 'conversation.input.overlay',
          id: 'prompt-enhancer-plus-preview',
          order: 20,
          locale: NS,
          label: () => t('previewTitle'),
        }, (props) => h(PromptEnhancerPreview, {
          ...props,
          t,
          store: storeFor(props.sessionId),
        })));
      },
    };
  },
});
