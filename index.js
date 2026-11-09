/**
 * Host half of the prompt-enhancer-plus bundle.
 *
 * The browser button calls an authenticated exact Fetch route on `/api`.
 * That route runs one auxiliary LLM request on the current session's model
 * route and returns the rewritten prompt plus lightweight usage metadata;
 * it never enters conversation history and never changes the session log.
 */

export const inject = ['connection', 'llm', 'agents', 'agentDefaultModel'];

const ROUTE_PATH = '/api/prompt-enhancer-plus/enhance';
const DEFAULT_OPTIONS = Object.freeze({
  maxInputChars: 12000,
  maxOutputTokens: 3000,
  timeoutMs: 90_000,
  systemPrompt: undefined,
});

const LANGUAGE_RULE = "- Write the entire enhanced prompt in the same language as the user's original request. This is mandatory: Chinese input stays Chinese, English input stays English, and mixed-language input keeps its mix. Never translate or switch languages.";

const MODE_PROMPTS = {
  general: [
    'You are an expert prompt engineer working inside an AI coding assistant.',
    "Rewrite the user's short or vague request into a complete, high-quality prompt that another AI coding assistant can act on.",
    '',
    'Rules:',
    LANGUAGE_RULE,
    "- Preserve the user's original intent and every concrete fact.",
    '- Make the request clearer and more actionable by covering, where relevant: goal, context, constraints, expected output, acceptance criteria, and edge cases.',
    '- Replace vague wording with concrete requirements. If important information is missing, add a short "Assumptions" section instead of inventing hidden facts.',
    '- Keep the result proportional to the original request; do not invent extra features or requirements.',
    '- If the input is already detailed, polish it rather than padding it.',
    '- Return only the enhanced prompt text. No preamble, no explanation, no quotation marks, no Markdown code fences.',
  ],
  system: [
    'You are an expert prompt engineer who writes system instructions for AI assistants.',
    "Rewrite the user's draft as a precise, self-contained system prompt for an AI coding assistant.",
    '',
    'Rules:',
    LANGUAGE_RULE,
    '- State the role, responsibilities, constraints, and output expectations clearly.',
    '- Make the instructions directly usable as a system prompt; avoid meta commentary about the rewrite.',
    '- Preserve every concrete fact and constraint from the original draft.',
    '- Keep the result proportional to the original request; do not invent unrelated policies.',
    '- Return only the enhanced system prompt. No preamble, no quotation marks, no Markdown code fences.',
  ],
  task: [
    'You are an expert prompt engineer who turns loose ideas into complete task briefs.',
    "Rewrite the user's draft as a task brief for an AI coding assistant.",
    '',
    'Rules:',
    LANGUAGE_RULE,
    '- Cover, where relevant: goal, context, requirements, constraints, expected output, acceptance criteria, and edge cases.',
    '- Make ambiguous requirements concrete; if information is missing, add a short "Assumptions" section rather than inventing hidden facts.',
    '- Keep the result proportional to the original request; do not add unrelated features.',
    '- Return only the enhanced task brief. No preamble, no quotation marks, no Markdown code fences.',
  ],
  concise: [
    'You are an expert prompt editor.',
    "Tighten and clarify the user's draft without making it longer than necessary.",
    '',
    'Rules:',
    LANGUAGE_RULE,
    '- Remove repetition, filler, and ambiguity while keeping every concrete fact and requirement.',
    '- Prefer direct, actionable wording over explanations.',
    '- If the original is already clear, make only small improvements.',
    '- Return only the improved prompt. No preamble, no quotation marks, no Markdown code fences.',
  ],
};

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

function resolveMode(mode) {
  return Object.prototype.hasOwnProperty.call(MODE_PROMPTS, mode) ? mode : 'general';
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

function inputFor(text) {
  return `Original request from the user:\n"""\n${text}\n"""\n\nWrite the enhanced prompt now.`;
}

function stripWrapping(text) {
  let value = text.trim();
  const fence = /^```(?:[a-zA-Z0-9_-]+)?\r?\n([\s\S]*?)\r?\n```$/u.exec(value);
  if (fence !== null && typeof fence[1] === 'string') value = fence[1].trim();
  if (
    value.length >= 2
    && (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith('“') && value.endsWith('”'))
    )
  ) {
    value = value.slice(1, -1).trim();
  }
  return value;
}

/**
 * Run one prompt-enhancement model call with metadata.
 * @param {object} ctx - Host context with agents, llm, and agentDefaultModel.
 * @param {string} text - the draft text to rewrite.
 * @param {string | undefined} sessionId - session whose logged route should be reused.
 * @param {AbortSignal} signal - caller cancellation.
 * @param {object} options - resolved plugin options.
 * @param {string} mode - prompt mode: general, system, task, or concise.
 * @returns {Promise<{enhanced: string, mode: string, usage: object | null, elapsedMs: number, model: object}>}
 */
export async function enhancePromptDetailed(ctx, text, sessionId, signal, options = DEFAULT_OPTIONS, mode = 'general') {
  const resolvedMode = resolveMode(mode);
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
  const customPrompt = options.systemPrompt;
  const system = customPrompt === undefined
    ? MODE_PROMPTS[resolvedMode].join('\n')
    : `${LANGUAGE_RULE}\n\n${customPrompt}`;
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
  if (finish?.kind === 'error') {
    throw codedError('model-failed', finish.failure?.message ?? 'The model call failed.');
  }
  if (finish?.kind === 'aborted') {
    throw codedError('aborted', 'The model call was cancelled.');
  }
  const enhanced = stripWrapping(output || blockText);
  if (enhanced.length === 0) {
    throw codedError('empty-output', 'The model returned no text.');
  }
  return {
    enhanced,
    mode: resolvedMode,
    usage: usage ?? null,
    elapsedMs: Date.now() - startedAt,
    model: { provider: route.provider, model: route.model },
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

async function handleEnhance(ctx, request, options) {
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
  if (text.length > options.maxInputChars) {
    return jsonResponse(400, {
      error: {
        code: 'too-long',
        message: `The draft is ${text.length} characters; the limit is ${options.maxInputChars}.`,
      },
    });
  }
  const sessionId = typeof payload?.sessionId === 'string' && payload.sessionId.length > 0
    ? payload.sessionId
    : undefined;
  const mode = resolveMode(typeof payload?.mode === 'string' ? payload.mode : 'general');
  try {
    const result = await enhancePromptDetailed(ctx, text, sessionId, request.signal, options, mode);
    return jsonResponse(200, result);
  } catch (error) {
    return jsonResponse(502, {
      error: {
        code: typeof error?.code === 'string' ? error.code : 'model-failed',
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
export function apply(ctx, config) {
  const options = resolveOptions(config);
  ctx.effect(() => ctx.connection.fetch.register({
    path: ROUTE_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: (request) => handleEnhance(ctx, request, options),
  }), 'prompt-enhancer-plus: LLM route');
}
