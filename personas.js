import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export const PERSONA_FIELDS = ['instructions', 'role', 'goal', 'style', 'constraints', 'output'];
const fieldSchema = z.string().max(4000).default('');
const personaSchema = z.object({
  id: z.string().max(100),
  name: z.string().trim().min(1).max(60),
  instructions: fieldSchema,
  role: fieldSchema,
  goal: fieldSchema,
  style: fieldSchema,
  constraints: fieldSchema,
  output: fieldSchema,
});
const stateSchema = z.object({
  revision: z.number().int().nonnegative(),
  selectedId: z.string().max(100),
  personas: z.array(personaSchema).max(50),
});
export const PERSONA_DOMAIN = {
  name: 'prompt_enhancer_plus_personas',
  version: 1,
  global: {
    schema: stateSchema,
    initial: { revision: 0, selectedId: 'builtin:balanced', personas: [] },
  },
  tables: {},
};

export const BUILTIN_PERSONAS = [
  {
    id: 'builtin:balanced',
    name: { en: 'Balanced', zh: '通用助手' },
    instructions: 'Clarify the request proportionally. Preserve its scope and ask for missing facts rather than inventing them.',
    role: 'An experienced prompt editor', goal: '', style: '', constraints: '', output: '',
  },
  {
    id: 'builtin:product',
    name: { en: 'Product manager', zh: '产品经理' },
    instructions: '',
    role: 'A pragmatic product manager',
    goal: 'Turn vague needs into actionable requirements tied to user problems.',
    style: 'Clear, concise and prioritized.',
    constraints: 'Do not invent user research, business numbers or extra features. Mark unknown facts as questions or assumptions.',
    output: 'Goal, target users, core scenarios, requirements, scope boundaries and testable acceptance criteria, only where relevant.',
  },
  {
    id: 'builtin:engineering',
    name: { en: 'Engineering reviewer', zh: '工程审查' },
    instructions: '',
    role: 'A careful senior software engineer and code reviewer',
    goal: 'Make coding requests specific, verifiable and compatible with the existing project.',
    style: 'Direct instructions and observable checks.',
    constraints: 'Preserve the requested stack. Do not assume access to code or invent vulnerabilities. Avoid unrelated refactors.',
    output: 'Expected behavior, implementation boundaries, failure cases, tests and compatibility checks, where applicable.',
  },
  {
    id: 'builtin:writing',
    name: { en: 'Writing coach', zh: '写作教练' },
    instructions: '',
    role: 'An attentive writing coach',
    goal: 'Clarify audience, intent, structure and tone in writing requests.',
    style: 'Natural wording that preserves the author’s voice.',
    constraints: 'Do not fabricate sources, quotes or facts. Keep terminology and the original language.',
    output: 'An actionable writing brief covering audience, key message, tone, structure and length only when provided or clearly labeled as a suggestion.',
  },
  {
    id: 'builtin:minimal',
    name: { en: 'Minimalist', zh: '极简编辑' },
    instructions: 'Make the smallest useful clarification. Preserve concrete facts and constraints, remove repetition, and avoid new headings unless necessary.',
    role: 'A concise editor', goal: '', style: 'Brief and actionable, not padded.', constraints: '', output: '',
  },
];

export function personaError(code, message) {
  return Object.assign(new Error(message), { code });
}

export function normalizePersona(candidate) {
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw personaError('invalid-persona', 'Provide a persona name and reusable enhancement instructions.');
  }
  const parsed = personaSchema.safeParse({
    ...candidate,
    id: typeof candidate.id === 'string' ? candidate.id : '',
  });
  if (!parsed.success) throw personaError('invalid-persona', 'Use a name of 1–60 characters and at most 4000 characters per direction field.');
  const persona = parsed.data;
  for (const field of PERSONA_FIELDS) persona[field] = persona[field].trim();
  if (!PERSONA_FIELDS.some((field) => persona[field].length > 0)) {
    throw personaError('invalid-persona', 'At least one enhancement direction is required.');
  }
  if (PERSONA_FIELDS.reduce((total, field) => total + persona[field].length, 0) > 10000) {
    throw personaError('invalid-persona', 'The combined enhancement directions exceed 10000 characters.');
  }
  return persona;
}

export function personaDirection(persona) {
  if (persona === undefined || persona === null) return '';
  return PERSONA_FIELDS.filter((field) => persona[field]).map((field) => `${field}: ${persona[field]}`).join('\n');
}

export function personaLabel(persona, locale = 'en') {
  if (typeof persona.name === 'string') return persona.name;
  return persona.name[locale.startsWith('zh') ? 'zh' : 'en'];
}

export class PersonaLibrary {
  constructor(global) {
    this.global = global;
    this.pending = Promise.resolve();
  }

  list() {
    const state = this.global.get();
    return structuredClone({
      ...state,
      personas: [
        ...BUILTIN_PERSONAS.map((persona) => ({ ...persona, builtin: true })),
        ...state.personas.map((persona) => ({ ...persona, builtin: false })),
      ],
    });
  }

  resolve(id) {
    if (id === null || id === '') return undefined;
    const selected = id === undefined ? this.global.get().selectedId : id;
    const persona = this.list().personas.find((item) => item.id === selected);
    if (persona === undefined) throw personaError('persona-not-found', 'The persona no longer exists. Refresh the library and choose again.');
    return persona;
  }

  async act(request) {
    if (request?.action === 'list') return this.list();
    const operation = this.pending.then(async () => {
      const current = this.global.get();
      if (request?.expectedRevision !== current.revision) {
        throw personaError('persona-conflict', 'The library changed elsewhere. Reload it before saving.');
      }
      let next = structuredClone(current);
      if (request.action === 'save') {
        const persona = normalizePersona(request.persona);
        if (persona.id.startsWith('builtin:')) throw personaError('builtin-read-only', 'Duplicate a preset to customize it.');
        if (persona.id && !next.personas.some((item) => item.id === persona.id)) {
          throw personaError('persona-not-found', 'The persona no longer exists.');
        }
        if (!persona.id && next.personas.length >= 50) throw personaError('persona-limit', 'The library supports at most 50 custom personas.');
        if (next.personas.some((item) => item.id !== persona.id && item.name.toLocaleLowerCase() === persona.name.toLocaleLowerCase())) {
          throw personaError('persona-name-taken', 'Choose a distinct name for this persona.');
        }
        persona.id ||= `custom:${randomUUID()}`;
        const index = next.personas.findIndex((item) => item.id === persona.id);
        if (index < 0) next.personas.push(persona);
        else next.personas[index] = persona;
        if (request.select === true) next.selectedId = persona.id;
      } else if (request.action === 'select') {
        this.resolve(request.id);
        if (typeof request.id !== 'string' || !request.id) throw personaError('invalid-persona', 'Choose a persona id.');
        next.selectedId = request.id;
      } else if (request.action === 'delete') {
        if (typeof request.id !== 'string') throw personaError('invalid-persona', 'Choose a persona id.');
        if (request.id.startsWith('builtin:')) throw personaError('builtin-read-only', 'Built-in personas cannot be deleted.');
        if (!next.personas.some((item) => item.id === request.id)) throw personaError('persona-not-found', 'The persona no longer exists.');
        next.personas = next.personas.filter((item) => item.id !== request.id);
        if (next.selectedId === request.id) next.selectedId = 'builtin:balanced';
      } else {
        throw personaError('invalid-action', 'Use list, save, select or delete.');
      }
      next.revision += 1;
      await this.global.set(next);
      return this.list();
    });
    this.pending = operation.catch(() => {});
    return operation;
  }
}
