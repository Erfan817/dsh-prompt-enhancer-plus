/**
 * Host half of the prompt-enhancer-plus bundle.
 *
 * The browser button calls an authenticated exact Fetch route on `/api`.
 * That route runs one auxiliary LLM request on the current session's model
 * route and returns the rewritten prompt plus lightweight usage metadata;
 * it never enters conversation history and never changes the session log.
 */

import { PERSONA_DOMAIN, PERSONA_FIELDS, PersonaLibrary } from './personas.js';
import { enhancementSystem, inputFor, normalizeEnhancedText, resolveFormat, resolveLevel, resolveMode } from './prompt-core.js';

export { enhancementSystem };

export const inject = ['connection', 'llm', 'agents', 'agentDefaultModel', 'storageDomain', 'fs', 'workingDirectory'];

const PROJECT_CANDIDATES = ['AGENTS.md', 'CLAUDE.md', 'README.md', 'README.zh.md', 'package.json'];
const PER_FILE_LIMIT = 6000;
const TOTAL_LIMIT = 8000;

function resolveCwd(ctx, sessionId) {
  // `workingDirectory.get(session)` expects the Session OBJECT (it reads a
  // per-session projection), not a session id string. Resolve the live agent
  // first, then its session, and fall back to the plugin default directory.
  let agent;
  try {
    agent = sessionId === undefined ? undefined : ctx.agents?.get?.(sessionId);
  } catch {
    agent = undefined;
  }
  const wd = ctx.workingDirectory;
  try {
    if (wd && typeof wd.get === 'function') {
      const session = agent?.session;
      if (session !== undefined && session !== null) {
        const value = wd.get(session);
        if (typeof value === 'string' && value.length > 0) return value;
      }
      // No session object (e.g. a headless tool call): use the deployment default.
      if (typeof wd.defaultDirectory === 'string' && wd.defaultDirectory.length > 0) return wd.defaultDirectory;
    }
  } catch {
    // fall through to process.cwd
  }
  try {
    return typeof process !== 'undefined' && typeof process.cwd === 'function' ? process.cwd() : undefined;
  } catch {
    return undefined;
  }
}

async function loadProjectContext(ctx, sessionId, options) {
  try {
    if (options !== null && typeof options === 'object' && options.useProject === false) return '';
    const fsSvc = ctx.fs;
    if (!fsSvc || typeof fsSvc.resolve !== 'function' || typeof fsSvc.stat !== 'function' || typeof fsSvc.readText !== 'function') return '';
    const cwd = resolveCwd(ctx, sessionId);
    const signal = options?.signal;
    const parts = [];
    let total = 0;
    for (const name of PROJECT_CANDIDATES) {
      if (total >= TOTAL_LIMIT) break;
      try {
        const resolved = await fsSvc.resolve(name, { cwd, signal });
        if (!resolved) continue;
        const info = await fsSvc.stat(resolved);
        if (!info || info.type !== 'file') continue;
        if (typeof info.size === 'number' && info.size > PER_FILE_LIMIT * 8) continue;
        let content = await fsSvc.readText(resolved, signal);
        if (typeof content !== 'string' || content.trim().length === 0) continue;
        const budget = Math.min(PER_FILE_LIMIT, TOTAL_LIMIT - total);
        if (budget <= 0) break;
        if (content.length > budget) content = content.slice(0, budget);
        parts.push(`### ${name}\n${content.trim()}`);
        total += content.length;
      } catch {
        // skip this file
      }
    }
    return parts.join('\n\n');
  } catch {
    return '';
  }
}

const ROUTE_PATH = '/api/prompt-enhancer-plus/enhance';
const DEFAULT_OPTIONS = Object.freeze({
  maxInputChars: 12000,
  maxOutputTokens: 3000,
  timeoutMs: 90_000,
  systemPrompt: undefined,
});

function jsonResponse(status, value) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function errorMessage(error) {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function resolveOptions(config) {
  const value = config !== null && typeof config === 'object' ? config : {};
  return {
    maxInputChars: positiveInteger(value.maxInputChars, DEFAULT_OPTIONS.maxInputChars),
    maxOutputTokens: positiveInteger(value.maxOutputTokens, DEFAULT_OPTIONS.maxOutputTokens),
    timeoutMs: positiveInteger(value.timeoutMs, DEFAULT_OPTIONS.timeoutMs),
    systemPrompt: typeof value.systemPrompt === 'string' && value.systemPrompt.trim().length > 0
      ? value.systemPrompt.trim()
      : undefined,
  };
}

function resolveRoute(ctx, sessionId) {
  const agent = sessionId === undefined ? undefined : ctx.agents.get(sessionId);
  const selectedRoute = agent?.model?.current?.();
  if (selectedRoute?.provider && selectedRoute?.model) {
    return { provider: selectedRoute.provider, model: selectedRoute.model };
  }
  const requestRoute = agent?.session?.requestHeader?.()?.config;
  if (requestRoute?.provider && requestRoute?.model) {
    return { provider: requestRoute.provider, model: requestRoute.model };
  }
  const optionRoute = agent?.options;
  if (optionRoute?.provider && optionRoute?.model) {
    return { provider: optionRoute.provider, model: optionRoute.model };
  }
  const fallback = ctx.agentDefaultModel.currentSelection();
  if (fallback?.provider && fallback?.model) {
    return { provider: fallback.provider, model: fallback.model };
  }
  return undefined;
}

/**
 * Run one prompt-enhancement model call with metadata.
 * @param {object} ctx - Host context with agents, llm, and agentDefaultModel.
 * @param {string} text - the draft text to rewrite.
 * @param {string | undefined} sessionId - session whose logged route should be reused.
 * @param {AbortSignal} signal - caller cancellation.
 * @param {object} options - resolved plugin options.
 * @param {string} mode - prompt mode: general, system, task, or concise.
 * @param {object} [persona] - reusable enhancement persona snapshot.
 * @param {string} [format] - output format: plain or markdown.
 * @param {string} [level] - expansion level: concise, standard, or detailed (default standard).
 * @returns {Promise<{enhanced: string, mode: string, format: string, usage: object | null, elapsedMs: number, model: object, persona: object | null}>}
 */
export async function enhancePromptDetailed(ctx, text, sessionId, signal, options = DEFAULT_OPTIONS, mode = 'general', persona, format = 'plain', level = 'standard') {
  const resolvedMode = resolveMode(mode);
  const resolvedFormat = resolveFormat(format);
  const resolvedLevel = resolveLevel(level);
  const personaSnapshot = persona === undefined ? undefined : structuredClone(persona);
  const route = resolveRoute(ctx, sessionId);
  if (route === undefined) {
    throw codedError('no-route', 'No model route is available. Choose a model in the composer first.');
  }
  const startedAt = Date.now();
  const timeoutSignal = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_OPTIONS.timeoutMs);
  const callSignal = signal === undefined ? timeoutSignal : AbortSignal.any([signal, timeoutSignal]);
  const prepared = await ctx.llm.prepareCall({
    provider: route.provider,
    model: route.model,
    maxTokens: options.maxOutputTokens ?? DEFAULT_OPTIONS.maxOutputTokens,
  }, callSignal, (controls, modelInfo) => {
    const effort = modelInfo.reasoning?.efforts?.[0]?.id;
    return effort === undefined ? controls : { ...controls, reasoningEffort: effort };
  });
  const messages = [{
    role: 'user',
    content: [{ type: 'text', text: inputFor(text) }],
  }];
  const projectContext = await loadProjectContext(ctx, sessionId, options);
  const system = enhancementSystem({ ...options, format: resolvedFormat, projectContext }, resolvedMode, personaSnapshot, resolvedLevel);
  callSignal.throwIfAborted();
  let output = '';
  let blockText = '';
  let usage = null;
  let finish;
  const stream = prepared.stream({
    ...prepared.config,
    messages,
    system,
    ...(sessionId === undefined ? {} : { sessionId }),
    purpose: 'prompt-enhancer-plus',
    signal: callSignal,
  });
  for await (const chunk of stream) {
    callSignal.throwIfAborted();
    if (chunk.type === 'text-delta') {
      output += chunk.text;
    } else if (chunk.type === 'block-end' && chunk.block?.type === 'text') {
      blockText += chunk.block.text;
    } else if (chunk.type === 'usage') {
      usage = chunk.usage;
    } else if (chunk.type === 'finish') {
      finish = chunk.reason;
    }
  }
  callSignal.throwIfAborted();
  if (finish?.kind === 'max-tokens') throw codedError('output-truncated', 'The result reached the output token limit. Increase the limit or shorten the request.');
  if (finish?.kind === 'tool-calls') throw codedError('invalid-output', 'A rewritten prompt must contain text only.');
  if (finish === undefined) throw codedError('incomplete-output', 'The model stream ended without a completion status.');
  if (finish?.kind === 'error') {
    throw codedError('model-failed', finish.failure?.message ?? 'The model call failed.');
  }
  if (finish?.kind === 'aborted') {
    throw codedError('aborted', 'The model call was cancelled.');
  }
  const enhanced = normalizeEnhancedText(output || blockText, { format: resolvedFormat, original: text });
  if (enhanced.length === 0) {
    throw codedError('empty-output', 'The model returned no text.');
  }
  return {
    enhanced,
    mode: resolvedMode,
    format: resolvedFormat,
    usage: usage ?? null,
    elapsedMs: Date.now() - startedAt,
    model: { provider: route.provider, model: route.model },
    persona: personaSnapshot ?? null,
  };
}

/**
 * Run one prompt-enhancement model call and return only the text.
 * Kept as the simple public helper used by tests and small integrations.
 * @returns {Promise<string>}
 */
export async function enhancePrompt(ctx, text, sessionId, signal, options = DEFAULT_OPTIONS, mode = 'general') {
  const result = await enhancePromptDetailed(ctx, text, sessionId, signal, options, mode);
  return result.enhanced;
}

async function handleEnhance(service, request) {
  if (request.method !== 'POST') {
    return jsonResponse(405, { error: { code: 'method', message: 'Method not allowed.' } });
  }
  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse(400, { error: { code: 'bad-json', message: 'The request body is not valid JSON.' } });
  }
  const text = typeof payload?.text === 'string' ? payload.text.trim() : '';
  if (text.length === 0) {
    return jsonResponse(400, { error: { code: 'empty-input', message: 'Enter some text to enhance first.' } });
  }
  if (text.length > service.options.maxInputChars) {
    return jsonResponse(400, {
      error: {
        code: 'too-long',
        message: `The draft is ${text.length} characters; the limit is ${service.options.maxInputChars}.`,
      },
    });
  }
  const sessionId = typeof payload?.sessionId === 'string' && payload.sessionId.length > 0
    ? payload.sessionId
    : undefined;
  const mode = resolveMode(typeof payload?.mode === 'string' ? payload.mode : 'general');
  const format = resolveFormat(payload?.format);
  const level = resolveLevel(payload?.level);
  const useProject = typeof payload?.useProject === 'boolean' ? payload.useProject : undefined;
  try {
    const result = await service.enhance({ text, sessionId, mode, format, level, useProject, personaId: payload?.personaId }, request.signal);
    return jsonResponse(200, result);
  } catch (error) {
    return jsonResponse(502, {
      error: {
        code: error?.name === 'TimeoutError' ? 'TimeoutError' : typeof error?.code === 'string' ? error.code : 'model-failed',
        message: errorMessage(error),
      },
    });
  }
}

/**
 * Install the authenticated enhancement route.
 * @param {object} ctx - Host plugin context.
 * @param {object} config - optional row config: maxInputChars, maxOutputTokens, timeoutMs, systemPrompt.
 */
export class PromptEnhancerService {
  constructor(ctx, options, library) {
    this.ctx = ctx;
    this.options = options;
    this.library = library;
  }

  async enhance(request, signal) {
    const text = typeof request.text === 'string' ? request.text.trim() : '';
    if (!text) throw codedError('empty-input', 'Enter some text to enhance first.');
    if (text.length > this.options.maxInputChars) throw codedError('too-long', 'The draft exceeds the configured character limit.');
    if (request.personaId !== undefined && request.personaId !== null && typeof request.personaId !== 'string') {
      throw codedError('invalid-persona', 'Choose a persona id.');
    }
    const persona = this.library.resolve(request.personaId);
    const options = request.useProject === undefined ? this.options : { ...this.options, useProject: request.useProject };
    return enhancePromptDetailed(this.ctx, text, request.sessionId, signal, options, request.mode, persona, request.format, request.level);
  }

  perform(request, signal) {
    return request?.action === 'enhance' ? this.enhance(request, signal) : this.library.act(request);
  }
}

export function enhancerTool(service) {
  return {
    name: 'prompt_enhancer',
    deferLoading: true,
    description: 'Enhance prompt text or manage reusable enhancement personas in this DSH profile. Does not send messages or change the composer.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'save', 'select', 'delete', 'enhance'] },
        expectedRevision: { type: 'integer', description: 'For save/select/delete, use the revision from list.' },
        id: { type: 'string', description: 'Persona id from list for select/delete.' },
        persona: {
          type: 'object',
          description: 'For save: a reusable direction, never the task or generated result. Omit id to create; include a custom id to edit.',
          properties: Object.fromEntries(['id', 'name', ...PERSONA_FIELDS].map((field) => [field, { type: 'string' }])),
          required: ['name'],
          additionalProperties: false,
        },
        select: { type: 'boolean', description: 'Save and also make this persona the profile default.' },
        text: { type: 'string', description: 'Draft to enhance; required for enhance. This calls the configured model and uses tokens.' },
        mode: { type: 'string', enum: ['general', 'system', 'task', 'concise'] },
        format: { type: 'string', enum: ['plain', 'markdown'], description: 'For enhance: plain text by default; optionally Markdown.' },
        level: { type: 'string', enum: ['concise', 'standard', 'detailed'], description: 'For enhance: expansion level. Defaults to standard.' },
        useProject: { type: 'boolean', description: 'For enhance: read project files (AGENTS.md, CLAUDE.md, README, package.json) as reference context. Defaults to true.' },
        personaId: { type: 'string', description: 'For enhance: omit to use the profile default; empty string uses no persona.' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      return service.perform({ ...args, sessionId: exec.agent?.id }, exec.signal);
    },
  };
}

export async function apply(ctx, config) {
  const options = resolveOptions(config);
  const domain = await ctx.storageDomain.open(PERSONA_DOMAIN);
  ctx.effect(() => () => domain.close(), 'prompt-enhancer-plus: persona storage');
  const service = new PromptEnhancerService(ctx, options, new PersonaLibrary(domain.global));
  const lifetime = new AbortController();
  ctx.effect(() => () => lifetime.abort(), 'prompt-enhancer-plus: pending requests');
  ctx.effect(() => ctx.connection.fetch.register({
    path: ROUTE_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: (request) => handleEnhance(service, new Request(request, {
      signal: AbortSignal.any([request.signal, lifetime.signal]),
    })),
  }), 'prompt-enhancer-plus: LLM route');
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/prompt-enhancer-plus/personas',
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    async fetch(request) {
      try {
        const action = request.method === 'GET' ? { action: 'list' } : await request.json();
        return jsonResponse(200, await service.library.act(action));
      } catch (error) {
        const code = error?.code ?? 'persona-storage-failed';
        return jsonResponse(code === 'persona-conflict' ? 409 : 400, { error: { code, message: errorMessage(error) } });
      }
    },
  }), 'prompt-enhancer-plus: persona library route');
  const tools = ctx.get('tools');
  if (tools !== undefined) ctx.effect(() => tools.register(enhancerTool(service)), 'prompt-enhancer-plus: agent operations');
}
