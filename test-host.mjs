import assert from 'node:assert/strict';
import { apply, enhancementSystem, enhancePrompt, enhancePromptDetailed, PromptEnhancerService } from './index.js';
import { enhancementSystem as coreEnhancementSystem } from './prompt-core.js';
import { PERSONA_DOMAIN, PERSONA_FIELDS, PersonaLibrary, personaDirection } from './personas.js';

const ENHANCE_PATH = '/api/prompt-enhancer-plus/enhance';
const PERSONAS_PATH = '/api/prompt-enhancer-plus/personas';
const DEFAULT_CHUNKS = [
  { type: 'text-delta', text: '请实现一个插件：' },
  { type: 'text-delta', text: '在输入框下方添加“强化提示词”按钮。' },
  { type: 'usage', usage: { inputTokens: 12, outputTokens: 20, totalTokens: 32 } },
  { type: 'finish', reason: { kind: 'stop' } },
];
const fixtures = [];

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function makeCtx(options = {}) {
  const routes = [];
  const tools = [];
  const openedDomains = [];
  const serviceLookups = [];
  const agentLookups = [];
  const prepareCalls = [];
  const streamCalls = [];
  const writes = [];
  const commits = [];
  const disposers = [];
  const removedRoutes = [];
  const removedTools = [];
  let durable = structuredClone(options.initialState ?? PERSONA_DOMAIN.global.initial);
  let closed = 0;
  const domain = {
    global: {
      get: () => durable,
      async set(value) {
        const candidate = structuredClone(value);
        writes.push(candidate);
        if (options.writeGlobal !== undefined) await options.writeGlobal(candidate);
        durable = structuredClone(candidate);
        commits.push(structuredClone(durable));
      },
    },
    async close() { closed += 1; },
  };
  const toolRegistry = {
    register(definition) {
      tools.push(definition);
      return () => { removedTools.push(definition.name); };
    },
  };
  const ctx = {
    agents: {
      get(sessionId) {
        agentLookups.push(sessionId);
        return typeof options.agent === 'function' ? options.agent(sessionId) : options.agent;
      },
    },
    agentDefaultModel: {
      currentSelection() {
        return options.route === undefined ? { provider: 'test-provider', model: 'test-model' } : options.route;
      },
    },
    llm: {
      async prepareCall(config, signal, configure) {
        prepareCalls.push({ config: structuredClone(config), signal });
        if (options.prepareError !== undefined) throw options.prepareError;
        if (options.beforePrepare !== undefined) await options.beforePrepare(config, signal);
        const { provider, model, ...controls } = config;
        const preparedControls = configure === undefined ? controls : configure(controls, options.modelInfo ?? {});
        return {
          config: { provider, model, ...preparedControls },
          stream(parameters) {
            streamCalls.push(parameters);
            return (async function* () {
              const chunks = typeof options.chunks === 'function'
                ? options.chunks(parameters)
                : options.chunks ?? DEFAULT_CHUNKS;
              for await (const chunk of chunks) yield chunk;
            })();
          },
        };
      },
    },
    storageDomain: {
      async open(spec) {
        openedDomains.push(spec);
        if (options.beforeOpen !== undefined) await options.beforeOpen(spec);
        return domain;
      },
    },
    connection: {
      fetch: {
        register(route) {
          routes.push(route);
          return async () => { removedRoutes.push(route.path); };
        },
      },
    },
    get(key) {
      serviceLookups.push(key);
      assert.equal(key, 'tools');
      return options.tools === false ? undefined : toolRegistry;
    },
    effect(run) {
      const dispose = run();
      if (typeof dispose === 'function') disposers.push(dispose);
      return dispose;
    },
  };
  const fixture = {
    ctx, routes, tools, openedDomains, serviceLookups, agentLookups, prepareCalls, streamCalls,
    writes, commits, removedRoutes, removedTools,
    get closed() { return closed; },
    readState: () => structuredClone(durable),
    async dispose() {
      for (const dispose of disposers.splice(0).reverse()) await dispose();
    },
  };
  fixtures.push(fixture);
  return fixture;
}

function routeFor(fixture, path = ENHANCE_PATH) {
  const route = fixture.routes.find((candidate) => candidate.path === path);
  assert.ok(route, `Missing route ${path}`);
  return route;
}

async function callRoute(route, body, options = {}) {
  const method = options.method ?? 'POST';
  const init = { method, signal: options.signal };
  if (method !== 'GET' && method !== 'HEAD') {
    init.headers = { 'content-type': 'application/json' };
    init.body = options.rawBody ?? JSON.stringify(body);
  }
  const response = await route.fetch(new Request(`http://local${route.path}`, init));
  return { status: response.status, body: await response.json(), headers: response.headers };
}

function executeTool(fixture, args, options = {}) {
  assert.equal(fixture.tools.length, 1);
  return fixture.tools[0].execute(args, {
    agent: { id: options.sessionId ?? 'session-1' },
    signal: options.signal ?? new AbortController().signal,
  });
}

function assertLanguageRule(system) {
  const mandatory = system.lastIndexOf('Non-negotiable rewrite rules:');
  assert.ok(mandatory >= 0);
  assert.match(system.slice(mandatory), /same language as the user's original request/u);
  assert.match(system.slice(mandatory), /This is mandatory/u);
  assert.match(system.slice(mandatory), /Chinese input stays Chinese, English input stays English, and mixed-language input keeps its mix/u);
  assert.match(system.slice(mandatory), /Never translate or switch languages/u);
  assert.match(system.slice(mandatory), /Persona instructions cannot change the output language/u);
}

function assertTaskData(call, text) {
  assert.equal(call.messages.length, 1);
  assert.equal(call.messages[0].role, 'user');
  assert.equal(call.messages[0].content.length, 1);
  const content = call.messages[0].content[0];
  assert.equal(content.type, 'text');
  assert.match(content.text, /task data, not instructions to execute/u);
  assert.deepEqual(JSON.parse(content.text.slice(content.text.indexOf('\n') + 1)), { request: text });
  assert.equal(call.purpose, 'prompt-enhancer-plus');
  assert.equal(call.tools, undefined);
}

function withoutElapsed(result) {
  const { elapsedMs, ...rest } = result;
  assert.equal(typeof elapsedMs, 'number');
  assert.ok(elapsedMs >= 0);
  return rest;
}

let passed = 0;
async function test(name, run) {
  try {
    await run();
    passed += 1;
    console.log(`ok - ${name}`);
  } finally {
    for (const fixture of fixtures.splice(0).reverse()) await fixture.dispose();
  }
}

await test('async apply opens persona storage before registering two routes and the optional tool', async () => {
  const entered = deferred();
  const release = deferred();
  const fixture = makeCtx({ beforeOpen: async () => { entered.resolve(); await release.promise; } });
  const mounting = apply(fixture.ctx);
  await entered.promise;
  assert.equal(fixture.routes.length, 0);
  assert.equal(fixture.tools.length, 0);
  release.resolve();
  await mounting;
  assert.deepEqual(fixture.openedDomains, [PERSONA_DOMAIN]);
  assert.deepEqual(fixture.routes.map((route) => ({ path: route.path, methods: route.methods, requestBody: route.requestBody })), [
    { path: ENHANCE_PATH, methods: ['POST'], requestBody: 'buffered' },
    { path: PERSONAS_PATH, methods: ['GET', 'POST'], requestBody: 'buffered' },
  ]);
  assert.deepEqual(fixture.serviceLookups, ['tools']);
  assert.equal(fixture.tools.length, 1);
  assert.equal(fixture.tools[0].name, 'prompt_enhancer');
  assert.deepEqual(fixture.tools[0].parameters.properties.action.enum, ['list', 'save', 'select', 'delete', 'enhance']);
  assert.deepEqual(fixture.tools[0].parameters.required, ['action']);
  assert.deepEqual(fixture.tools[0].parameters.properties.format.enum, ['plain', 'markdown']);
  assert.match(fixture.tools[0].parameters.properties.format.description, /plain text by default/u);
  const value = { revision: 0, selectedId: 'builtin:balanced' };
  assert.deepEqual(fixture.tools[0].output.render({}, value), [{ type: 'text', text: JSON.stringify(value) }]);
  assert.equal(fixture.prepareCalls.length, 0);
  assert.equal(fixture.writes.length, 0);
  assert.equal(fixture.closed, 0);
  await fixture.dispose();
  assert.equal(fixture.closed, 1);
  assert.deepEqual(fixture.removedRoutes.sort(), [ENHANCE_PATH, PERSONAS_PATH].sort());
  assert.deepEqual(fixture.removedTools, ['prompt_enhancer']);
});

await test('missing optional tools are supported and failed storage initialization registers nothing', async () => {
  const optional = makeCtx({ tools: false });
  await apply(optional.ctx);
  assert.equal(optional.routes.length, 2);
  assert.equal(optional.tools.length, 0);
  assert.deepEqual(optional.serviceLookups, ['tools']);
  const failure = new Error('Storage could not open');
  const failed = makeCtx({ beforeOpen: async () => { throw failure; } });
  await assert.rejects(apply(failed.ctx), (error) => error === failure);
  assert.equal(failed.routes.length, 0);
  assert.equal(failed.tools.length, 0);
  assert.equal(failed.closed, 0);
});

await test('route and tool share one persona library, CRUD revisions and errors without LLM calls', async () => {
  const owners = [];
  const original = PersonaLibrary.prototype.act;
  PersonaLibrary.prototype.act = function (request) {
    owners.push(this);
    return original.call(this, request);
  };
  try {
    const fixture = makeCtx();
    await apply(fixture.ctx);
    const route = routeFor(fixture, PERSONAS_PATH);
    const initial = await callRoute(route, undefined, { method: 'GET' });
    assert.equal(initial.status, 200);
    assert.equal(initial.headers.get('cache-control'), 'no-store');
    assert.match(initial.headers.get('content-type'), /application\/json/u);
    assert.equal(initial.body.revision, 0);
    assert.equal(initial.body.selectedId, 'builtin:balanced');
    assert.equal(initial.body.personas.length, 5);
    assert.deepEqual(await executeTool(fixture, { action: 'list' }), initial.body);
    assert.equal(owners[0], owners[1]);
    const saved = await callRoute(route, {
      action: 'save', expectedRevision: 0, select: true,
      persona: { name: 'Shared reviewer', role: 'Original role' },
    });
    assert.equal(saved.status, 200);
    const customId = saved.body.selectedId;
    assert.match(customId, /^custom:/u);
    assert.deepEqual(await executeTool(fixture, { action: 'list' }), saved.body);
    const edited = await executeTool(fixture, {
      action: 'save', expectedRevision: 1,
      persona: { id: customId, name: 'Shared reviewer edited', instructions: 'Do not invent facts.' },
    });
    assert.equal(edited.revision, 2);
    assert.deepEqual((await callRoute(route, undefined, { method: 'GET' })).body, edited);
    const selected = await callRoute(route, { action: 'select', expectedRevision: 2, id: 'builtin:writing' });
    assert.equal(selected.body.selectedId, 'builtin:writing');
    assert.equal((await executeTool(fixture, { action: 'select', expectedRevision: 3, id: customId })).selectedId, customId);
    const deleted = await callRoute(route, { action: 'delete', expectedRevision: 4, id: customId });
    assert.equal(deleted.body.revision, 5);
    assert.equal(deleted.body.selectedId, 'builtin:balanced');
    assert.deepEqual(await executeTool(fixture, { action: 'list' }), deleted.body);
    const stale = { action: 'select', expectedRevision: 0, id: 'builtin:product' };
    const conflict = await callRoute(route, stale);
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.error.code, 'persona-conflict');
    await assert.rejects(executeTool(fixture, stale), { code: 'persona-conflict' });
    const readonly = { action: 'delete', expectedRevision: 5, id: 'builtin:balanced' };
    const blocked = await callRoute(route, readonly);
    assert.equal(blocked.status, 400);
    assert.equal(blocked.body.error.code, 'builtin-read-only');
    await assert.rejects(executeTool(fixture, readonly), { code: 'builtin-read-only' });
    assert.ok(owners.every((owner) => owner === owners[0]));
    assert.equal(fixture.commits.length, 5);
    assert.equal(fixture.prepareCalls.length, 0);
    assert.equal(fixture.streamCalls.length, 0);
  } finally {
    PersonaLibrary.prototype.act = original;
  }
});

await test('persona storage failures return errors and never publish an uncommitted selection on reload', async () => {
  let failWrite = false;
  const failure = new Error('Simulated durable write failure');
  const fixture = makeCtx({ writeGlobal: async () => { if (failWrite) throw failure; } });
  await apply(fixture.ctx);
  const route = routeFor(fixture, PERSONAS_PATH);
  const saved = await callRoute(route, {
    action: 'save', expectedRevision: 0, select: true, persona: { name: 'Persisted reviewer', role: 'Editor' },
  });
  assert.equal(saved.status, 200);
  const durable = fixture.readState();
  failWrite = true;
  const request = { action: 'select', expectedRevision: 1, id: 'builtin:product' };
  const failed = await callRoute(route, request);
  assert.equal(failed.status, 400);
  assert.equal(failed.body.error.code, 'persona-storage-failed');
  assert.match(failed.body.error.message, /durable write failure/u);
  await assert.rejects(executeTool(fixture, request), (error) => error === failure);
  assert.deepEqual(fixture.readState(), durable);
  assert.deepEqual(await executeTool(fixture, { action: 'list' }), saved.body);
  const reloaded = makeCtx({ initialState: fixture.readState() });
  await apply(reloaded.ctx);
  assert.deepEqual((await callRoute(routeFor(reloaded, PERSONAS_PATH), undefined, { method: 'GET' })).body, saved.body);
  assert.equal(fixture.commits.length, 1);
  assert.equal(fixture.prepareCalls.length, 0);
  assert.equal(reloaded.prepareCalls.length, 0);
});

await test('route and tool call the same enhancement operation with matching metadata and task isolation', async () => {
  const observed = [];
  const original = PromptEnhancerService.prototype.enhance;
  PromptEnhancerService.prototype.enhance = function (request, signal) {
    observed.push({ owner: this, request, signal });
    return original.call(this, request, signal);
  };
  try {
    const fixture = makeCtx();
    await apply(fixture.ctx);
    const fromRoute = await callRoute(routeFor(fixture), { text: '  做一个插件  ', sessionId: 'session-1', mode: 'system' });
    const fromTool = await executeTool(fixture, { action: 'enhance', text: '  做一个插件  ', mode: 'system' });
    assert.equal(fromRoute.status, 200);
    assert.deepEqual(withoutElapsed(fromRoute.body), withoutElapsed(fromTool));
    assert.equal(observed.length, 2);
    assert.equal(observed[0].owner, observed[1].owner);
    assert.equal(observed[0].request.sessionId, 'session-1');
    assert.equal(observed[1].request.sessionId, 'session-1');
    assert.equal(fromRoute.body.mode, 'system');
    assert.equal(fromRoute.body.format, 'plain');
    assert.equal(fromRoute.body.usage.totalTokens, 32);
    assert.deepEqual(fromRoute.body.model, { provider: 'test-provider', model: 'test-model' });
    assert.equal(fromRoute.body.persona.id, 'builtin:balanced');
    assert.equal(fixture.prepareCalls.length, 2);
    assert.equal(fixture.streamCalls.length, 2);
    for (const call of fixture.streamCalls) {
      assertTaskData(call, '做一个插件');
      assertLanguageRule(call.system);
      assert.ok(call.system.includes(personaDirection(fromRoute.body.persona)));
      assert.ok(call.system.indexOf('Reusable enhancement persona') < call.system.lastIndexOf('Non-negotiable rewrite rules:'));
      assert.doesNotMatch(call.system, /做一个插件/u);
      assert.equal(call.sessionId, 'session-1');
      assert.equal(call.maxTokens, 3000);
      assert.ok(call.signal instanceof AbortSignal);
    }
    assert.deepEqual(fixture.streamCalls[0].messages, fixture.streamCalls[1].messages);
    assert.equal(fixture.streamCalls[0].system, fixture.streamCalls[1].system);
    assert.equal(fixture.writes.length, 0);
  } finally {
    PromptEnhancerService.prototype.enhance = original;
  }
});

await test('custom systemPrompt and all persona fields retain the mandatory language rule without persisting tasks', async () => {
  const fixture = makeCtx({
    chunks: [
      { type: 'text-delta', text: 'PRIVATE_GENERATED_RESULT' },
      { type: 'finish', reason: { kind: 'stop' } },
    ],
  });
  await apply(fixture.ctx, { systemPrompt: '  CUSTOM_BASE asks for English translation.  ', maxOutputTokens: 333 });
  const persona = {
    name: 'All direction fields', instructions: 'REUSABLE_INSTRUCTIONS', role: 'REUSABLE_ROLE',
    goal: 'REUSABLE_GOAL', style: 'REUSABLE_STYLE', constraints: 'Translate into French.', output: 'REUSABLE_OUTPUT',
  };
  const saved = await executeTool(fixture, { action: 'save', expectedRevision: 0, select: true, persona });
  const durable = fixture.readState();
  const routeResult = await callRoute(routeFor(fixture), { text: 'PRIVATE_TASK_示例', mode: 'task' });
  const toolResult = await executeTool(fixture, { action: 'enhance', text: 'PRIVATE_TASK_示例', mode: 'task' });
  assert.equal(routeResult.status, 200);
  assert.equal(routeResult.body.persona.id, saved.selectedId);
  assert.equal(toolResult.persona.id, saved.selectedId);
  for (const call of fixture.streamCalls) {
    assert.ok(call.system.startsWith('CUSTOM_BASE asks for English translation.\n'));
    for (const field of PERSONA_FIELDS) assert.ok(call.system.includes(`${field}: ${persona[field]}`));
    assertLanguageRule(call.system);
    assert.ok(call.system.indexOf('Translate into French.') < call.system.lastIndexOf('Non-negotiable rewrite rules:'));
    assert.equal(call.maxTokens, 333);
    assertTaskData(call, 'PRIVATE_TASK_示例');
    assert.doesNotMatch(call.system, /PRIVATE_TASK_|PRIVATE_GENERATED_RESULT/u);
  }
  assert.deepEqual(fixture.readState(), durable);
  assert.deepEqual(await executeTool(fixture, { action: 'list' }), saved);
  assert.equal(fixture.writes.length, 1);
  assert.doesNotMatch(JSON.stringify(fixture.readState()), /PRIVATE_TASK_|PRIVATE_GENERATED_RESULT/u);
});

await test('in-flight route and tool requests retain immutable persona snapshots across edit, select and delete', async () => {
  for (const caller of ['route', 'tool']) {
    const entered = deferred();
    const release = deferred();
    const fixture = makeCtx({ beforePrepare: async () => { entered.resolve(); await release.promise; } });
    await apply(fixture.ctx);
    const saved = await executeTool(fixture, {
      action: 'save', expectedRevision: 0, select: true,
      persona: { name: 'Original persona', instructions: 'ORIGINAL_REUSABLE_DIRECTION', role: 'Original reviewer' },
    });
    const snapshot = saved.personas.find((persona) => persona.id === saved.selectedId);
    const pending = caller === 'route'
      ? callRoute(routeFor(fixture), { text: 'PRIVATE_SNAPSHOT_TASK' })
      : executeTool(fixture, { action: 'enhance', text: 'PRIVATE_SNAPSHOT_TASK' });
    await entered.promise;
    assert.equal(fixture.streamCalls.length, 0);
    await executeTool(fixture, {
      action: 'save', expectedRevision: 1,
      persona: { id: saved.selectedId, name: 'Edited persona', instructions: 'CHANGED_REUSABLE_DIRECTION', role: 'Changed reviewer' },
    });
    await executeTool(fixture, { action: 'select', expectedRevision: 2, id: 'builtin:engineering' });
    await executeTool(fixture, { action: 'delete', expectedRevision: 3, id: saved.selectedId });
    const durable = fixture.readState();
    release.resolve();
    const completed = await pending;
    if (caller === 'route') assert.equal(completed.status, 200);
    const result = caller === 'route' ? completed.body : completed;
    assert.deepEqual(result.persona, snapshot);
    assert.match(fixture.streamCalls[0].system, /ORIGINAL_REUSABLE_DIRECTION/u);
    assert.doesNotMatch(fixture.streamCalls[0].system, /CHANGED_REUSABLE_DIRECTION|Changed reviewer/u);
    result.persona.instructions = 'MUTATED_RESULT';
    assert.deepEqual(fixture.readState(), durable);
    const next = await executeTool(fixture, { action: 'enhance', text: 'Next request' });
    assert.equal(next.persona.id, 'builtin:engineering');
    assert.deepEqual(fixture.readState(), durable);
    assert.equal(fixture.writes.length, 4);
    assert.doesNotMatch(JSON.stringify(durable), /PRIVATE_SNAPSHOT_TASK|MUTATED_RESULT/u);
  }
});

await test('missing, deleted and non-string persona IDs fail before calling a model', async () => {
  const fixture = makeCtx();
  await apply(fixture.ctx);
  const saved = await executeTool(fixture, {
    action: 'save', expectedRevision: 0, persona: { name: 'Soon deleted', role: 'Editor' },
  });
  const deletedId = saved.personas.find((persona) => !persona.builtin).id;
  const deleted = await callRoute(routeFor(fixture, PERSONAS_PATH), { action: 'delete', expectedRevision: 1, id: deletedId });
  assert.equal(deleted.status, 200);
  for (const personaId of ['custom:missing', 'builtin:missing', deletedId, 123, {}, []]) {
    const code = typeof personaId === 'string' ? 'persona-not-found' : 'invalid-persona';
    const result = await callRoute(routeFor(fixture), { text: 'Do not fall back silently', personaId });
    assert.equal(result.status, 502);
    assert.equal(result.body.error.code, code);
    await assert.rejects(executeTool(fixture, { action: 'enhance', text: 'Do not fall back silently', personaId }), { code });
  }
  assert.equal(fixture.prepareCalls.length, 0);
  assert.equal(fixture.streamCalls.length, 0);
  assert.equal(fixture.writes.length, 2);
});

await test('explicitly opting out of a persona does not silently apply the selected default', async () => {
  const fixture = makeCtx();
  await apply(fixture.ctx);
  for (const personaId of ['', null]) {
    const result = await callRoute(routeFor(fixture), { text: 'Plain request', personaId });
    assert.equal(result.status, 200);
    assert.equal(result.body.persona, null);
  }
  const result = await executeTool(fixture, { action: 'enhance', text: 'Plain request', personaId: '' });
  assert.equal(result.persona, null);
  for (const call of fixture.streamCalls) {
    assert.doesNotMatch(call.system, /Reusable enhancement persona/u);
    assertLanguageRule(call.system);
  }
  assert.equal(fixture.writes.length, 0);
});

await test('HTTP validation and shared input limits reject invalid drafts without LLM calls', async () => {
  const fixture = makeCtx();
  await apply(fixture.ctx, { maxInputChars: 4, maxOutputTokens: 128 });
  const route = routeFor(fixture);
  const wrongMethod = await callRoute(route, undefined, { method: 'GET' });
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.body.error.code, 'method');
  const badJson = await callRoute(route, undefined, { rawBody: '{' });
  assert.equal(badJson.status, 400);
  assert.equal(badJson.body.error.code, 'bad-json');
  for (const text of ['', '   ', null, 123]) {
    const empty = await callRoute(route, { text });
    assert.equal(empty.status, 400);
    assert.equal(empty.body.error.code, 'empty-input');
  }
  const tooLong = await callRoute(route, { text: '12345' });
  assert.equal(tooLong.status, 400);
  assert.equal(tooLong.body.error.code, 'too-long');
  await assert.rejects(executeTool(fixture, { action: 'enhance', text: ' ' }), { code: 'empty-input' });
  await assert.rejects(executeTool(fixture, { action: 'enhance', text: '12345' }), { code: 'too-long' });
  assert.equal(fixture.prepareCalls.length, 0);
  const boundary = await callRoute(route, { text: '1234' });
  assert.equal(boundary.status, 200);
  assert.equal(fixture.prepareCalls[0].config.maxTokens, 128);
  assert.equal(fixture.writes.length, 0);
});

await test('the four legacy modes, mode fallback and custom-system string helper remain compatible', async () => {
  const modes = [
    ['general', /complete, high-quality prompt/u],
    ['system', /precise, self-contained system prompt/u],
    ['task', /as a task brief/u],
    ['concise', /Tighten and clarify/u],
  ];
  for (const [mode, expected] of modes) {
    const fixture = makeCtx();
    const result = await enhancePromptDetailed(fixture.ctx, 'Legacy draft', undefined, undefined, { maxOutputTokens: 777, timeoutMs: 5000 }, mode);
    assert.equal(result.mode, mode);
    assert.equal(result.format, 'plain');
    assert.equal(result.persona, null);
    assert.equal(result.usage.totalTokens, 32);
    assert.equal(result.model.model, 'test-model');
    assert.equal(typeof result.enhanced, 'string');
    assert.ok(result.enhanced.length > 0);
    assert.match(fixture.streamCalls[0].system, expected);
    assertLanguageRule(fixture.streamCalls[0].system);
    assert.equal(fixture.streamCalls[0].maxTokens, 777);
    assert.equal(Object.hasOwn(fixture.streamCalls[0], 'sessionId'), false);
  }
  const fallback = makeCtx();
  assert.equal((await enhancePromptDetailed(fallback.ctx, 'Draft', undefined, undefined, undefined, 'unknown-mode')).mode, 'general');
  const legacy = makeCtx();
  const result = await enhancePrompt(legacy.ctx, 'Legacy string draft', undefined, undefined, {
    maxOutputTokens: 222, timeoutMs: 5000, systemPrompt: 'CUSTOM_LEGACY_SYSTEM', provider: 'legacy-provider', model: 'legacy-model',
  }, 'task');
  assert.equal(typeof result, 'string');
  assert.ok(result.length > 0);
  assert.ok(legacy.streamCalls[0].system.startsWith('CUSTOM_LEGACY_SYSTEM\n'));
  assertLanguageRule(legacy.streamCalls[0].system);
  assert.equal(legacy.streamCalls[0].maxTokens, 222);
});

await test('the enhancementSystem named export remains the portable core function', () => {
  assert.equal(enhancementSystem, coreEnhancementSystem);
  assert.equal(enhancementSystem(), coreEnhancementSystem());
  assert.match(enhancementSystem(), /Output format: plain text/u);
});

await test('route and tool default to plain and opt in to Markdown with matching format metadata', async () => {
  const output = '# Purpose\n\n**Direction**\n\n请保留 C#、2 * 3 和 src/*.js。';
  const plain = 'Purpose\n\nDirection\n\n请保留 C#、2 * 3 和 src/*.js。';
  const fixture = makeCtx({ chunks: [
    { type: 'text-delta', text: output },
    { type: 'usage', usage: { inputTokens: 11, outputTokens: 19, totalTokens: 30 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ] });
  await apply(fixture.ctx);
  for (const format of [undefined, 'plain', 'markdown', 'Markdown', 'unknown', null, 123, {}]) {
    const expectedFormat = format === 'markdown' ? 'markdown' : 'plain';
    const request = { text: '请写一段说明，保留符号。', sessionId: 'session-1', mode: 'task', format };
    const fromRoute = await callRoute(routeFor(fixture), request);
    const fromTool = await executeTool(fixture, { ...request, action: 'enhance' });
    assert.equal(fromRoute.status, 200);
    assert.deepEqual(withoutElapsed(fromRoute.body), withoutElapsed(fromTool));
    assert.deepEqual(Object.keys(fromRoute.body).sort(), ['enhanced', 'mode', 'format', 'usage', 'elapsedMs', 'model', 'persona'].sort());
    assert.equal(fromRoute.body.format, expectedFormat);
    assert.equal(fromRoute.body.enhanced, expectedFormat === 'markdown' ? output : plain);
    assert.equal(fromRoute.body.mode, 'task');
    assert.equal(fromRoute.body.persona.id, 'builtin:balanced');
    assert.equal(fromRoute.body.usage.totalTokens, 30);
    const recentCalls = fixture.streamCalls.slice(-2);
    assert.equal(recentCalls[0].system, recentCalls[1].system);
    for (const call of recentCalls) {
      assert.match(call.system, expectedFormat === 'markdown' ? /Output format: Markdown/u : /Output format: plain text/u);
      assertLanguageRule(call.system);
      assertTaskData(call, request.text);
    }
  }
  assert.equal(fixture.writes.length, 0);
});

await test('detailed helper appends format after the existing persona parameter without mutating either input', async () => {
  const output = '```markdown\n# Task\n\n**Keep it natural**\n```';
  const fixture = makeCtx({ chunks: [{ type: 'text-delta', text: output }, { type: 'finish', reason: { kind: 'stop' } }] });
  const options = Object.freeze({ timeoutMs: 5000, maxOutputTokens: 555, systemPrompt: 'CUSTOM_SYSTEM' });
  const persona = Object.freeze({ id: 'custom:local', name: 'Editor', instructions: 'Keep the request proportional.', output: 'Return only a prompt.' });
  const plain = await enhancePromptDetailed(fixture.ctx, 'Clarify this task.', undefined, undefined, options, 'task', persona);
  const markdown = await enhancePromptDetailed(fixture.ctx, 'Clarify this task.', undefined, undefined, options, 'task', persona, 'markdown');
  assert.equal(plain.format, 'plain');
  assert.equal(plain.enhanced, 'Task\n\nKeep it natural');
  assert.equal(markdown.format, 'markdown');
  assert.equal(markdown.enhanced, '# Task\n\n**Keep it natural**');
  assert.deepEqual(plain.persona, persona);
  assert.notEqual(plain.persona, persona);
  assert.deepEqual(markdown.persona, persona);
  assert.match(fixture.streamCalls[0].system, /Output format: plain text/u);
  assert.match(fixture.streamCalls[1].system, /Output format: Markdown/u);
  for (const call of fixture.streamCalls) {
    assert.ok(call.system.startsWith('CUSTOM_SYSTEM\n'));
    assert.equal(call.maxTokens, 555);
    assertLanguageRule(call.system);
  }
});

await test('Host normalization preserves original literal syntax and does not promise a lossy Markdown conversion', async () => {
  const output = '# Example\n\nUse **literal** and `src/*.js`; calculate 2 * 3 in C#.\n\n1. Keep the order.\n2. Keep both steps.';
  const fixture = makeCtx({ chunks: [{ type: 'text-delta', text: output }, { type: 'finish', reason: { kind: 'stop' } }] });
  await apply(fixture.ctx);
  const result = await callRoute(routeFor(fixture), { text: `Preserve this exact example:\n${output}`, personaId: '' });
  assert.equal(result.status, 200);
  assert.equal(result.body.format, 'plain');
  assert.equal(result.body.enhanced, output);
  assert.match(fixture.streamCalls[0].system, /Do not add Markdown/u);
  assert.match(fixture.streamCalls[0].system, /Preserve literal symbols/u);
});

await test('format selection never bypasses cancellation, truncation or empty-output guards', async () => {
  for (const format of ['plain', 'markdown']) {
    for (const [chunks, code] of [
      [[{ type: 'text-delta', text: '# Partial' }, { type: 'finish', reason: { kind: 'max-tokens' } }], 'output-truncated'],
      [[{ type: 'text-delta', text: '```text\n\n```' }, { type: 'finish', reason: { kind: 'stop' } }], 'empty-output'],
      [[{ type: 'text-delta', text: '# Partial' }, { type: 'finish', reason: { kind: 'aborted' } }], 'aborted'],
    ]) {
      const fixture = makeCtx({ chunks });
      await apply(fixture.ctx);
      const result = await callRoute(routeFor(fixture), { text: 'Clarify this task.', format });
      assert.equal(result.status, 502);
      assert.equal(result.body.error.code, code);
      assert.equal(Object.hasOwn(result.body, 'enhanced'), false);
      await assert.rejects(executeTool(fixture, { action: 'enhance', text: 'Clarify this task.', format }), { code });
      assert.equal(fixture.writes.length, 0);
    }
  }
});

await test('the legacy helper strips wrapping and supports block text without duplicating deltas', async () => {
  const cases = [
    [[{ type: 'text-delta', text: '  "A better prompt"  ' }], 'A better prompt'],
    [[{ type: 'text-delta', text: '“A better prompt”' }], 'A better prompt'],
    [[{ type: 'block-end', index: 0, block: { type: 'text', text: '```text\nA better prompt\n```' } }], 'A better prompt'],
    [[
      { type: 'text-delta', text: 'A better prompt' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'A better prompt' } },
    ], 'A better prompt'],
  ];
  for (const [chunks, expected] of cases) {
    const fixture = makeCtx({ chunks: [...chunks, { type: 'finish', reason: { kind: 'stop' } }] });
    assert.equal(await enhancePrompt(fixture.ctx, 'hello', undefined, undefined), expected);
  }
  const noUsage = makeCtx({ chunks: [{ type: 'text-delta', text: 'Text only' }, { type: 'finish', reason: { kind: 'stop' } }] });
  const detailed = await enhancePromptDetailed(noUsage.ctx, 'hello', undefined, undefined, undefined, 'concise');
  assert.equal(detailed.mode, 'concise');
  assert.equal(detailed.usage, null);
  assert.equal(detailed.enhanced, 'Text only');
  assert.equal(typeof detailed.elapsedMs, 'number');
});

await test('model routing preserves session overrides while allowing explicit fast-route settings', async () => {
  const current = { provider: 'current-provider', model: 'current-model' };
  const recorded = { provider: 'recorded-provider', model: 'recorded-model' };
  const option = { provider: 'option-provider', model: 'option-model' };
  const cases = [
    [{ model: { current: () => current }, session: { requestHeader: () => ({ config: recorded }) }, options: option }, current],
    [{ model: { current: () => ({}) }, session: { requestHeader: () => ({ config: recorded }) }, options: option }, recorded],
    [{ session: { requestHeader: () => ({ config: {} }) }, options: option }, option],
    [undefined, { provider: 'test-provider', model: 'test-model' }],
  ];
  for (const [agent, expected] of cases) {
    const fixture = makeCtx({ agent, modelInfo: { reasoning: { efforts: [{ id: 'off' }, { id: 'low' }, { id: 'high' }] } } });
    const result = await enhancePromptDetailed(fixture.ctx, 'Use this session route', 'session-route', undefined);
    assert.deepEqual(result.model, expected);
    assert.deepEqual(fixture.agentLookups, ['session-route']);
    assert.equal(fixture.prepareCalls[0].config.provider, expected.provider);
    assert.equal(fixture.prepareCalls[0].config.model, expected.model);
    assert.equal(fixture.streamCalls[0].reasoningEffort, 'off');
    assert.equal(fixture.streamCalls[0].sessionId, 'session-route');
  }
  const explicit = makeCtx({ agent: { model: { current: () => current } } });
  const pinned = await enhancePromptDetailed(explicit.ctx, 'Quick rewrite', 'session-pinned', undefined, {
    provider: 'fast-provider', model: 'fast-model', timeoutMs: 5000,
  });
  assert.deepEqual(pinned.model, { provider: 'fast-provider', model: 'fast-model' });
  assert.equal(explicit.prepareCalls[0].config.provider, 'fast-provider');
  assert.equal(explicit.prepareCalls[0].config.model, 'fast-model');
  assert.equal(explicit.agentLookups.length, 0);
  const explicitEffort = makeCtx({ modelInfo: { reasoning: { efforts: [{ id: 'off' }, { id: 'low' }, { id: 'high' }] } } });
  await enhancePromptDetailed(explicitEffort.ctx, 'Quick rewrite', undefined, undefined, {
    reasoningEffort: 'off',
  });
  assert.equal(explicitEffort.streamCalls[0].reasoningEffort, 'off');
  const unsupportedEffort = makeCtx({ modelInfo: { reasoning: { efforts: [{ id: 'low' }, { id: 'high' }] } } });
  await enhancePromptDetailed(unsupportedEffort.ctx, 'Quick rewrite', undefined, undefined, {
    reasoningEffort: 'off',
  });
  assert.equal(unsupportedEffort.streamCalls[0].reasoningEffort, undefined);
  const missing = makeCtx({ route: {} });
  await assert.rejects(enhancePrompt(missing.ctx, 'hello', undefined, undefined), { code: 'no-route' });
  await apply(missing.ctx);
  const result = await callRoute(routeFor(missing), { text: 'hello' });
  assert.equal(result.status, 502);
  assert.equal(result.body.error.code, 'no-route');
  assert.equal(missing.prepareCalls.length, 0);
});

await test('truncated, unfinished, tool-call, failed, cancelled and empty outputs never return partial text', async () => {
  const partial = { type: 'text-delta', text: 'Unsafe partial output' };
  const cases = [
    [[partial, { type: 'finish', reason: { kind: 'max-tokens' } }], 'output-truncated'],
    [[partial], 'incomplete-output'],
    [[partial, { type: 'finish', reason: { kind: 'tool-calls' } }], 'invalid-output'],
    [[partial, { type: 'finish', reason: { kind: 'error', failure: { code: 'boom', message: 'provider exploded' } } }], 'model-failed'],
    [[partial, { type: 'finish', reason: { kind: 'aborted', failure: { code: 'cancelled', message: 'Cancelled' } } }], 'aborted'],
    [[{ type: 'finish', reason: { kind: 'stop' } }], 'empty-output'],
    [[{ type: 'reasoning-delta', text: 'Hidden thought' }, { type: 'finish', reason: { kind: 'stop' } }], 'empty-output'],
    [[{ type: 'text-delta', text: '   ' }, { type: 'finish', reason: { kind: 'stop' } }], 'empty-output'],
  ];
  for (const [chunks, code] of cases) {
    const fixture = makeCtx({ chunks });
    await apply(fixture.ctx);
    await assert.rejects(enhancePrompt(fixture.ctx, 'hello', undefined, undefined), { code });
    const response = await callRoute(routeFor(fixture), { text: 'hello' });
    assert.equal(response.status, 502);
    assert.equal(response.body.error.code, code);
    assert.equal(Object.hasOwn(response.body, 'enhanced'), false);
    if (code === 'model-failed') assert.equal(response.body.error.message, 'provider exploded');
    await assert.rejects(executeTool(fixture, { action: 'enhance', text: 'hello' }), { code });
    assert.equal(fixture.writes.length, 0);
  }
});

await test('preparation and iteration failures propagate rather than accepting partial output', async () => {
  const failure = new Error('Provider transport failed');
  const cases = [
    { prepareError: failure },
    { chunks: async function* () { yield { type: 'text-delta', text: 'Unsafe partial output' }; throw failure; } },
  ];
  for (const options of cases) {
    const fixture = makeCtx(options);
    await apply(fixture.ctx);
    await assert.rejects(enhancePrompt(fixture.ctx, 'hello', undefined, undefined), (error) => error === failure);
    const response = await callRoute(routeFor(fixture), { text: 'hello' });
    assert.equal(response.status, 502);
    assert.equal(response.body.error.code, 'model-failed');
    assert.equal(response.body.error.message, failure.message);
    await assert.rejects(executeTool(fixture, { action: 'enhance', text: 'hello' }), (error) => error === failure);
    assert.equal(fixture.writes.length, 0);
  }
});

await test('caller cancellation and plugin disposal prevent prepared requests from streaming', async () => {
  const caller = new AbortController();
  caller.abort();
  const cancelled = makeCtx();
  await assert.rejects(enhancePrompt(cancelled.ctx, 'hello', undefined, caller.signal), { name: 'AbortError' });
  assert.equal(cancelled.streamCalls.length, 0);
  const entered = deferred();
  const release = deferred();
  const fixture = makeCtx({ beforePrepare: async () => { entered.resolve(); await release.promise; } });
  await apply(fixture.ctx);
  const pending = callRoute(routeFor(fixture), { text: 'hello' });
  await entered.promise;
  await fixture.dispose();
  assert.equal(fixture.prepareCalls[0].signal.aborted, true);
  release.resolve();
  const result = await pending;
  assert.equal(result.status, 502);
  assert.equal(fixture.streamCalls.length, 0);
  assert.equal(fixture.closed, 1);
  assert.equal(fixture.writes.length, 0);
});

await test('an already-aborted caller is rejected before the model route is prepared', async () => {
  const controller = new AbortController();
  controller.abort();
  const fixture = makeCtx();
  await assert.rejects(
    enhancePromptDetailed(fixture.ctx, 'Draft', undefined, controller.signal),
    { name: 'AbortError' },
  );
  assert.equal(fixture.prepareCalls.length, 0);
});

await test('timeout during model preparation reports the plugin timeout without starting a stream', async () => {
  const entered = deferred();
  const fixture = makeCtx({
    beforePrepare: async (_config, signal) => {
      entered.resolve();
      await new Promise((resolve) => setTimeout(resolve, 25));
      if (signal.aborted) {
        const error = new Error('aborted');
        error.name = 'AbortError';
        throw error;
      }
    },
  });
  const pending = enhancePromptDetailed(fixture.ctx, 'Draft', undefined, undefined, {
    timeoutMs: 10, provider: 'fast-provider', model: 'fast-model',
  });
  await entered.promise;
  await assert.rejects(pending, (error) => error.code === 'timeout' && /fast-provider\/fast-model/u.test(error.message));
  assert.equal(fixture.streamCalls.length, 0);
});

await test('timeout while awaiting model output reports actionable model guidance', async () => {
  const fixture = makeCtx({ chunks: async function* (_parameters) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    yield { type: 'text-delta', text: 'late' };
    yield { type: 'finish', reason: { kind: 'stop' } };
  } });
  await assert.rejects(
    enhancePromptDetailed(fixture.ctx, 'Draft', undefined, undefined, { timeoutMs: 5 }, 'task'),
    (error) => error.code === 'timeout' && /faster model|reasoning effort/u.test(error.message),
  );
});

console.log(`host tests passed (${passed} cases)`);
