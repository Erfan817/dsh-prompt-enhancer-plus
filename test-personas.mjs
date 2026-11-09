import assert from 'node:assert/strict';
import {
  BUILTIN_PERSONAS,
  PERSONA_DOMAIN,
  PERSONA_FIELDS,
  PersonaLibrary,
  normalizePersona,
  personaDirection,
  personaLabel,
} from './personas.js';

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function makeStorage(initial = PERSONA_DOMAIN.global.initial) {
  let durable = structuredClone(initial);
  let nextWrite;
  const attempts = [];
  const commits = [];
  const global = {
    get: () => durable,
    async set(value) {
      const candidate = structuredClone(value);
      attempts.push(candidate);
      const write = nextWrite;
      nextWrite = undefined;
      if (write !== undefined) await write(candidate);
      durable = structuredClone(candidate);
      commits.push(structuredClone(durable));
    },
  };
  return {
    global,
    attempts,
    commits,
    read: () => structuredClone(durable),
    beforeNextWrite(write) {
      assert.equal(nextWrite, undefined);
      nextWrite = write;
    },
  };
}

let passed = 0;
async function test(name, run) {
  await run();
  passed += 1;
  console.log(`ok - ${name}`);
}

await test('five localized built-ins and balanced default need no persistence', async () => {
  const storage = makeStorage();
  const library = new PersonaLibrary(storage.global);
  const state = await library.act({ action: 'list' });
  assert.equal(state.revision, 0);
  assert.equal(state.selectedId, 'builtin:balanced');
  assert.deepEqual(state.personas.map((persona) => persona.id), [
    'builtin:balanced', 'builtin:product', 'builtin:engineering', 'builtin:writing', 'builtin:minimal',
  ]);
  assert.equal(BUILTIN_PERSONAS.length, 5);
  for (const persona of state.personas) {
    assert.equal(persona.builtin, true);
    assert.equal(typeof personaLabel(persona, 'en-US'), 'string');
    assert.equal(personaLabel(persona, 'zh-CN'), persona.name.zh);
    assert.ok(personaDirection(persona).length > 0);
  }
  assert.equal(library.resolve().id, 'builtin:balanced');
  assert.equal(library.resolve('builtin:product').id, 'builtin:product');
  assert.equal(library.resolve(null), undefined);
  assert.equal(library.resolve(''), undefined);
  assert.equal(personaDirection(undefined), '');
  assert.equal(personaDirection(null), '');
  assert.equal(storage.attempts.length, 0);
  assert.match(PERSONA_DOMAIN.name, /^[a-z][a-z0-9_]*$/u);
  assert.deepEqual(PERSONA_DOMAIN.tables, {});
  assert.deepEqual(PERSONA_DOMAIN.global.schema.parse(storage.read()), storage.read());
});

await test('list and resolve return detached snapshots of built-ins and custom personas', async () => {
  const storage = makeStorage();
  const library = new PersonaLibrary(storage.global);
  const saved = await library.act({
    action: 'save', expectedRevision: 0, select: true,
    persona: { name: 'Reviewer', role: 'Check observable behavior.' },
  });
  const custom = saved.personas.find((persona) => !persona.builtin);
  saved.selectedId = 'changed';
  saved.personas[0].name.en = 'Changed built-in';
  custom.role = 'Changed returned custom';
  saved.personas.pop();
  const snapshot = library.resolve();
  snapshot.name = 'Changed resolved custom';
  snapshot.role = 'Changed resolved role';
  assert.equal(library.list().personas[0].name.en, 'Balanced');
  assert.equal(BUILTIN_PERSONAS[0].name.en, 'Balanced');
  assert.equal(library.resolve().name, 'Reviewer');
  assert.equal(library.resolve().role, 'Check observable behavior.');
  assert.equal(storage.read().personas[0].name, 'Reviewer');
});

await test('normalization trims reusable fields, defaults omissions and strips task data', async () => {
  const normalized = normalizePersona({
    name: '  My reviewer  ', instructions: '  Refine scope.  ', role: '  Careful engineer  ',
    text: 'PRIVATE_DRAFT', enhanced: 'PRIVATE_RESULT', history: ['PRIVATE_HISTORY'], builtin: true,
  });
  assert.deepEqual(Object.keys(normalized).sort(), ['id', 'name', ...PERSONA_FIELDS].sort());
  assert.equal(normalized.id, '');
  assert.equal(normalized.name, 'My reviewer');
  assert.equal(normalized.instructions, 'Refine scope.');
  assert.equal(normalized.role, 'Careful engineer');
  for (const field of ['goal', 'style', 'constraints', 'output']) assert.equal(normalized[field], '');
  assert.equal(personaLabel(normalized, 'zh-CN'), 'My reviewer');
  assert.equal(personaDirection(normalized), 'instructions: Refine scope.\nrole: Careful engineer');
  assert.doesNotMatch(JSON.stringify(normalized), /PRIVATE_/u);
});

await test('invalid names, direction types and direction limits are rejected', async () => {
  const invalid = [
    undefined, null, [], 'persona', {},
    { name: '', role: 'Editor' },
    { name: '   ', role: 'Editor' },
    { name: 'Empty directions' },
    { name: 'Whitespace directions', instructions: '  ', role: '\n' },
    { name: 'Wrong field type', role: 123 },
    { name: 'Wrong field type', output: null },
    { name: 'Long id', id: 'custom:'.padEnd(101, 'x'), role: 'Editor' },
    { name: 'x'.repeat(61), role: 'Editor' },
    { name: 'Long direction', instructions: 'x'.repeat(4001) },
    { name: 'Combined limit', instructions: 'x'.repeat(4000), role: 'x'.repeat(4000), goal: 'x'.repeat(2001) },
  ];
  for (const candidate of invalid) {
    assert.throws(() => normalizePersona(candidate), { code: 'invalid-persona' });
  }
  const boundary = normalizePersona({
    name: 'x'.repeat(60), instructions: 'x'.repeat(4000), role: 'x'.repeat(4000), goal: 'x'.repeat(2000),
  });
  assert.equal(PERSONA_FIELDS.reduce((total, field) => total + boundary[field].length, 0), 10000);
});

await test('create, edit, select and delete advance revisions and restore the default', async () => {
  const storage = makeStorage();
  const library = new PersonaLibrary(storage.global);
  const create = await library.act({
    action: 'save', expectedRevision: 0, select: true,
    persona: { name: 'First', role: 'Editor' },
  });
  const firstId = create.selectedId;
  assert.match(firstId, /^custom:[0-9a-f-]{36}$/u);
  assert.equal(create.revision, 1);
  assert.equal(library.resolve().builtin, false);
  const second = await library.act({
    action: 'save', expectedRevision: 1, persona: { name: 'Second', goal: 'Clear acceptance checks.' },
  });
  const secondId = second.personas.find((persona) => persona.name === 'Second').id;
  assert.notEqual(secondId, firstId);
  assert.equal(second.selectedId, firstId);
  const edited = await library.act({
    action: 'save', expectedRevision: 2,
    persona: { id: firstId, name: 'First edited', instructions: 'Keep the actual facts.' },
  });
  assert.equal(edited.revision, 3);
  assert.equal(edited.personas.filter((persona) => !persona.builtin).length, 2);
  assert.equal(library.resolve(firstId).name, 'First edited');
  assert.equal(library.resolve(firstId).role, '');
  assert.equal((await library.act({ action: 'select', expectedRevision: 3, id: 'builtin:product' })).selectedId, 'builtin:product');
  assert.equal((await library.act({ action: 'select', expectedRevision: 4, id: firstId })).selectedId, firstId);
  assert.equal((await library.act({ action: 'delete', expectedRevision: 5, id: secondId })).selectedId, firstId);
  const deleted = await library.act({ action: 'delete', expectedRevision: 6, id: firstId });
  assert.equal(deleted.revision, 7);
  assert.equal(deleted.selectedId, 'builtin:balanced');
  assert.equal(deleted.personas.length, 5);
  assert.throws(() => library.resolve(firstId), { code: 'persona-not-found' });
  assert.equal(storage.commits.length, 7);
});

await test('built-ins are read-only but can be copied into a distinct custom persona', async () => {
  const storage = makeStorage();
  const library = new PersonaLibrary(storage.global);
  const before = library.list();
  for (const builtin of before.personas) {
    await assert.rejects(library.act({
      action: 'save', expectedRevision: 0, persona: { ...builtin, name: 'Altered built-in' },
    }), { code: 'builtin-read-only' });
    await assert.rejects(library.act({
      action: 'delete', expectedRevision: 0, id: builtin.id,
    }), { code: 'builtin-read-only' });
  }
  assert.deepEqual(library.list(), before);
  assert.equal(storage.attempts.length, 0);
  const source = library.resolve('builtin:product');
  const copied = await library.act({
    action: 'save', expectedRevision: 0,
    persona: { ...source, id: '', name: 'My product review' },
  });
  const custom = copied.personas.find((persona) => !persona.builtin);
  assert.equal(custom.builtin, false);
  assert.notEqual(custom.id, source.id);
  for (const field of PERSONA_FIELDS) assert.equal(custom[field], source[field]);
  assert.deepEqual(library.resolve(source.id), source);
});

await test('case-insensitive duplicate names are rejected on create and edit without writing', async () => {
  const storage = makeStorage();
  const library = new PersonaLibrary(storage.global);
  await library.act({ action: 'save', expectedRevision: 0, persona: { name: 'Reviewer', role: 'Editor' } });
  const second = await library.act({ action: 'save', expectedRevision: 1, persona: { name: 'Writer', role: 'Author' } });
  const writer = second.personas.find((persona) => persona.name === 'Writer');
  for (const persona of [
    { name: '  rEvIeWeR  ', instructions: 'Other instructions' },
    { id: writer.id, name: 'REVIEWER', instructions: 'Other instructions' },
  ]) {
    await assert.rejects(library.act({ action: 'save', expectedRevision: 2, persona }), { code: 'persona-name-taken' });
  }
  assert.deepEqual(library.list(), second);
  assert.equal(storage.attempts.length, 2);
  const unchangedName = await library.act({
    action: 'save', expectedRevision: 2, persona: { id: writer.id, name: 'Writer', role: 'Revised author' },
  });
  assert.equal(unchangedName.revision, 3);
});

await test('invalid actions, missing IDs and missing or stale revisions never write', async () => {
  const storage = makeStorage();
  const library = new PersonaLibrary(storage.global);
  const invalidRequests = [
    [{ action: 'save', persona: { name: 'No revision', role: 'Editor' } }, 'persona-conflict'],
    [{ action: 'select', expectedRevision: 1, id: 'builtin:product' }, 'persona-conflict'],
    [{ action: 'select', expectedRevision: '0', id: 'builtin:product' }, 'persona-conflict'],
    [{ action: 'save', expectedRevision: 0, persona: { id: 'custom:missing', name: 'Missing', role: 'Editor' } }, 'persona-not-found'],
    [{ action: 'select', expectedRevision: 0, id: 'custom:missing' }, 'persona-not-found'],
    [{ action: 'select', expectedRevision: 0 }, 'invalid-persona'],
    [{ action: 'select', expectedRevision: 0, id: '' }, 'invalid-persona'],
    [{ action: 'select', expectedRevision: 0, id: null }, 'invalid-persona'],
    [{ action: 'delete', expectedRevision: 0, id: 'custom:missing' }, 'persona-not-found'],
    [{ action: 'delete', expectedRevision: 0 }, 'invalid-persona'],
    [{ action: 'save', expectedRevision: 0, persona: { name: 'No direction' } }, 'invalid-persona'],
    [{ action: 'duplicate', expectedRevision: 0 }, 'invalid-action'],
  ];
  for (const [request, code] of invalidRequests) await assert.rejects(library.act(request), { code });
  assert.throws(() => library.resolve('builtin:missing'), { code: 'persona-not-found' });
  assert.deepEqual(storage.read(), PERSONA_DOMAIN.global.initial);
  assert.equal(storage.attempts.length, 0);
});

await test('the fifty-persona limit rejects creates but still allows editing', async () => {
  const initial = {
    revision: 50, selectedId: 'builtin:balanced',
    personas: Array.from({ length: 50 }, (_unused, index) => normalizePersona({
      id: `custom:${index}`, name: `Persona ${index}`, role: 'Editor',
    })),
  };
  const storage = makeStorage(initial);
  const library = new PersonaLibrary(storage.global);
  await assert.rejects(library.act({
    action: 'save', expectedRevision: 50, persona: { name: 'Overflow', role: 'Editor' },
  }), { code: 'persona-limit' });
  assert.equal(storage.attempts.length, 0);
  const edited = await library.act({
    action: 'save', expectedRevision: 50, persona: { id: 'custom:0', name: 'Edited at limit', role: 'Editor' },
  });
  assert.equal(edited.revision, 51);
  assert.equal(edited.personas.length, 55);
});

await test('concurrent writes serialize and reject the losing expectedRevision', async () => {
  const storage = makeStorage();
  const library = new PersonaLibrary(storage.global);
  const entered = deferred();
  const release = deferred();
  storage.beforeNextWrite(async () => { entered.resolve(); await release.promise; });
  const first = library.act({ action: 'save', expectedRevision: 0, persona: { name: 'First', role: 'Editor' } });
  const second = library.act({ action: 'save', expectedRevision: 0, persona: { name: 'Second', role: 'Author' } });
  const resultsPromise = Promise.allSettled([first, second]);
  await entered.promise;
  assert.equal(storage.attempts.length, 1);
  assert.equal(storage.commits.length, 0);
  assert.equal(library.list().revision, 0);
  assert.equal(library.list().personas.length, 5);
  release.resolve();
  const results = await resultsPromise;
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[0].value.revision, 1);
  assert.equal(results[1].status, 'rejected');
  assert.equal(results[1].reason.code, 'persona-conflict');
  assert.equal(storage.attempts.length, 1);
  assert.deepEqual(storage.read().personas.map((persona) => persona.name), ['First']);
  const recovered = await library.act({ action: 'save', expectedRevision: 1, persona: { name: 'Second', role: 'Author' } });
  assert.equal(recovered.revision, 2);
});

await test('failed create, edit, selection and deletion leave durable state and reload intact', async () => {
  const storage = makeStorage();
  const library = new PersonaLibrary(storage.global);
  const baseline = await library.act({
    action: 'save', expectedRevision: 0, select: true, persona: { name: 'Durable persona', role: 'Editor' },
  });
  const baselineDurable = storage.read();
  const requests = [
    { action: 'save', select: true, persona: { name: 'Failed create', role: 'Author' } },
    { action: 'save', persona: { id: baseline.selectedId, name: 'Failed edit', instructions: 'Changed' } },
    { action: 'select', id: 'builtin:writing' },
    { action: 'delete', id: baseline.selectedId },
  ];
  const failure = new Error('Simulated durable storage failure');
  for (const request of requests) {
    storage.beforeNextWrite(async () => { throw failure; });
    await assert.rejects(library.act({ ...request, expectedRevision: 1 }), (error) => error === failure);
    assert.deepEqual(storage.read(), baselineDurable);
    assert.deepEqual(library.list(), baseline);
    const reopened = new PersonaLibrary(makeStorage(storage.read()).global);
    assert.deepEqual(reopened.list(), baseline);
    assert.equal(reopened.resolve().name, 'Durable persona');
  }
  assert.equal(storage.commits.length, 1);
  assert.equal(storage.attempts.length, 5);
});

await test('a queued action can commit the unchanged revision after the preceding write fails', async () => {
  const storage = makeStorage();
  const library = new PersonaLibrary(storage.global);
  const entered = deferred();
  const release = deferred();
  const failure = new Error('Disk full');
  storage.beforeNextWrite(async () => { entered.resolve(); await release.promise; throw failure; });
  const failed = library.act({
    action: 'save', expectedRevision: 0, select: true, persona: { name: 'Never committed', role: 'Editor' },
  });
  const next = library.act({
    action: 'save', expectedRevision: 0, select: true, persona: { name: 'Recovered', role: 'Author' },
  });
  const resultsPromise = Promise.allSettled([failed, next]);
  await entered.promise;
  assert.deepEqual(storage.read(), PERSONA_DOMAIN.global.initial);
  assert.equal(storage.attempts.length, 1);
  release.resolve();
  const results = await resultsPromise;
  assert.equal(results[0].status, 'rejected');
  assert.equal(results[0].reason, failure);
  assert.equal(results[1].status, 'fulfilled');
  assert.equal(results[1].value.revision, 1);
  assert.equal(storage.attempts.length, 2);
  assert.equal(storage.commits.length, 1);
  const reopened = new PersonaLibrary(makeStorage(storage.read()).global);
  assert.equal(reopened.resolve().name, 'Recovered');
  assert.deepEqual(reopened.list().personas.filter((persona) => !persona.builtin).map((persona) => persona.name), ['Recovered']);
});

await test('only reusable persona fields and selection survive reload, never task payloads', async () => {
  const storage = makeStorage();
  const library = new PersonaLibrary(storage.global);
  const candidate = { name: 'Reusable reviewer', role: 'Review the clarity of requirements.', text: 'PRIVATE_DRAFT' };
  const saved = await library.act({
    action: 'save', expectedRevision: 0, select: true, persona: candidate,
    text: 'PRIVATE_DRAFT', enhanced: 'PRIVATE_RESULT', sessionId: 'PRIVATE_SESSION', history: ['PRIVATE_HISTORY'],
  });
  candidate.name = 'Mutated caller';
  candidate.role = 'Mutated caller direction';
  const durable = storage.read();
  assert.deepEqual(Object.keys(durable).sort(), ['personas', 'revision', 'selectedId']);
  assert.deepEqual(Object.keys(durable.personas[0]).sort(), ['id', 'name', ...PERSONA_FIELDS].sort());
  assert.doesNotMatch(JSON.stringify(durable), /PRIVATE_|Mutated caller/u);
  const reopened = new PersonaLibrary(makeStorage(durable).global);
  assert.deepEqual(reopened.list(), saved);
  assert.equal(reopened.resolve().name, 'Reusable reviewer');
});

console.log(`persona tests passed (${passed} cases)`);
