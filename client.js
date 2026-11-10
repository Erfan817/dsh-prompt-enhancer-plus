window.__ModuleLoader__.load({
  id: 'dsh-prompt-enhancer-plus',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'promptEnhancerPlus';
    const MODES = ['general', 'system', 'task', 'concise'];
    const FORMATS = ['plain', 'markdown'];
    const LEVELS = ['concise', 'standard', 'detailed'];
    const UNDO_MS = 10000;
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
      levelLabel: 'Length', levelConcise: 'Concise', levelStandard: 'Standard', levelDetailed: 'Detailed',
      projectLabel: 'Project-aware', projectHint: 'Read AGENTS.md/README/package.json from the workspace',
      usageUnknown: 'usage unavailable',
      personas: 'Personas', personaTitle: 'Enhancement personas', noPersona: 'No persona',
      personaHint: 'Save how prompts should be improved, not the task itself. Only enhancement calls use these directions.',
      personaLocal: 'Saved on this DSH host and shared by its sessions. Saving does not call the model.',
      personaNew: 'New persona', personaEdit: 'Edit', personaDuplicateAction: 'Duplicate',
      personaDelete: 'Delete', personaConfirmDelete: 'Confirm deletion', personaSave: 'Save and use',
      personaSaving: 'Saving…', personaSaved: 'Persona saved and selected', personaSelected: 'Current persona',
      personaFromPreview: 'Save this direction as a persona', personaLegacy: 'This older result has no direction snapshot. Choose a persona or create one explicitly.',
      personaName: 'Name', personaInstructions: 'How to enhance prompts', personaAdvanced: 'Role and other details (optional)',
      personaRole: 'Role', personaGoal: 'Goal', personaStyle: 'Style', personaConstraints: 'Constraints', personaOutput: 'Output structure',
      personaNamePlaceholder: 'e.g. My product requirements editor',
      personaInstructionsPlaceholder: 'You are a pragmatic product manager. Clarify vague needs into testable requirements; do not add unrelated features.',
      personaConflict: 'The library changed elsewhere. It has been reloaded; review your changes and save again.',
      personaInvalid: 'Enter a name (up to 60 characters) and at least one direction. Each field allows 4000 characters; 10000 in total.',
      personaMissing: 'This persona no longer exists. Refresh and choose another.',
      personaDuplicate: 'Another persona already has this name.', personaReadOnly: 'Presets are read-only. Duplicate one to customize it.',
      personaLimit: 'You can save at most 50 custom personas.', personaStorageFailed: 'The persona library could not be loaded or saved. Retry; your form is retained.',
      retry: 'Retry', back: 'Back', personaCopySuffix: ' copy',
      namebalanced: 'Balanced', nameproduct: 'Product manager', nameengineering: 'Engineering reviewer', namewriting: 'Writing coach', nameminimal: 'Minimalist',
      previewChanged: 'The composer changed after this preview was generated. Copy the result or generate a fresh preview instead of overwriting it.',
      copyFailed: 'Clipboard unavailable. Select and copy the preview text manually.',
      timeout: 'The request timed out. Retry or shorten the draft.',
      outputTruncated: 'The result reached the output limit. Shorten the request or raise the configured limit.',
      more: 'More', details: 'Details and recent results', openPreview: 'Open prompt workspace',
      formatLabel: 'Output format',
      formatPlain: 'Plain text', formatMarkdown: 'Markdown', editLabel: 'Editable prompt',
      editHint: 'Edit freely here; the composer stays unchanged until you replace the draft.',
      edited: 'Edited preview', rerunHint: 'Changing mode or format calls the model again, uses tokens, and replaces your preview edits. It starts from the original draft.',
      regenerate: 'Enhance current draft', waiting: 'Generating your prompt. You can cancel without changing the composer.',
      startHint: 'Enhance the current draft, open a recent result, or manage your enhancement personas.',
      modelLabel: 'Model and usage', noResult: 'Your editable result will appear here.',
      phaseLocked: 'The composer is sending or is read-only. Replacement is unavailable; you can still edit or copy this preview.',
      resultFormatHint: 'Both formats are edited as plain text. Markdown is an output format, not a rendered preview.',
      historyHint: 'Opening a recent result does not call the model. Replacement targets the current draft only.',
      undoExpired: 'The draft changed or undo expired. Your current draft was left untouched.',
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
      levelLabel: '长度档', levelConcise: '简洁', levelStandard: '标准', levelDetailed: '详细',
      projectLabel: '项目感知', projectHint: '从工作区读取 AGENTS.md/README/package.json 作为背景',
      usageUnknown: '用量未知',
      personas: '强化人格', personaTitle: '我的强化人格', noPersona: '不使用人格',
      personaHint: '这里保存“怎么强化”的方法，不是具体任务。人格只影响强化提示词，不改变主助手。',
      personaLocal: '保存在当前 DSH 主机，跨会话复用；保存和切换不调用模型。',
      personaNew: '新建人格', personaEdit: '编辑', personaDuplicateAction: '复制为自定义',
      personaDelete: '删除', personaConfirmDelete: '确认删除', personaSave: '保存并使用',
      personaSaving: '保存中…', personaSaved: '人格已保存并选用', personaSelected: '当前人格',
      personaFromPreview: '将本次强化方向保存为人格', personaLegacy: '旧记录没有强化方向快照，请明确选择人格或自行新建；不会把任务正文当作人格。',
      personaName: '人格名称', personaInstructions: '希望往哪个方向强化', personaAdvanced: '角色与其他细节（选填）',
      personaRole: '角色', personaGoal: '目标', personaStyle: '风格', personaConstraints: '约束', personaOutput: '输出结构',
      personaNamePlaceholder: '例如：我的产品需求编辑',
      personaInstructionsPlaceholder: '你是一名务实的产品经理。把模糊想法补成可验收的需求，不擅自增加功能；信息不足时标出待确认问题。',
      personaConflict: '人格库已在别处修改，已重新加载。请检查后再次保存，未丢弃你的编辑。',
      personaInvalid: '请填写名称（最多 60 字符）和至少一项强化方向；单项最多 4000 字符，合计最多 10000。',
      personaMissing: '该人格已不存在，请刷新后重新选择。',
      personaDuplicate: '已有人格使用此名称，请换一个。', personaReadOnly: '内置人格只读，可复制为自定义后修改。',
      personaLimit: '最多可保存 50 个自定义人格。', personaStorageFailed: '无法加载或保存人格库，请重试；编辑内容会保留。',
      retry: '重试', back: '返回', personaCopySuffix: '（副本）',
      namebalanced: '通用助手', nameproduct: '产品经理', nameengineering: '工程审查', namewriting: '写作教练', nameminimal: '极简编辑',
      previewChanged: '生成预览后输入框已改变。请复制结果或重新强化，不会覆盖你的新内容。',
      copyFailed: '无法访问剪贴板，请选中预览内容手动复制。',
      timeout: '请求超时，请重试或缩短输入。',
      outputTruncated: '结果达到输出上限，请缩短输入或调高配置中的输出 token 上限。',
      more: '更多', details: '细节与最近结果', openPreview: '打开提示词工作区',
      formatLabel: '输出格式',
      formatPlain: '纯文本', formatMarkdown: 'Markdown', editLabel: '可编辑的提示词',
      editHint: '可直接编辑全文；点击替换草稿前，不会改变输入框。',
      edited: '预览已编辑', rerunHint: '切换模式或格式会从原始草稿重新调用模型、消耗 token，并替换当前预览中的编辑。',
      regenerate: '强化当前草稿', waiting: '正在生成提示词，可随时取消，不会改动输入框。',
      startHint: '可以强化当前草稿、打开最近结果，或管理强化人格。',
      modelLabel: '模型与用量', noResult: '生成后的全文会在这里展开，可直接编辑。',
      phaseLocked: '输入框正在发送或只读，暂不能替换；仍可编辑或复制预览。',
      resultFormatHint: '两种格式都安全地按文本编辑；Markdown 是输出格式，不是富文本预览。',
      historyHint: '打开旧结果不会调用模型；替换时仅面向当前草稿。',
      undoExpired: '草稿已变更或撤销已过期，未改动当前草稿。',
    };

    function SparkleIcon() {
      return h('svg', {
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.6,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
      },
      h('path', { d: 'M12 2.5C13.2 8.4 15.6 10.8 21.5 12C15.6 13.2 13.2 15.6 12 21.5C10.8 15.6 8.4 13.2 2.5 12C8.4 10.8 10.8 8.4 12 2.5Z' })
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
        case 'persona-not-found': return t('personaMissing');
        case 'invalid-persona': return t('personaInvalid');
        case 'output-truncated': return t('outputTruncated');
        case 'TimeoutError': return t('timeout');
        default: return message || t('failed');
      }
    }

    function createPersonaStore() {
      let state = { ready: false, loading: false, revision: 0, selectedId: '', personas: [], error: '' };
      const listeners = new Set();
      let pending;
      let disposed = false;
      const lifetime = new AbortController();
      const update = (patch) => {
        if (disposed) return;
        state = { ...state, ...patch };
        for (const listener of listeners) listener();
      };
      const store = {
        get: () => state,
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        load() {
          if (pending !== undefined) return pending;
          update({ loading: true, error: '' });
          pending = fetch('/api/prompt-enhancer-plus/personas', { cache: 'no-store', signal: lifetime.signal })
            .then(async (response) => {
              const payload = await response.json();
              if (!response.ok) throw Object.assign(new Error(payload.error?.message), { code: payload.error?.code });
              if (payload.revision >= state.revision) update({ ...payload, ready: true, error: '' });
            }).catch(() => update({ error: 'persona-storage-failed' }))
            .finally(() => { pending = undefined; update({ loading: false }); });
          return pending;
        },
        async act(action) {
          const response = await fetch('/api/prompt-enhancer-plus/personas', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ...action, expectedRevision: action.expectedRevision ?? state.revision }),
            signal: lifetime.signal,
          });
          const payload = await response.json();
          if (!response.ok) {
            if (payload.error?.code === 'persona-conflict') await store.load();
            throw Object.assign(new Error(payload.error?.message), { code: payload.error?.code ?? 'persona-storage-failed' });
          }
          if (payload.revision >= state.revision) update({ ...payload, ready: true, error: '' });
          return payload;
        },
        dispose() { disposed = true; lifetime.abort(); listeners.clear(); },
      };
      return store;
    }

    function personaName(persona, t) {
      if (!persona) return t('noPersona');
      return typeof persona.name === 'string' ? persona.name : t(`name${persona.id.split(':')[1]}`);
    }

    function personaErrorText(error, t) {
      const key = error?.code ?? error;
      const errors = {
        'persona-conflict': 'personaConflict', 'invalid-persona': 'personaInvalid',
        'persona-not-found': 'personaMissing', 'persona-name-taken': 'personaDuplicate',
        'builtin-read-only': 'personaReadOnly', 'persona-limit': 'personaLimit',
      };
      return t(errors[key] ?? 'personaStorageFailed');
    }

    function normalizeMode(mode) {
      return MODES.includes(mode) ? mode : 'general';
    }

    function normalizeFormat(format) {
      return format === 'markdown' ? 'markdown' : 'plain';
    }

    function normalizeLevel(level) {
      return LEVELS.includes(level) ? level : 'standard';
    }

    function historyEntry(entry) {
      return {
        ...entry,
        original: typeof entry.original === 'string' ? entry.original : '',
        enhanced: typeof entry.enhanced === 'string' ? entry.enhanced : '',
        mode: normalizeMode(entry.mode),
        format: normalizeFormat(entry.format),
        level: normalizeLevel(entry.level),
      };
    }

    function createStore(sessionId) {
      const historyKey = HISTORY_PREFIX + sessionId;
      let state = {
        status: 'idle', mode: 'general', format: 'plain', level: 'standard', useProject: true, persona: null,
        editorSeed: undefined, panelView: 'preview',
        targetDraft: '', insertion: null, targetInvalidated: false, requestId: 0,
        originalDraft: '', enhanced: '', generated: '', error: '',
        usage: null, elapsedMs: null, model: null, undo: null, history: [],
      };
      try {
        const saved = window.localStorage.getItem(historyKey);
        const parsed = saved === null ? [] : JSON.parse(saved);
        if (Array.isArray(parsed)) {
          state.history = parsed.filter((entry) => entry !== null && typeof entry === 'object')
            .slice(0, HISTORY_LIMIT).map(historyEntry);
        }
      } catch {}
      const listeners = new Set();
      const notify = () => {
        for (const listener of [...listeners]) listener();
      };
      return {
        get: () => state,
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        update(patch) {
          state = typeof patch === 'function' ? patch(state) : { ...state, ...patch };
          notify();
        },
        pushHistory(entry) {
          const history = [historyEntry(entry), ...state.history].slice(0, HISTORY_LIMIT);
          try {
            window.localStorage.setItem(historyKey, JSON.stringify(history));
          } catch {}
          state = { ...state, history };
          notify();
        },
      };
    }

    async function requestEnhance(store, options) {
      const {
        text, originalDraft, sessionId, t, signal, isCurrentDraft, personaId,
        targetDraft = originalDraft, insertion = null,
      } = options;
      const mode = normalizeMode(options.mode);
      const format = normalizeFormat(options.format);
      const level = normalizeLevel(options.level);
      const useProject = options.useProject !== false;
      const requestId = store.get().requestId + 1;
      store.update({
        status: 'busy', panelView: 'preview', mode, format, level, useProject, error: '', undo: null, requestId,
        originalDraft, targetDraft, insertion, targetInvalidated: false, enhanced: '', generated: '',
      });
      const startedAt = Date.now();
      try {
        const response = await fetch('/api/prompt-enhancer-plus/enhance', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text, sessionId, mode, personaId, format, level, useProject }),
          signal,
        });
        const payload = await response.json().catch(() => null);
        if (store.get().requestId !== requestId) return;
        if (signal?.aborted) { store.update({ status: 'idle' }); return; }
        if (!response.ok) throw new Error(localizedError(payload?.error?.code, payload?.error?.message, t));
        const enhanced = payload?.enhanced;
        if (typeof enhanced !== 'string' || enhanced.trim().length === 0) throw new Error(t('emptyResult'));
        const current = typeof isCurrentDraft !== 'function' || isCurrentDraft();
        const result = {
          status: 'preview', originalDraft, targetDraft, insertion,
          targetInvalidated: !current || store.get().targetInvalidated,
          persona: payload?.persona ?? null,
          enhanced: enhanced.trim(), generated: enhanced.trim(),
          mode: normalizeMode(payload?.mode ?? mode),
          format: normalizeFormat(payload?.format ?? format),
          level: normalizeLevel(payload?.level ?? level),
          useProject,
          usage: payload?.usage ?? null,
          elapsedMs: Number.isFinite(payload?.elapsedMs) ? payload.elapsedMs : Date.now() - startedAt,
          model: payload?.model ?? null,
          error: current ? '' : t('changed'),
        };
        store.update(result);
        store.pushHistory({
          original: originalDraft, enhanced: result.enhanced, mode: result.mode, format: result.format,
          level: result.level,
          persona: result.persona, usage: result.usage, elapsedMs: result.elapsedMs, model: result.model,
          at: Date.now(),
        });
      } catch (error) {
        if (store.get().requestId !== requestId) return;
        if (signal?.aborted || error?.name === 'AbortError') { store.update({ status: 'idle' }); return; }
        store.update({ status: 'error', error: error instanceof Error ? error.message : t('failed') });
      }
    }

    function createOverlayBridge() {
      let state = { activeSessionId: null, sessions: {} };
      let disposed = false;
      const listeners = new Set();
      const update = (patch) => {
        if (disposed) return;
        state = { ...state, ...patch };
        for (const listener of [...listeners]) listener();
      };
      return {
        get: () => state,
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        connect(sessionId, snapshot, actions) {
          const key = String(sessionId);
          const owner = {};
          update({ sessions: { ...state.sessions, [key]: { sessionId: key, owner, snapshot, actions } } });
          return {
            publish(nextSnapshot) {
              if (state.sessions[key]?.owner !== owner) return;
              update({ sessions: { ...state.sessions, [key]: { ...state.sessions[key], snapshot: nextSnapshot } } });
            },
            disconnect() {
              if (state.sessions[key]?.owner !== owner) return;
              const sessions = { ...state.sessions };
              delete sessions[key];
              update({ sessions, activeSessionId: state.activeSessionId === key ? null : state.activeSessionId });
            },
          };
        },
        open(sessionId) {
          const key = String(sessionId);
          if (disposed || state.sessions[key] === undefined) return false;
          update({ activeSessionId: key });
          return true;
        },
        close(sessionId) {
          if (state.activeSessionId === String(sessionId)) update({ activeSessionId: null });
        },
        dispose() {
          if (disposed) return;
          update({ activeSessionId: null, sessions: {} });
          disposed = true;
          listeners.clear();
        },
      };
    }

    function createSessionController(options) {
      const { sessionId, store, library, bridge, t } = options;
      const setTimer = options.setTimer ?? ((callback, delay) => window.setTimeout(callback, delay));
      const clearTimer = options.clearTimer ?? ((timer) => window.clearTimeout(timer));
      let input = options.input;
      let disposed = false;
      let pending = null;
      let undoTimer;
      let timedUndo = null;
      let connection;
      const snapshot = () => {
        const state = store.get();
        const editable = input.phase === 'plain';
        const hasActions = typeof input.inputActions?.captureInsertion === 'function'
          && typeof input.inputActions?.insertText === 'function';
        const targetCurrent = editable && hasActions && !state.targetInvalidated
          && input.draft === state.targetDraft && state.insertion !== null;
        const draftMatchesTarget = input.phase === 'plain' && input.draft === state.targetDraft
          && state.insertion !== null && !state.targetInvalidated;
        return {
          state, editable,
          canStart: editable && hasActions && input.draft.trim().length > 0
            && state.status !== 'busy' && library.get().ready,
          canRestart: editable && hasActions && input.draft.trim().length > 0
            && state.status !== 'busy' && library.get().ready,
          draftMatchesTarget,
          canApply: targetCurrent && state.status !== 'busy' && state.enhanced.trim().length > 0,
          canRerun: targetCurrent && state.status === 'preview' && state.originalDraft.trim().length > 0 && library.get().ready,
          canUndo: editable && hasActions && state.undo !== null
            && state.undo.expiresAt > Date.now() && input.draft === state.undo.applied,
        };
      };
      const publish = () => {
        if (disposed) return;
        const undo = store.get().undo;
        if (timedUndo !== undo) {
          if (undoTimer !== undefined) clearTimer(undoTimer);
          timedUndo = undo;
          undoTimer = undefined;
          if (undo !== null) undoTimer = setTimer(() => {
            if (!disposed && store.get().undo === undo) store.update({ undo: null });
          }, Math.max(0, undo.expiresAt - Date.now()));
        }
        connection?.publish(snapshot());
      };
      const cancelRequest = () => {
        if (pending === null) return;
        pending.abort();
        pending = null;
        store.update({ requestId: store.get().requestId + 1, status: 'idle', error: '' });
      };
      const run = (request) => {
        if (disposed || pending !== null) return undefined;
        const controller = new AbortController();
        pending = controller;
        bridge.open(sessionId);
        return requestEnhance(store, {
          ...request, sessionId, t, signal: controller.signal,
          isCurrentDraft: () => !disposed && input.phase === 'plain'
            && input.draft === request.targetDraft && !store.get().targetInvalidated,
        }).finally(() => { if (pending === controller) pending = null; });
      };
      const actions = {
        open() { if (!disposed) bridge.open(sessionId); },
        close() {
          if (disposed) return;
          cancelRequest();
          bridge.close(sessionId);
        },
        start() {
          if (disposed || !snapshot().canStart) return undefined;
          return run({
            text: input.draft.trim(), originalDraft: input.draft, targetDraft: input.draft,
            insertion: input.inputActions.captureInsertion(),
            mode: store.get().mode, format: store.get().format,
            level: store.get().level, useProject: store.get().useProject,
            personaId: library.get().selectedId,
          });
        },
        rerun(patch) {
          if (disposed || !snapshot().canRerun) return undefined;
          const state = store.get();
          return run({
            text: state.originalDraft.trim(), originalDraft: state.originalDraft, targetDraft: state.targetDraft,
            insertion: state.insertion, mode: patch.mode ?? state.mode, format: patch.format ?? state.format,
            level: patch.level ?? state.level, useProject: patch.useProject ?? state.useProject,
            personaId: state.persona?.id ?? library.get().selectedId,
          });
        },
        editPreview(enhanced) {
          if (!disposed && store.get().status !== 'busy' && typeof enhanced === 'string') store.update({ enhanced });
        },
        replace() {
          if (disposed || !snapshot().canApply) return false;
          const state = store.get();
          const accepted = input.inputActions.insertText(state.enhanced, {
            ...state.insertion, start: 0, end: state.targetDraft.length,
          });
          if (!accepted) {
            store.update({ targetInvalidated: true, error: t('previewChanged') });
            return false;
          }
          store.update({
            status: 'idle', error: '', insertion: null,
            undo: {
              original: state.targetDraft, applied: state.enhanced,
              insertion: input.inputActions.captureInsertion(), expiresAt: Date.now() + UNDO_MS,
            },
          });
          bridge.close(sessionId);
          return true;
        },
        undo() {
          if (disposed || !snapshot().canUndo) return false;
          const undo = store.get().undo;
          const accepted = input.inputActions.insertText(undo.original, {
            ...undo.insertion, start: 0, end: undo.applied.length,
          });
          store.update(accepted
            ? { undo: null, status: 'idle', error: '' }
            : { undo: null, error: t('undoExpired') });
          return accepted;
        },
        openHistory(entry) {
          if (disposed || store.get().status === 'busy') return;
          const saved = historyEntry(entry);
          store.update({
            status: 'preview', panelView: 'preview',
            originalDraft: saved.original, targetDraft: input.draft,
            insertion: input.inputActions?.captureInsertion() ?? null, targetInvalidated: input.phase !== 'plain',
            persona: saved.persona ?? null, enhanced: saved.enhanced, generated: saved.enhanced,
            mode: saved.mode, format: saved.format, usage: saved.usage ?? null,
            elapsedMs: Number.isFinite(saved.elapsedMs) ? saved.elapsedMs : null,
            model: saved.model ?? null, error: '',
          });
          bridge.open(sessionId);
        },
        personas(seed) {
          if (disposed || store.get().status === 'busy') return;
          void library.load();
          store.update({ panelView: 'personas', editorSeed: seed });
          bridge.open(sessionId);
        },
        preview() { if (!disposed) store.update({ panelView: 'preview', editorSeed: undefined }); },
        setUseProject(value) { if (!disposed) store.update({ useProject: value !== false }); },
        showError(error) { if (!disposed) store.update({ error }); },
      };
      connection = bridge.connect(sessionId, snapshot(), actions);
      const unsubscribeStore = store.subscribe(publish);
      const unsubscribeLibrary = library.subscribe(publish);
      return {
        actions,
        updateInput(nextInput) {
          if (disposed) return;
          input = nextInput;
          const state = store.get();
          const invalidTarget = state.insertion !== null && !state.targetInvalidated
            && (input.phase !== 'plain' || input.draft !== state.targetDraft);
          const invalidUndo = state.undo !== null && (input.phase !== 'plain' || input.draft !== state.undo.applied);
          if (invalidTarget || invalidUndo) store.update({
            targetInvalidated: state.targetInvalidated || invalidTarget,
            undo: invalidUndo ? null : state.undo,
          });
          else publish();
        },
        dispose() {
          if (disposed) return;
          disposed = true;
          unsubscribeStore();
          unsubscribeLibrary();
          if (undoTimer !== undefined) clearTimer(undoTimer);
          if (pending !== null) {
            pending.abort();
            pending = null;
            store.update({ requestId: store.get().requestId + 1, status: 'idle', error: '' });
          }
          if (store.get().insertion !== null || store.get().undo !== null) store.update({ targetInvalidated: true, undo: null });
          connection.disconnect();
        },
      };
    }

    function AutoGrowingTextarea(props) {
      const editorRef = React.useRef(null);
      const resize = React.useCallback(() => {
        const editor = editorRef.current;
        if (editor === null || editor.getClientRects().length === 0) return;
        const scroller = editor.closest('.pe-workspace-body');
        const scrollTop = scroller?.scrollTop;
        const scrollLeft = scroller?.scrollLeft;
        editor.style.height = 'auto';
        editor.style.height = `${editor.scrollHeight + 2}px`;
        if (scroller) {
          scroller.scrollTop = scrollTop;
          scroller.scrollLeft = scrollLeft;
        }
      }, []);
      React.useLayoutEffect(resize, [props.value, resize]);
      React.useEffect(() => {
        const editor = editorRef.current;
        if (editor === null) return undefined;
        let measuredWidth = 0;
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver((entries) => {
          const width = entries[0]?.contentRect.width ?? 0;
          if (width <= 0 || width === measuredWidth) return;
          measuredWidth = width;
          resize();
        });
        if (editor.parentElement) observer?.observe(editor.parentElement);
        window.addEventListener('resize', resize);
        return () => { observer?.disconnect(); window.removeEventListener('resize', resize); };
      }, [resize]);
      return h('textarea', { ...props, rows: 1, ref: editorRef });
    }

    function PersonaEditor({ library, seed, onClose, t }) {
      const [form, setForm] = React.useState(() => ({
        id: seed?.id?.startsWith('custom:') ? seed.id : '',
        name: typeof seed?.name === 'string' ? seed.name : '',
        instructions: seed?.instructions ?? '', role: seed?.role ?? '', goal: seed?.goal ?? '',
        style: seed?.style ?? '', constraints: seed?.constraints ?? '', output: seed?.output ?? '',
      }));
      const [saving, setSaving] = React.useState(false);
      const [revision, setRevision] = React.useState(library.get().revision);
      const mounted = React.useRef(true);
      React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
      const [error, setError] = React.useState('');
      const save = async (event) => {
        event.preventDefault();
        if (saving) return;
        setSaving(true);
        setError('');
        try {
          await library.act({ action: 'save', persona: form, select: true, expectedRevision: revision });
          if (mounted.current) onClose();
        } catch (failure) {
          if (mounted.current) {
            setError(personaErrorText(failure, t));
            if (failure.code === 'persona-conflict') setRevision(library.get().revision);
          }
        }
        finally { if (mounted.current) setSaving(false); }
      };
      const field = (name, label) => h('label', { className: 'pe-field', key: name },
        h('span', null, t(label)),
        h(AutoGrowingTextarea, {
          value: form[name], maxLength: 4000, disabled: saving,
          placeholder: name === 'instructions' ? t('personaInstructionsPlaceholder') : undefined,
          onChange: (event) => setForm({ ...form, [name]: event.target.value }),
        }));
      return h('form', { className: 'pe-editor', onSubmit: save },
        h('label', { className: 'pe-field' }, h('span', null, t('personaName')),
          h('input', {
            value: form.name, maxLength: 60, required: true, disabled: saving,
            placeholder: t('personaNamePlaceholder'),
            onChange: (event) => setForm({ ...form, name: event.target.value }),
          })),
        field('instructions', 'personaInstructions'),
        h('details', null, h('summary', null, t('personaAdvanced')),
          ...['role', 'goal', 'style', 'constraints', 'output'].map((name) => field(name, `persona${name[0].toUpperCase()}${name.slice(1)}`))),
        error ? h('p', { className: 'pe-error-text', role: 'alert' }, error) : null,
        h('div', { className: 'pe-actions' },
          h('button', { type: 'submit', className: 'pe-action pe-primary', disabled: saving }, t(saving ? 'personaSaving' : 'personaSave')),
          h('button', { type: 'button', className: 'pe-action', disabled: saving, onClick: onClose }, t('cancel'))));
    }

    function PersonaPanel({ library, seed, onClose, t }) {
      const catalog = useStore(library);
      const [editor, setEditor] = React.useState(seed === undefined ? null : seed);
      const [selectedId, setSelectedId] = React.useState(catalog.selectedId);
      const [confirmDelete, setConfirmDelete] = React.useState(false);
      const [pending, setPending] = React.useState(false);
      const [error, setError] = React.useState('');
      const persona = catalog.personas.find((item) => item.id === selectedId) ?? catalog.personas.find((item) => item.id === catalog.selectedId) ?? catalog.personas[0];
      const act = async (action) => {
        setPending(true);
        setError('');
        try {
          const next = await library.act(action);
          setSelectedId(next.selectedId);
          setConfirmDelete(false);
        } catch (failure) { setError(personaErrorText(failure, t)); }
        finally { setPending(false); }
      };
      return h('div', null,
        h('p', { className: 'pe-help' }, t('personaHint')),
        h('p', { className: 'pe-help' }, t('personaLocal')),
        catalog.error ? h('p', { role: 'alert', className: 'pe-error-text' }, t('personaStorageFailed'),
          h('button', { className: 'pe-action', onClick: () => library.load() }, t('retry'))) : null,
        editor !== null ? h(PersonaEditor, { key: editor.id || 'new', library, seed: editor, t, onClose: () => { setEditor(null); setSelectedId(library.get().selectedId); } })
          : h(React.Fragment, null,
            h('select', {
              className: 'pe-persona-list', 'aria-label': t('personaTitle'), value: persona?.id ?? '',
              disabled: pending || !catalog.ready,
              onChange: (event) => { setSelectedId(event.target.value); setConfirmDelete(false); },
            }, ...catalog.personas.map((item) => h('option', { key: item.id, value: item.id }, personaName(item, t)))),
            persona ? h('pre', { className: 'pe-direction' }, ['instructions', 'role', 'goal', 'style', 'constraints', 'output'].filter((field) => persona[field]).map((field) => `${t(`persona${field[0].toUpperCase()}${field.slice(1)}`)}: ${persona[field]}`).join('\n\n')) : null,
            h('div', { className: 'pe-actions' },
              h('button', { className: 'pe-action pe-primary', disabled: pending || !persona || persona.id === catalog.selectedId, onClick: () => act({ action: 'select', id: persona.id }) }, t('personaSave')),
              h('button', { className: 'pe-action', disabled: pending || !catalog.ready, onClick: () => setEditor({}) }, t('personaNew')),
              persona ? h('button', { className: 'pe-action', disabled: pending, onClick: () => setEditor({ ...persona, id: '', name: personaName(persona, t) + t('personaCopySuffix') }) }, t('personaDuplicateAction')) : null,
              persona && !persona.builtin ? h('button', { className: 'pe-action', disabled: pending, onClick: () => setEditor(persona) }, t('personaEdit')) : null,
              persona && !persona.builtin ? h('button', {
                className: 'pe-action', disabled: pending,
                onClick: () => confirmDelete ? act({ action: 'delete', id: persona.id }) : setConfirmDelete(true),
              }, t(confirmDelete ? 'personaConfirmDelete' : 'personaDelete')) : null)),
        error ? h('p', { role: 'alert', className: 'pe-error-text' }, error) : null);
    }

    function PromptEnhancerButton({ sessionId, bridge, locale, t }) {
      const current = useStore(bridge);
      useStore(locale);
      const session = current.sessions[String(sessionId)];
      const snapshot = session?.snapshot;
      const state = snapshot?.state;
      const hasResult = state?.status === 'preview' && state.generated.length > 0;
      const busy = state?.status === 'busy';
      const draftMatchesTarget = hasResult && snapshot?.draftMatchesTarget === true;
      return h('div', { className: 'pe-root' },
        h('button', {
          type: 'button', className: 'pe-button' + (hasResult ? ' pe-open' : ''),
          disabled: session === undefined || (!busy && !hasResult && !snapshot.canStart),
          title: busy || draftMatchesTarget ? t('openPreview') : t('hint'),
          'aria-haspopup': 'dialog', 'aria-expanded': current.activeSessionId === String(sessionId),
          onClick: () => {
            if (busy || draftMatchesTarget) { session.actions.open(); return; }
            void session.actions.start();
          },
        }, h('span', { className: 'pe-icon', 'aria-hidden': true }, h(SparkleIcon)),
        t(busy ? 'busy' : draftMatchesTarget ? 'doneShort' : 'button')),
        h('button', {
          type: 'button', className: 'pe-button pe-more', disabled: session === undefined,
          'aria-label': t('openPreview'), title: t('more'), 'aria-haspopup': 'dialog',
          onClick: () => session.actions.open(),
        }, '…'),
        snapshot?.canUndo ? h('button', {
          type: 'button', className: 'pe-undo', title: t('undoHint'), onClick: () => session.actions.undo(),
        }, t('undo')) : null,
        state?.error ? h('span', { className: 'pe-toolbar-error', role: 'status', title: state.error }, truncate(state.error, 72)) : null);
    }

    function PromptEnhancerInputBridge({ useInput, inputActions, sessionId, store, library, bridge, controllers, t }) {
      const draft = useInput((input) => input.draft);
      const phase = useInput((input) => input.phase);
      const controllerRef = React.useRef(null);
      React.useLayoutEffect(() => {
        const controller = createSessionController({
          sessionId, store, library, bridge, t,
          input: { draft: typeof draft === 'string' ? draft : '', phase, inputActions },
        });
        controllerRef.current = controller;
        controllers.add(controller);
        return () => {
          controller.dispose();
          controllers.delete(controller);
          if (controllerRef.current === controller) controllerRef.current = null;
        };
      }, [bridge, controllers, inputActions, library, sessionId, store, t]);
      React.useLayoutEffect(() => {
        controllerRef.current?.updateInput({ draft: typeof draft === 'string' ? draft : '', phase, inputActions });
      }, [draft, phase, inputActions]);
      React.useEffect(() => { void library.load(); }, [library]);
      return null;
    }

    const STYLES = `
.pe-root{display:inline-flex;align-items:center;gap:4px;min-width:0;font:inherit;}
.pe-button,.pe-undo,.pe-action,.pe-close{display:inline-flex;align-items:center;justify-content:center;gap:5px;box-sizing:border-box;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;}
.pe-button{height:24px;padding:0 6px;font-size:12px;white-space:nowrap;}
.pe-more{width:24px;padding:0;font-size:17px;}
.pe-undo{height:24px;padding:0 4px;font-size:12px;text-decoration:underline;text-underline-offset:2px;}
.pe-button:hover:not(:disabled),.pe-undo:hover:not(:disabled),.pe-action:hover:not(:disabled),.pe-close:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);}
.pe-button.pe-open{color:var(--dsw-alias-brand-primary);}
.pe-button:disabled,.pe-action:disabled,.pe-undo:disabled{opacity:.45;cursor:default;}
.pe-button:focus-visible,.pe-undo:focus-visible,.pe-action:focus-visible,.pe-close:focus-visible,.pe-overlay summary:focus-visible,.pe-overlay select:focus-visible,.pe-field input:focus-visible,.pe-field textarea:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;}
.pe-icon,.pe-icon svg{display:block;width:16px;height:16px;}
.pe-icon{color:var(--dsw-alias-brand-primary);}
.pe-toolbar-error{max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--dsw-alias-state-error-primary);}
.pe-overlay{position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:clamp(12px,3vw,36px);pointer-events:auto;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;}
.pe-workspace{display:flex;flex-direction:column;width:min(1120px,100%);height:min(88vh,980px);height:min(88dvh,980px);max-height:100%;min-height:0;box-sizing:border-box;position:relative;border:1px solid color-mix(in srgb,var(--dsw-alias-border-l1) 55%,transparent);border-radius:14px;background:transparent;box-shadow:0 16px 64px color-mix(in srgb,var(--dsw-alias-label-primary) 12%,transparent);font:inherit;font-size:14px;}
.pe-workspace-head,.pe-workspace-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;flex:none;padding:14px 24px;background:color-mix(in srgb,var(--dsw-alias-bg-overlay) 86%,transparent);}
.pe-workspace-head{border-bottom:1px solid var(--dsw-alias-border-l1);border-radius:14px 14px 0 0;}
.pe-workspace-footer{border-radius:0 0 14px 14px;}
.pe-workspace-title{margin:0;font:inherit;font-size:16px;font-weight:600;}
.pe-window-actions,.pe-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.pe-workspace-body{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable;padding:24px 320px 24px 32px;background:color-mix(in srgb,var(--dsw-alias-bg-overlay) 96%,transparent);}
.pe-workspace-body.pe-personas-view{padding-right:32px;}
.pe-document{width:100%;max-width:none;margin:0;}
.pe-persona-rail{position:absolute;top:76px;right:24px;bottom:84px;width:260px;display:flex;flex-direction:column;gap:10px;overflow-y:auto;padding:14px;border:1px solid color-mix(in srgb,var(--dsw-alias-border-l1) 55%,transparent);border-radius:12px;background:color-mix(in srgb,var(--dsw-alias-bg-overlay) 86%,transparent);}
.pe-persona-rail h3{margin:0;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;font-weight:600;}
.pe-persona-rail .pe-actions{flex-direction:column;align-items:stretch;}
@media(max-width:900px){.pe-workspace-body{padding:20px 24px;}.pe-persona-rail{position:static;width:auto;margin:0 0 14px;}}
.pe-workspace-footer{border-top:1px solid var(--dsw-alias-border-l1);}
.pe-close{width:28px;height:28px;padding:0;font-size:22px;}
.pe-action{min-height:30px;padding:5px 10px;font-size:13px;}
.pe-primary{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-brand-primary);font-weight:600;}
.pe-primary:hover:not(:disabled){color:var(--dsw-alias-brand-primary);}
.pe-output-controls{display:flex;align-items:center;gap:20px;flex-wrap:wrap;}
.pe-output-controls label{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-secondary);font-size:12px;}
.pe-overlay select{max-width:100%;min-height:30px;box-sizing:border-box;border:0;border-bottom:1px solid var(--dsw-alias-border-l1);border-radius:0;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);font:inherit;}
.pe-output-controls select{min-width:120px;}
.pe-help{margin:8px 0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.6;}
.pe-editor-hint{margin:20px 0 8px;}
.pe-preview-text{display:block;width:100%;box-sizing:border-box;min-height:46vh;min-height:46dvh;padding:8px 0 24px;border:0;border-radius:0;outline:none;resize:none;overflow:hidden;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:15px;line-height:1.8;white-space:pre-wrap;overflow-wrap:anywhere;}
.pe-preview-text:focus-visible{outline:none;box-shadow:-2px 0 0 var(--dsw-alias-border-l2);}
.pe-preview-status{color:var(--dsw-alias-label-secondary);font-size:12px;}
.pe-empty{display:flex;flex-direction:column;justify-content:center;align-items:flex-start;min-height:42vh;gap:12px;}
.pe-empty p{margin:0;line-height:1.7;color:var(--dsw-alias-label-secondary);}
.pe-error-text{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:1.6;overflow-wrap:anywhere;}
.pe-details{margin-top:24px;padding-top:16px;border-top:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-size:13px;}
.pe-overlay summary{width:fit-content;cursor:pointer;line-height:1.7;}
.pe-detail-section{margin-top:20px;}
.pe-detail-section h3{margin:0 0 8px;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;font-weight:600;}
.pe-direction,.pe-original pre{margin:12px 0;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:1.7;}
.pe-original{margin-top:20px;}
.pe-persona-list{width:100%;margin:12px 0;}
.pe-field{display:flex;flex-direction:column;gap:6px;margin:20px 0;font-size:13px;}
.pe-field span{color:var(--dsw-alias-label-secondary);}
.pe-field input,.pe-field textarea{width:100%;min-height:36px;box-sizing:border-box;padding:8px 0;border:0;border-bottom:1px solid var(--dsw-alias-border-l1);border-radius:0;resize:none;overflow:hidden;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;line-height:1.7;}
.pe-field textarea{min-height:100px;}
.pe-history-list{display:flex;flex-direction:column;margin-top:8px;}
.pe-history-item{display:flex;flex-direction:column;gap:4px;width:100%;padding:10px 0;border:0;border-radius:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer;}
.pe-history-item:hover{color:var(--dsw-alias-brand-primary);}
.pe-history-item:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;}
.pe-history-item:disabled{opacity:.45;cursor:default;}
.pe-history-text{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.pe-history-meta{color:var(--dsw-alias-label-secondary);font-size:12px;}
@media(max-width:620px){.pe-overlay{padding:8px;}.pe-workspace{height:calc(100vh - 16px);height:calc(100dvh - 16px);}.pe-workspace-head,.pe-workspace-footer{padding:12px 16px;}.pe-workspace-body{padding:18px 20px;}.pe-workspace-title{font-size:15px;}.pe-output-controls{gap:12px;}.pe-preview-text{font-size:14px;}.pe-workspace-footer{gap:8px;}.pe-workspace-footer .pe-help{display:none;}}
`;

    function PersonaRail({ snapshot, actions, library, t }) {
      const { state } = snapshot;
      const catalog = useStore(library);
      return h('aside', { className: 'pe-persona-rail', 'aria-label': t('personaTitle') },
        h('h3', null, t('personaTitle')),
        h('select', {
          className: 'pe-persona-list', 'aria-label': t('personaSelected'), value: catalog.selectedId,
          disabled: !catalog.ready || state.status === 'busy',
          onFocus: () => { void library.load(); },
          onChange: (event) => {
            void library.act({ action: 'select', id: event.target.value })
              .catch((error) => actions.showError(personaErrorText(error, t)));
          },
        }, ...catalog.personas.map((persona) => h('option', { key: persona.id, value: persona.id }, personaName(persona, t)))),
        h('p', { className: 'pe-help' }, t('personaLocal')),
        h('div', { className: 'pe-actions' },
          h('button', { type: 'button', className: 'pe-action', disabled: state.status === 'busy', onClick: () => actions.personas() }, t('personas')),
          state.persona ? h('button', {
            type: 'button', className: 'pe-action', disabled: state.status === 'busy',
            onClick: () => actions.personas({ ...state.persona, id: '', name: personaName(state.persona, t) + t('personaCopySuffix') }),
          }, t('personaFromPreview')) : null),
        !state.persona && state.enhanced.length > 0 ? h('p', { className: 'pe-help' }, t('personaLegacy')) : null,
        catalog.error ? h('p', { className: 'pe-error-text', role: 'alert' }, t('personaStorageFailed'),
          h('button', { type: 'button', className: 'pe-action', onClick: () => library.load() }, t('retry'))) : null);
    }

    function PromptEnhancerDetails({ snapshot, actions, library, t }) {
      const { state } = snapshot;
      const meta = [state.model?.model, formatUsage(state.usage, t), formatElapsed(state.elapsedMs)].filter(Boolean);
      return h('details', { className: 'pe-details', open: state.enhanced.length === 0 ? true : undefined },
        h('summary', null, t('details')),
        state.enhanced.length > 0 ? h('section', { className: 'pe-detail-section' },
          h('h3', null, t('modelLabel')), h('p', { className: 'pe-help' }, meta.join(' · ')),
          state.persona ? h('p', { className: 'pe-help' }, `${t('personaSelected')}: ${personaName(state.persona, t)}`) : null) : null,
        state.originalDraft.length > 0 ? h('details', { className: 'pe-original' },
          h('summary', null, t('original')), h('pre', null, state.originalDraft)) : null,
        h('section', { className: 'pe-detail-section' },
          h('h3', null, `${t('history')} (${state.history.length})`),
          h('p', { className: 'pe-help' }, t('historyHint')),
          h('div', { className: 'pe-history-list' }, ...state.history.map((entry, index) => h('button', {
            key: `${entry.at ?? 'history'}-${index}`, type: 'button', className: 'pe-history-item',
            disabled: state.status === 'busy', onClick: () => actions.openHistory(entry),
          }, h('span', { className: 'pe-history-text' }, truncate(entry.enhanced)),
          h('span', { className: 'pe-history-meta' }, [
            t(`mode${entry.mode[0].toUpperCase()}${entry.mode.slice(1)}`),
            t(entry.format === 'markdown' ? 'formatMarkdown' : 'formatPlain'),
            t(`level${normalizeLevel(entry.level)[0].toUpperCase()}${normalizeLevel(entry.level).slice(1)}`),
            formatElapsed(entry.elapsedMs),
          ].filter(Boolean).join(' · ')))))),
        h('div', { className: 'pe-detail-section' }, h('button', {
          type: 'button', className: 'pe-action', disabled: !snapshot.canStart,
          title: t('hint'), onClick: () => { void actions.start(); },
        }, t('regenerate')), h('p', { className: 'pe-help' }, t('hint'))));
    }

    function PromptEnhancerWorkspace({ session, library, t }) {
      const { snapshot, actions } = session;
      const { state } = snapshot;
      const panelRef = React.useRef(null);
      const mounted = React.useRef(false);
      const [copied, setCopied] = React.useState(false);
      const hasResult = state.generated.length > 0;
      const personas = state.panelView === 'personas';
      React.useEffect(() => {
        mounted.current = true;
        const previous = document.activeElement;
        panelRef.current?.focus();
        return () => {
          mounted.current = false;
          if (previous?.isConnected && typeof previous.focus === 'function') previous.focus({ preventScroll: true });
        };
      }, []);
      React.useEffect(() => { panelRef.current?.focus(); }, [personas]);
      React.useEffect(() => { setCopied(false); }, [state.enhanced]);
      React.useEffect(() => {
        if (!copied) return undefined;
        const timer = window.setTimeout(() => setCopied(false), 1600);
        return () => window.clearTimeout(timer);
      }, [copied]);
      const copy = async () => {
        try {
          await navigator.clipboard.writeText(state.enhanced);
          if (mounted.current) setCopied(true);
        } catch {
          if (mounted.current) actions.showError(t('copyFailed'));
        }
      };
      const onKeyDown = (event) => {
        event.stopPropagation();
        if (event.key === 'Escape' && !event.nativeEvent?.isComposing) {
          event.preventDefault();
          actions.close();
          return;
        }
        if (event.key !== 'Tab') return;
        const targets = [...panelRef.current.querySelectorAll('button:not([disabled]),select:not([disabled]),input:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])')]
          .filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0);
        const first = targets[0];
        const last = targets[targets.length - 1];
        if (first === undefined) { event.preventDefault(); panelRef.current.focus(); return; }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panelRef.current)) {
          event.preventDefault(); first.focus();
        }
      };
      return h('div', {
        className: 'pe-overlay',
        onMouseDown: (event) => event.stopPropagation(), onClick: (event) => event.stopPropagation(),
      }, h('section', {
        className: 'pe-workspace', ref: panelRef, tabIndex: -1, role: 'dialog', 'aria-modal': true,
        'aria-label': t(personas ? 'personaTitle' : 'previewTitle'), onKeyDown,
      },
      h('header', { className: 'pe-workspace-head' },
        h('h2', { className: 'pe-workspace-title' }, t(personas ? 'personaTitle' : 'previewTitle')),
        h('div', { className: 'pe-window-actions' },
          h('button', { type: 'button', className: 'pe-close', 'aria-label': t('close'), title: t('close'), onClick: actions.close }, '×'))),
      h('div', { className: 'pe-workspace-body' + (personas ? ' pe-personas-view' : '') }, h('div', { className: 'pe-document' },
        personas ? h(PersonaPanel, { library, seed: state.editorSeed, t, onClose: actions.preview })
          : h(React.Fragment, null,
            hasResult ? h(React.Fragment, null,
              h('div', { className: 'pe-output-controls' },
                h('label', null, t('modeLabel'), h('select', {
                  value: state.mode, disabled: !snapshot.canRerun, title: t('rerunHint'),
                  onChange: (event) => { void actions.rerun({ mode: event.target.value }); },
                }, ...MODES.map((mode) => h('option', { key: mode, value: mode }, t(`mode${mode[0].toUpperCase()}${mode.slice(1)}`))))),
                h('label', null, t('formatLabel'), h('select', {
                  value: state.format, disabled: !snapshot.canRerun, title: t('rerunHint'),
                  onChange: (event) => { void actions.rerun({ format: event.target.value }); },
                }, ...FORMATS.map((format) => h('option', { key: format, value: format }, t(format === 'markdown' ? 'formatMarkdown' : 'formatPlain'))))),
                h('label', null, t('levelLabel'), h('select', {
                  value: state.level, disabled: !snapshot.canRerun, title: t('rerunHint'),
                  onChange: (event) => { void actions.rerun({ level: event.target.value }); },
                }, ...LEVELS.map((level) => h('option', { key: level, value: level }, t(`level${level[0].toUpperCase()}${level.slice(1)}`))))),
                h('label', { title: t('projectHint') }, h('input', {
                  type: 'checkbox', checked: state.useProject !== false,
                  onChange: (event) => { actions.setUseProject(event.target.checked); },
                }), t('projectLabel'))),
              h('p', { className: 'pe-help' }, t('rerunHint')),
              h('p', { className: 'pe-help pe-editor-hint' }, t('editHint')),
              h(AutoGrowingTextarea, {
                className: 'pe-preview-text', value: state.enhanced, 'aria-label': t('editLabel'), spellCheck: false,
                onChange: (event) => actions.editPreview(event.target.value),
              }),
              !snapshot.canApply ? h('p', { className: 'pe-help', role: 'status' }, t(snapshot.editable ? 'previewChanged' : 'phaseLocked')) : null)
              : h('div', { className: 'pe-empty' },
                h('p', { role: 'status', 'aria-live': 'polite' }, t(state.status === 'busy' ? 'waiting' : 'noResult')),
                state.status !== 'busy' ? h(React.Fragment, null,
                  h('p', { className: 'pe-help' }, t('startHint')),
                  h('button', { type: 'button', className: 'pe-action pe-primary', disabled: !snapshot.canStart, onClick: () => { void actions.start(); } }, t('regenerate'))) : null),
            state.error ? h('p', { className: 'pe-error-text', role: 'alert' }, state.error) : null,
            h(PromptEnhancerDetails, { snapshot, actions, library, t })))),
      personas ? null : h(PersonaRail, { snapshot, actions, library, t }),
      h('footer', { className: 'pe-workspace-footer' },
        personas ? h('button', { type: 'button', className: 'pe-action', onClick: actions.preview }, t('back'))
          : h('div', { className: 'pe-actions' },
            h('button', { type: 'button', className: 'pe-action pe-primary', disabled: !snapshot.canApply, onClick: actions.replace }, t('apply')),
            h('button', { type: 'button', className: 'pe-action', disabled: !hasResult || state.enhanced.length === 0, onClick: copy }, t(copied ? 'copied' : 'copy')),
            state.status === 'busy' ? h('button', { type: 'button', className: 'pe-action', onClick: actions.close }, t('cancel')) : null),
        h('span', { className: 'pe-help pe-preview-status' }, state.enhanced !== state.generated ? t('edited') : t('resultFormatHint')))));
    }

    function PromptEnhancerOverlay({ bridge, library, locale, t }) {
      const current = useStore(bridge);
      useStore(locale);
      const session = current.sessions[current.activeSessionId];
      return h(React.Fragment, null, h('style', null, STYLES), session === undefined ? null
        : h(PromptEnhancerWorkspace, { key: session.sessionId, session, library, t }));
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en: EN, zh: ZH }), 'prompt-enhancer-plus: locale');
        const t = ctx.locale.bind(NS);
        const library = createPersonaStore();
        const bridge = createOverlayBridge();
        const stores = new Map();
        const controllers = new Set();
        const locale = { get: () => ctx.locale.getSnapshot(), subscribe: (listener) => ctx.locale.subscribe(listener) };
        ctx.effect(() => () => {
          for (const controller of controllers) controller.dispose();
          controllers.clear();
          bridge.dispose();
          library.dispose();
          stores.clear();
        }, 'prompt-enhancer-plus: client state');
        const storeFor = (sessionId) => {
          const key = String(sessionId);
          let store = stores.get(key);
          if (store === undefined) {
            store = createStore(key);
            stores.set(key, store);
          }
          return store;
        };
        ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
          name: 'conversation.input.left', id: 'prompt-enhancer-plus', order: 0,
          locale: NS, label: () => t('button'),
        }, (props) => h(PromptEnhancerButton, { key: props.sessionId, sessionId: props.sessionId, bridge, locale, t })));
        ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({
          name: 'conversation.input.overlay', id: 'prompt-enhancer-plus-session-bridge', order: 20,
          locale: NS, label: () => t('previewTitle'),
        }, (props) => h(PromptEnhancerInputBridge, {
          ...props, key: props.sessionId, t, store: storeFor(props.sessionId), library, bridge, controllers,
        })));
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay', id: 'prompt-enhancer-plus-workspace', order: 20,
          locale: NS, label: () => t('previewTitle'),
        }, () => h(PromptEnhancerOverlay, { bridge, library, locale, t })));
      },
    };
  },
});
