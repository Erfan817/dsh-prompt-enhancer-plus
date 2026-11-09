import { apply, enhancePrompt, enhancePromptDetailed } from './index.js';

function makeCtx(options = {}) {
  const routes = [];
  const chunks = options.chunks ?? [
    { type: 'text-delta', text: '请实现一个插件：' },
    { type: 'text-delta', text: '在输入框下方添加“强化提示词”按钮。' },
    { type: 'usage', usage: { inputTokens: 12, outputTokens: 20, totalTokens: 32 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ];
  const ctx = {
    agents: {
      get() {
        return undefined;
      },
    },
    agentDefaultModel: {
      currentSelection() {
        return options.route === undefined ? { provider: 'test-provider', model: 'test-model' } : options.route;
      },
    },
    llm: {
      async prepareCall(config) {
        if (options.prepareError !== undefined) throw options.prepareError;
        return {
          config,
          stream() {
            return (async function* () {
              for (const chunk of chunks) yield chunk;
            })();
          },
        };
      },
    },
    connection: {
      fetch: {
        register(route) {
          routes.push(route);
          return () => {};
        },
      },
    },
    effect(fn) {
      return fn();
    },
  };
  return { ctx, routes };
}

async function callRoute(route, body) {
  const response = await route.fetch(new Request('http://local/api/prompt-enhancer-plus/enhance', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));
  return { status: response.status, body: await response.json() };
}

const { ctx, routes } = makeCtx();
apply(ctx);
if (routes.length !== 1) throw new Error(`expected one route, got ${routes.length}`);
if (routes[0].path !== '/api/prompt-enhancer-plus/enhance') throw new Error('wrong route path');

const success = await callRoute(routes[0], { text: '做一个插件', sessionId: 'session-1', mode: 'system' });
if (success.status !== 200 || typeof success.body.enhanced !== 'string' || success.body.enhanced.length === 0) {
  throw new Error(`success case failed: ${JSON.stringify(success)}`);
}
if (success.body.mode !== 'system') throw new Error('mode was not returned');
if (success.body.usage?.totalTokens !== 32) throw new Error('usage was not returned');
if (typeof success.body.elapsedMs !== 'number') throw new Error('elapsedMs was not returned');
console.log('success:', success.body.enhanced, '| mode:', success.body.mode, '| tokens:', success.body.usage.totalTokens);

const empty = await callRoute(routes[0], { text: '   ' });
if (empty.status !== 400 || empty.body.error.code !== 'empty-input') throw new Error(`empty case failed: ${JSON.stringify(empty)}`);
console.log('empty input ->', empty.status, empty.body.error.code);

const limitedCtx = makeCtx();
apply(limitedCtx.ctx, { maxInputChars: 4 });
const tooLong = await callRoute(limitedCtx.routes[0], { text: '12345' });
if (tooLong.status !== 400 || tooLong.body.error.code !== 'too-long') throw new Error(`limit case failed: ${JSON.stringify(tooLong)}`);
console.log('configured limit ->', tooLong.status, tooLong.body.error.code);

const noRouteCtx = makeCtx({ route: {} });
const noRoute = await enhancePrompt(noRouteCtx.ctx, 'hello', undefined, undefined).catch((error) => error);
if (!(noRoute instanceof Error) || noRoute.code !== 'no-route') throw new Error('no-route case failed');
console.log('no route ->', noRoute.code);

const failedCtx = makeCtx({
  chunks: [{ type: 'finish', reason: { kind: 'error', failure: { message: 'provider exploded', code: 'boom' } } }],
});
const failed = await enhancePrompt(failedCtx.ctx, 'hello', undefined, undefined).catch((error) => error);
if (!(failed instanceof Error) || failed.code !== 'model-failed') throw new Error('model failure case failed');
console.log('model failure ->', failed.code);

const fencedCtx = makeCtx({
  chunks: [
    { type: 'block-end', index: 0, block: { type: 'text', text: '```text\nA better prompt\n```' } },
    { type: 'finish', reason: { kind: 'stop' } },
  ],
});
const fenced = await enhancePrompt(fencedCtx.ctx, 'hello', undefined, undefined);
if (fenced !== 'A better prompt') throw new Error(`fence stripping failed: ${JSON.stringify(fenced)}`);
console.log('fence stripping ->', JSON.stringify(fenced));

const detailed = await enhancePromptDetailed(ctx, 'hello', undefined, undefined, { maxOutputTokens: 3000, timeoutMs: 90000 }, 'concise');
if (detailed.mode !== 'concise' || detailed.enhanced.length === 0 || detailed.usage === null) {
  throw new Error(`detailed result failed: ${JSON.stringify(detailed)}`);
}
console.log('detailed result ->', detailed.mode, detailed.usage.totalTokens, detailed.model.model);

console.log('host tests passed');
