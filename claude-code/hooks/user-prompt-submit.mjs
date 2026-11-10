#!/usr/bin/env node
/**
 * Claude Code UserPromptSubmit hook for Prompt Spark.
 *
 * Claude Code hooks can ADD context but cannot replace the user's prompt text.
 * This hook therefore appends a structured, machine-friendlier version of the
 * submitted prompt as additional context.
 *
 * Safety:
 * - Opt-in only: does nothing unless PROMPT_SPARK_HOOK=1.
 * - Never blocks the conversation: every failure exits 0 with no output.
 * - Bounded time and input size.
 */
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

const MAX_INPUT = 12000;
const TIMEOUT_MS = 20000;

function sessionPath() {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(homedir(), 'AppData', 'Roaming'), 'prompt-enhancer-plus-local', 'session.json');
  }
  if (process.platform === 'darwin') {
    return path.join(homedir(), 'Library', 'Application Support', 'prompt-enhancer-plus-local', 'session.json');
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(homedir(), '.config'), 'prompt-enhancer-plus-local', 'session.json');
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  if (process.env.PROMPT_SPARK_HOOK !== '1') return;

  let payload;
  try {
    payload = JSON.parse(await readStdin());
  } catch {
    return;
  }
  const prompt = typeof payload?.prompt === 'string' ? payload.prompt
    : typeof payload?.user_prompt === 'string' ? payload.user_prompt
      : '';
  const text = prompt.trim().slice(0, MAX_INPUT);
  if (!text) return;

  let session;
  try {
    session = JSON.parse(await readFile(sessionPath(), 'utf8'));
  } catch {
    return; // service not running: stay silent
  }
  if (typeof session?.origin !== 'string' || typeof session?.token !== 'string') return;

  let response;
  try {
    response = await fetch(`${session.origin}/api/enhance`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // The companion server requires exactly one Origin header matching the
        // session origin for every /api route.
        origin: session.origin,
        authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify({ text, level: process.env.PROMPT_SPARK_LEVEL || 'standard', mode: process.env.PROMPT_SPARK_MODE || 'general' }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return;
  }
  if (!response.ok) return;
  const body = await response.json().catch(() => null);
  const enhanced = body?.value?.enhanced;
  if (typeof enhanced !== 'string' || !enhanced.trim()) return;

  process.stdout.write([
    'Prompt Spark 已把本次请求整理成下列结构化版本，供你理解意图时参考。',
    '它以用户原文为准；如与原意冲突，以原文为准：',
    '',
    '<prompt-spark-enhanced>',
    enhanced.trim(),
    '</prompt-spark-enhanced>',
    '',
  ].join('\n'));
}

main().catch(() => {}).finally(() => process.exit(0));
