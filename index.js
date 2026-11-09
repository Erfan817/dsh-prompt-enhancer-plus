/**
 * Host half of the prompt-enhancer bundle.
 *
 * The browser button calls an authenticated exact Fetch route on `/api`.
 * That route runs one auxiliary LLM request on the current session's model
 * route and returns the rewritten prompt; it never enters conversation
 * history and never changes the session log.
 */

export const inject = ['connection', 'llm', 'agents', 'agentDefaultModel'];

const ROUTE_PATH = '/api/prompt-enhancer-plus/enhance';
const MAX_INPUT_CHARS = 12000;
const MAX_OUTPUT_TOKENS = 3000;
const TIMEOUT_MS = 90_000;

const SYSTEM_PROMPT = [
  'You are an expert prompt engineer working inside an AI coding assistant.',
  "Rewrite the user's short or vague request into a complete, high-quality prompt that another AI coding assistant can act on.",
  '',
  'Rules:',
  "- Write the entire enhanced prompt in the same language as the user's original request. This is mandatory: Chinese input stays Chinese, English input stays English, and mixed-language input keeps its mix. Never translate or switch languages.",
  "- Preserve the user's original intent and every concrete fact.",
  '- Make the request clearer and more actionable by covering, where relevant: goal, context, constraints, expected output, acceptance criteria, and edge cases.',
  '- Replace vague wording with concrete requirements. If important information is missing, add a short "Assumptions" section instead of inventing hidden facts.',
  '- Keep the result proportional to the original request; do not invent extra features or requirements.',
  '- If the input is already detailed, polish it rather than padding it.',
  '- Return only the enhanced prompt text. No preamble, no explanation, no quotation marks, no Markdown code fences.',
].join('\n');

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
 * Run one prompt-enhancement model call.
 * @param {object} ctx - Host context with agents, llm, and agentDefaultModel.
 * @param {string} text - the draft text to rewrite.
 * @param {string | undefined} sessionId - session whose logged route should be reused.
 * @param {AbortSignal} signal - caller cancellation.
 * @returns {Promise<string>} the enhanced prompt.
 */
export async function enhancePrompt(ctx, text, sessionId, signal) {
  const route = resolveRoute(ctx, sessionId);
  if (route === undefined) {
    throw codedError('no-route', 'No model route is available. Choose a model in the composer first.');
  }
  const timeoutSignal = AbortSignal.timeout(TIMEOUT_MS);
  const callSignal = signal === undefined ? timeoutSignal : AbortSignal.any([signal, timeoutSignal]);
  const prepared = await ctx.llm.prepareCall({
    provider: route.provider,
    model: route.model,
    maxTokens: MAX_OUTPUT_TOKENS,
  }, callSignal, (controls, modelInfo) => {
    const effort = modelInfo.reasoning?.efforts?.[0]?.id;
    return effort === undefined ? controls : { ...controls, reasoningEffort: effort };
  });
  const messages = [{
    role: 'user',
    content: [{ type: 'text', text: inputFor(text) }],
  }];
  let output = '';
  let blockText = '';
  let finish;
  const stream = prepared.stream({
    ...prepared.config,
    messages,
    system: SYSTEM_PROMPT,
    ...(sessionId === undefined ? {} : { sessionId }),
    purpose: 'prompt-enhancer-plus',
    signal: callSignal,
  });
  for await (const chunk of stream) {
    if (chunk.type === 'text-delta') {
      output += chunk.text;
    } else if (chunk.type === 'block-end' && chunk.block?.type === 'text') {
      blockText += chunk.block.text;
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
  return enhanced;
}

async function handleEnhance(ctx, request) {
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
  if (text.length > MAX_INPUT_CHARS) {
    return jsonResponse(400, {
      error: {
        code: 'too-long',
        message: `The draft is ${text.length} characters; the limit is ${MAX_INPUT_CHARS}.`,
      },
    });
  }
  const sessionId = typeof payload?.sessionId === 'string' && payload.sessionId.length > 0
    ? payload.sessionId
    : undefined;
  try {
    const enhanced = await enhancePrompt(ctx, text, sessionId, request.signal);
    return jsonResponse(200, { enhanced });
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
 */
export function apply(ctx) {
  ctx.effect(() => ctx.connection.fetch.register({
    path: ROUTE_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: (request) => handleEnhance(ctx, request),
  }), 'prompt-enhancer-plus: LLM route');
}
