window.__ModuleLoader__.load({
  id: 'dsh-prompt-enhancer-plus',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'promptEnhancerPlus';
    const EN = {
      button: 'Enhance prompt',
      busy: 'Enhancing…',
      done: 'Draft replaced with the enhanced prompt',
      doneShort: 'Enhanced',
      hint: 'Use the current model to turn a short draft into a clear, detailed prompt. Consumes a small amount of tokens.',
      noRoute: 'No model route is available. Choose a model in the composer first.',
      tooLong: 'The draft is too long to enhance.',
      emptyResult: 'The model returned no text.',
      changed: 'The draft changed while enhancing, so the result was not applied.',
      failed: 'Enhancement failed. Please try again.',
    };
    const ZH = {
      button: '强化提示词',
      busy: '强化中…',
      done: '已用强化后的提示词替换输入',
      doneShort: '已强化',
      hint: '调用当前模型，把简短描述扩充成清晰、具体、可执行的提示词（会消耗少量 token）',
      noRoute: '当前没有可用的模型，请先在输入框中选择模型',
      tooLong: '输入内容过长，无法强化',
      emptyResult: '模型没有返回内容',
      changed: '强化期间输入已修改，未替换结果',
      failed: '强化失败，请稍后重试',
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

    function PromptEnhancer(props) {
      const { useInput, inputActions, sessionId, t } = props;
      const draft = useInput((state) => state.draft);
      const [status, setStatus] = React.useState('idle');
      const [error, setError] = React.useState('');
      const abortRef = React.useRef(null);
      const draftRef = React.useRef(draft);
      React.useEffect(() => {
        draftRef.current = draft;
      }, [draft]);
      React.useEffect(() => () => {
        if (abortRef.current !== null) abortRef.current.abort();
      }, []);
      React.useEffect(() => {
        if (status !== 'done' && status !== 'error') return undefined;
        const timer = window.setTimeout(() => {
          setStatus('idle');
          setError('');
        }, status === 'done' ? 2200 : 6000);
        return () => window.clearTimeout(timer);
      }, [status]);
      const text = typeof draft === 'string' ? draft.trim() : '';
      const disabled = status === 'busy' || text.length === 0 || inputActions === undefined;

      const run = React.useCallback(async () => {
        if (status === 'busy' || text.length === 0 || inputActions === undefined) return;
        if (abortRef.current !== null) abortRef.current.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        setStatus('busy');
        setError('');
        const originalDraft = draft;
        try {
          const response = await fetch('/api/prompt-enhancer-plus/enhance', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text, sessionId }),
            signal: controller.signal,
          });
          const payload = await response.json().catch(() => null);
          if (!response.ok) {
            const code = payload?.error?.code;
            const message = code === 'no-route'
              ? t('noRoute')
              : code === 'too-long'
                ? t('tooLong')
                : code === 'empty-output'
                  ? t('emptyResult')
                  : (payload?.error?.message || t('failed'));
            throw new Error(message);
          }
          const enhanced = payload?.enhanced;
          if (typeof enhanced !== 'string' || enhanced.trim().length === 0) {
            throw new Error(t('emptyResult'));
          }
          if (draftRef.current !== originalDraft) {
            setStatus('error');
            setError(t('changed'));
            return;
          }
          inputActions.setDraft(enhanced.trim());
          setStatus('done');
        } catch (error) {
          if (error?.name === 'AbortError') return;
          setStatus('error');
          setError(error instanceof Error ? error.message : t('failed'));
        } finally {
          if (abortRef.current === controller) abortRef.current = null;
        }
      }, [draft, inputActions, sessionId, status, t, text]);

      const label = status === 'busy' ? t('busy') : status === 'done' ? t('doneShort') : t('button');
      return h('div', { className: 'pe-root' },
        h('button', {
          type: 'button',
          className: 'pe-button'
            + (status === 'done' ? ' pe-done' : '')
            + (status === 'error' ? ' pe-error' : ''),
          disabled,
          title: status === 'done' ? t('done') : status === 'error' && error ? error : t('hint'),
          'aria-label': t('button'),
          onClick: run,
        },
        h('span', { className: 'pe-icon', 'aria-hidden': true }, h(SparkleIcon)),
        h('span', null, label)),
        status === 'error' && error
          ? h('span', {
            className: 'pe-error-text',
            role: 'status',
            'aria-live': 'polite',
            title: error,
          }, error)
          : null,
        h('style', null, `
.pe-root{display:inline-flex;align-items:center;gap:6px;min-width:0;}
.pe-button{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 7px;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:1;cursor:pointer;white-space:nowrap;}
.pe-button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);}
.pe-button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;}
.pe-button:disabled{opacity:.42;cursor:default;}
.pe-button.pe-done{color:var(--dsw-alias-state-success-primary);}
.pe-button.pe-error{color:var(--dsw-alias-state-error-primary);}
.pe-icon{display:inline-flex;width:13px;height:13px;align-items:center;justify-content:center;}
.pe-icon svg{width:13px;height:13px;display:block;}
.pe-error-text{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-state-error-primary);font-size:12px;}
`)
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en: EN, zh: ZH }), 'prompt-enhancer-plus: locale');
        const t = ctx.locale.bind(NS);
        ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
          name: 'conversation.input.left',
          id: 'prompt-enhancer-plus',
          order: 0,
          label: () => t('button'),
        }, (props) => h(PromptEnhancer, { ...props, t })));
      },
    };
  },
});
