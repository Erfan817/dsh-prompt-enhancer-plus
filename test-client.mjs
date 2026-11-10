import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

let definition;
let helpers;
let fetchImpl;
let skillsFetchImpl = async () => ({ ok: true, json: async () => ({ status: 'ready', skills: [], matchedNames: [] }) });
const source = fs.readFileSync(new URL('./client.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const instrumented = source.replace("    return {\n      inject: ['slots', 'locale'],", "    capture({ createStore, createPersonaStore, requestEnhance, createOverlayBridge, createSessionController, normalizeFormat, normalizeSkillContext, PersonaRail, SkillReferences, personaName, localizedError, STYLES, EN, ZH });\n    return {\n      inject: ['slots', 'locale'],");
assert.notEqual(source, instrumented);
const memory = new Map();
const sandbox = {
  capture(value) { helpers = value; },
  window: {
    __ModuleLoader__: { load(value) { definition = value; } },
    localStorage: { getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) },
  },
  fetch: (...args) => args[0].endsWith('/skills') ? skillsFetchImpl(...args) : fetchImpl(...args),
  Date, JSON, console, AbortController, Error,
};
vm.runInNewContext(instrumented, sandbox);
const plugin = definition.factory((name) => {
  assert.equal(name, 'react');
  return {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect() {},
  };
});
assert.equal(definition.id, 'dsh-prompt-enhancer-plus');
const registrations = [];
const disposers = [];
const dictionaries = [];
plugin.apply({
  effect(callback) { const dispose = callback(); disposers.push(dispose); return dispose; },
  locale: {
    register(namespace, dicts) { dictionaries.push({ namespace, dicts }); return () => {}; },
    bind() { return (key) => key; },
  },
  slots: {
    inject(_slot, register) { return register(); },
    register(options, component) { registrations.push({ options, component }); return () => {}; },
  },
});
assert.equal(registrations.length, 3);
assert.ok(registrations.some(({ options }) => options.id === 'prompt-enhancer-plus-session-bridge'));
assert.ok(registrations.some(({ options }) => options.name === 'conversation.input.left'));
assert.ok(registrations.some(({ options }) => options.name === 'conversation.input.overlay'));
assert.ok(registrations.some(({ options }) => options.name === 'shell.overlay'));
assert.ok(!source.includes('dangerouslySetInnerHTML'));
assert.ok(!source.includes('document.body'));
assert.ok(!source.includes('rows: 6'));
assert.equal((helpers.STYLES.match(/overflow:auto/gu) ?? []).length, 1);
assert.ok(helpers.STYLES.includes('font:inherit'));
const sparkleSource = source.slice(source.indexOf('    function SparkleIcon()'), source.indexOf('    function formatUsage('));
assert.equal((sparkleSource.match(/h\('path'/gu) ?? []).length, 1);
assert.ok(sparkleSource.includes("fill: 'none'"));
assert.ok(sparkleSource.includes('M12 2.5C13.2 8.4 15.6 10.8 21.5 12'));
assert.ok(helpers.STYLES.includes('.pe-icon{color:var(--dsw-alias-brand-primary);}'));
assert.deepEqual(Object.keys(helpers.EN).sort(), Object.keys(helpers.ZH).sort());
assert.equal(dictionaries[0].namespace, 'promptEnhancerPlus');

const response = (value, status = 200) => ({ ok: status >= 200 && status < 300, json: async () => value });
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));
const params = (extra = {}) => ({ text: 'TASK_SECRET', originalDraft: 'TASK_SECRET', sessionId: 'one', mode: 'general', t: (key) => key, ...extra });
const persona = { id: 'custom:one', name: 'Direction', instructions: 'DIRECTION_ONLY' };

const older = deferred();
const newer = deferred();
let call = 0;
fetchImpl = () => (++call === 1 ? older.promise : newer.promise);
const requests = helpers.createStore('requests');
const first = helpers.requestEnhance(requests, params({ personaId: 'custom:old' }));
const second = helpers.requestEnhance(requests, params({ personaId: 'custom:new' }));
newer.resolve(response({ enhanced: 'Newer', persona }));
await second;
older.resolve(response({ enhanced: 'Older', persona }));
await first;
assert.equal(requests.get().enhanced, 'Newer');
assert.equal(requests.get().history.length, 1);
assert.equal(requests.get().persona.instructions, 'DIRECTION_ONLY');
assert.ok(!JSON.stringify(requests.get().persona).includes('TASK_SECRET'));

const cancelled = helpers.createStore('cancelled');
const controller = new AbortController();
const late = deferred();
fetchImpl = () => late.promise;
const cancelledCall = helpers.requestEnhance(cancelled, params({ signal: controller.signal }));
controller.abort();
late.resolve(response({ enhanced: 'Late', persona }));
await cancelledCall;
assert.equal(cancelled.get().status, 'idle');
assert.equal(cancelled.get().history.length, 0);
fetchImpl = async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); };
await helpers.requestEnhance(cancelled, params());
assert.equal(cancelled.get().status, 'idle');

fetchImpl = async () => response({ enhanced: 'Not applied', persona });
const changed = helpers.createStore('changed');
await helpers.requestEnhance(changed, params({ isCurrentDraft: () => false }));
assert.equal(changed.get().status, 'preview');
assert.equal(changed.get().error, 'changed');
assert.equal(changed.get().targetInvalidated, true);
assert.equal(changed.get().enhanced, 'Not applied');
assert.equal(changed.get().history.length, 1);

memory.set('dsh-prompt-enhancer-plus:history:legacy', JSON.stringify([{ original: 'Old private task', enhanced: 'Old result', mode: 'general' }]));
const legacy = helpers.createStore('legacy');
assert.equal(legacy.get().history.length, 1);
assert.equal(legacy.get().persona, null);
assert.equal(legacy.get().history[0].persona, undefined);
assert.equal(legacy.get().history[0].format, 'plain');
assert.equal(legacy.get().useSkills, true);
assert.equal(legacy.get().skillContext, null);
assert.equal(legacy.get().history[0].useSkills, true);
assert.equal(legacy.get().history[0].skillContext, null);
assert.equal(requests.get().format, 'plain');
assert.equal(requests.get().history[0].format, 'plain');
assert.equal(helpers.normalizeFormat('markdown'), 'markdown');
assert.equal(helpers.normalizeFormat('html'), 'plain');
assert.equal(helpers.normalizeFormat(undefined), 'plain');
for (let index = 0; index < 8; index += 1) legacy.pushHistory({ enhanced: `Result ${index}`, format: index % 2 ? 'markdown' : undefined });
assert.equal(legacy.get().history.length, 5);
assert.equal(legacy.get().history[0].enhanced, 'Result 7');
assert.equal(legacy.get().history[0].format, 'markdown');
assert.equal(legacy.get().history[1].format, 'plain');

const library = helpers.createPersonaStore();
const delayedLoad = deferred();
fetchImpl = (_url, options) => options?.method === 'POST'
  ? Promise.resolve(response({ revision: 2, selectedId: 'custom:new', personas: [persona] }))
  : delayedLoad.promise;
const loading = library.load();
await library.act({ action: 'select', id: 'custom:new' });
delayedLoad.resolve(response({ revision: 1, selectedId: 'custom:old', personas: [] }));
await loading;
assert.equal(library.get().selectedId, 'custom:new');
assert.equal(library.get().revision, 2);
fetchImpl = async () => { throw new Error('offline'); };
await library.load();
assert.equal(library.get().error, 'persona-storage-failed');
assert.equal(library.get().selectedId, 'custom:new');

let sent;
fetchImpl = async (_url, options) => {
  if (options?.method === 'POST') {
    sent = JSON.parse(options.body);
    return response({ error: { code: 'persona-conflict' } }, 409);
  }
  return response({ revision: 3, selectedId: 'builtin:balanced', personas: [] });
};
await assert.rejects(library.act({ action: 'save', expectedRevision: 0, persona }), { code: 'persona-conflict' });
assert.equal(sent.expectedRevision, 0);
assert.equal(library.get().revision, 3);
const bridge = helpers.createOverlayBridge();
const firstConnection = bridge.connect('one', { label: 'first' }, {});
assert.equal(bridge.open('missing'), false);
assert.equal(bridge.open('one'), true);
assert.equal(bridge.get().activeSessionId, 'one');
const replacement = bridge.connect('one', { label: 'replacement' }, {});
firstConnection.publish({ label: 'obsolete' });
firstConnection.disconnect();
assert.equal(bridge.get().sessions.one.snapshot.label, 'replacement');
const secondConnection = bridge.connect('two', { label: 'second' }, {});
bridge.open('two');
replacement.disconnect();
assert.equal(bridge.get().activeSessionId, 'two');
assert.equal(bridge.get().sessions.two.snapshot.label, 'second');
secondConnection.disconnect();
assert.equal(bridge.get().activeSessionId, null);
bridge.dispose();
assert.equal(bridge.open('one'), false);

const fixtures = [];
const makeSession = (sessionId, initialDraft = 'Original task') => {
  const store = helpers.createStore(sessionId);
  const sessionBridge = helpers.createOverlayBridge();
  const listeners = new Set();
  const catalog = { ready: true, selectedId: persona.id, personas: [persona] };
  const sessionLibrary = {
    get: () => catalog,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    load: async () => {},
  };
  let liveDraft = initialDraft;
  let phase = 'plain';
  let revision = 0;
  let timerId = 0;
  const timers = new Map();
  const writes = [];
  const captures = [];
  const inputActions = {
    captureInsertion() {
      const span = { opaqueRevision: revision, owner: sessionId, extra: { retained: true }, start: 2, end: 2 };
      captures.push(span);
      return span;
    },
    insertText(text, span) {
      if (phase !== 'plain' || span.owner !== sessionId || span.opaqueRevision !== revision) return false;
      writes.push({ text, span });
      liveDraft = text;
      revision += 1;
      return true;
    },
  };
  const controller = helpers.createSessionController({
    sessionId, store, library: sessionLibrary, bridge: sessionBridge, t: (key) => key,
    input: { draft: liveDraft, phase, inputActions },
    setTimer(callback, delay) { timerId += 1; timers.set(timerId, { callback, delay }); return timerId; },
    clearTimer(timer) { timers.delete(timer); },
  });
  const fixture = {
    store, bridge: sessionBridge, controller, writes, captures, timers, catalog,
    snapshot: () => sessionBridge.get().sessions[sessionId]?.snapshot,
    draft: () => liveDraft,
    sync() { controller.updateInput({ draft: liveDraft, phase, inputActions }); },
    changeDraft(text) { liveDraft = text; revision += 1; fixture.sync(); },
    setPhase(nextPhase) { phase = nextPhase; fixture.sync(); },
    advanceRevision() { revision += 1; },
    dispose() { controller.dispose(); sessionBridge.dispose(); },
  };
  fixtures.push(fixture);
  return fixture;
};

const skillContext = {
  status: 'partial', skills: [{ name: 'review', description: 'Review guidance', source: 'project', truncated: true, body: 'SKILL_BODY_SECRET' }],
  warnings: ['Some references unavailable'], body: 'CONTEXT_BODY_SECRET',
};
const skillsSession = makeSession('skills');
const rail = helpers.PersonaRail({ snapshot: skillsSession.snapshot(), actions: skillsSession.controller.actions,
  library: { get: () => ({ ready: true, personas: [], selectedId: '' }), subscribe: () => () => {} }, t: key => key });
const skillToggle = rail.children[0].children[0];
assert.equal(skillToggle.type, 'input');
assert.equal(skillToggle.props.checked, true);
skillToggle.props.onChange({ target: { checked: false } });
assert.equal(skillsSession.store.get().useSkills, false, 'sidebar toggle is available before first enhancement');
assert.equal(skillsSession.store.get().useProject, true, 'Skill and project switches are independent');
let skillBody;
fetchImpl = async (_url, options) => { skillBody = JSON.parse(options.body); return response({ enhanced: 'Skill result', skillContext }); };
await skillsSession.controller.actions.start();
assert.equal(skillBody.useSkills, false);
assert.equal(skillBody.useProject, true);
assert.equal(skillsSession.store.get().skillContext.status, 'disabled');
await skillsSession.controller.actions.rerun({ useSkills: true, useProject: false });
assert.equal(skillBody.useSkills, true);
assert.equal(skillBody.useProject, false);
assert.equal(skillsSession.store.get().skillContext.status, 'partial');
assert.equal(skillsSession.store.get().skillContext.skills[0].truncated, true);
assert.ok(!JSON.stringify(skillsSession.store.get().skillContext).includes('BODY_SECRET'));
assert.ok(!memory.get('dsh-prompt-enhancer-plus:history:skills').includes('BODY_SECRET'));
const skillHistory = helpers.createStore('skills').get().history;
const savedSkills = skillHistory[0];
assert.equal(savedSkills.useSkills, true);
skillsSession.controller.actions.openHistory(skillHistory[1]);
assert.equal(skillsSession.store.get().useSkills, false, 'disabled choice survives history persistence and opening');
assert.equal(skillsSession.store.get().skillContext.status, 'disabled');
skillsSession.controller.actions.setUseSkills(false);
skillsSession.controller.actions.openHistory(savedSkills);
assert.equal(skillsSession.store.get().useSkills, true);
assert.equal(skillsSession.store.get().useProject, false);
assert.equal(skillsSession.store.get().skillContext.skills[0].name, 'review');
await skillsSession.controller.actions.rerun({ format: 'markdown' });
assert.equal(skillBody.useSkills, true, 'reruns retain restored choice');
for (const status of ['matched', 'none', 'disabled', 'unavailable', 'partial']) {
  const normalized = helpers.normalizeSkillContext({ status, skills: [], warnings: ['Warning', 12] });
  const rendered = helpers.SkillReferences({ context: normalized, t: key => helpers.EN[key] });
  assert.ok(JSON.stringify(rendered).includes(helpers.EN[`skill${status}`]));
  assert.ok(helpers.ZH[`skill${status}`]);
  assert.equal(normalized.warnings.length, 1);
}
assert.equal(helpers.normalizeSkillContext({ status: 'invented', skills: [] }), null);
const pendingSkills = deferred();
fetchImpl = () => pendingSkills.promise;
const skillRerun = skillsSession.controller.actions.rerun({});
assert.equal(skillsSession.store.get().skillContext, null, 'new request immediately clears old reference metadata');
pendingSkills.resolve(response({ enhanced: 'No metadata' }));
await skillRerun;
assert.equal(skillsSession.store.get().skillContext, null, 'missing Host metadata does not claim Skill usage');
skillsSession.controller.actions.openHistory({ original: 'legacy', enhanced: 'Legacy result' });
assert.equal(skillsSession.store.get().useSkills, true);
assert.equal(skillsSession.store.get().skillContext, null);

let directSkillBody;
fetchImpl = async (_url, options) => { directSkillBody = JSON.parse(options.body); return response({ enhanced: 'Direct' }); };
await helpers.requestEnhance(helpers.createStore('direct-skills'), params());
assert.equal(directSkillBody.useSkills, true, 'requestEnhance defaults to enabled');
assert.equal(directSkillBody.skillNames, null, 'omitted selection defaults to auto');
assert.equal(legacy.get().history[0].skillNames, null);
await helpers.requestEnhance(helpers.createStore('direct-skills-off'), params({ useSkills: false }));
assert.equal(directSkillBody.useSkills, false);

let catalogCalls = 0;
let catalogBody;
skillsFetchImpl = async (_url, options) => {
  catalogCalls++; catalogBody = JSON.parse(options.body);
  return response({ status: 'partial', skills: [{ name: 'one', description: 'First Skill', source: 'Claude 用户', path: 'D:/skills/one/SKILL.md', body: 'PRIVATE_SKILL' }, { name: 'two', description: 'Second Skill' }], matchedNames: ['one'],
    diagnostics: [...['missing', 'ok', 'error', 'limited'].map((status, index) => ({ source: 'Claude 用户', path: `D:/scan/${status}`, status, count: index, body: 'PRIVATE_DIAGNOSTIC' })), { status: 'invented' }, null] });
};
const selection = makeSession('selection');
selection.controller.actions.open();
await tick();
assert.equal(catalogCalls, 1);
assert.equal(catalogBody.sessionId, 'selection');
assert.equal(selection.store.get().skillCatalog.skills[0].description, 'First Skill');
assert.ok(!JSON.stringify(selection.store.get().skillCatalog).includes('PRIVATE_SKILL'));
selection.controller.actions.open();
selection.changeDraft('New input');
assert.equal(catalogCalls, 1, 'opening again and editing do not automatically reload metadata');
await selection.controller.actions.refreshSkills();
assert.equal(catalogCalls, 2);
const manualRail = helpers.PersonaRail({ snapshot: selection.snapshot(), actions: selection.controller.actions,
  library: { get: () => ({ ready: true, personas: [], selectedId: '' }), subscribe: () => () => {} }, t: key => key });
assert.ok(JSON.stringify(manualRail).includes('First Skill'));
assert.ok(JSON.stringify(manualRail).includes('D:/skills/one/SKILL.md'));
assert.ok(JSON.stringify(manualRail).includes('skillScanLocations'));
assert.equal(selection.store.get().skillCatalog.diagnostics.length, 4);
assert.ok(!JSON.stringify(selection.store.get().skillCatalog).includes('PRIVATE_DIAGNOSTIC'));
for (const status of ['missing', 'ok', 'error', 'limited']) {
  assert.ok(JSON.stringify(manualRail).includes(`skillScan${status}`));
  assert.ok(helpers.EN[`skillScan${status}`]);
  assert.ok(helpers.ZH[`skillScan${status}`]);
}
assert.equal(selection.store.get().skillCatalog.diagnostics[2].count, 2);
assert.equal(selection.store.get().skillCatalog.skills[0].path, 'D:/skills/one/SKILL.md');
const pathContext = helpers.normalizeSkillContext({ status: 'matched', skills: [{ name: 'one', path: 'D:/skills/one/SKILL.md', body: 'PRIVATE_BODY' }] });
assert.ok(JSON.stringify(helpers.SkillReferences({ context: pathContext, t: key => key })).includes('D:/skills/one/SKILL.md'));
assert.ok(!JSON.stringify(pathContext).includes('PRIVATE_BODY'));
assert.equal(skillsSession.store.get().skillCatalog.diagnostics.length, 0, 'old Host payload without diagnostics remains supported');
const picker = manualRail.children[2];
assert.equal(picker.type, 'details');
picker.children[1].props.onChange({ target: { value: 'manual' } });
assert.equal(selection.store.get().skillNames.length, 0);
selection.controller.actions.setSkillNames(['one', 'two', 'three', 'four', 'one']);
assert.equal(selection.store.get().skillNames.join(','), 'one,two,three');
let selectionBody;
fetchImpl = async (_url, options) => { selectionBody = JSON.parse(options.body); return response({ enhanced: 'Preview one', baselineId: 'preview-baseline' }); };
await selection.controller.actions.start();
assert.equal(selectionBody.skillNames.join(','), 'one,two,three');
const selectedHistory = helpers.createStore('selection').get().history[0];
selection.controller.actions.setSkillNames(null);
selection.controller.actions.openHistory(selectedHistory);
assert.equal(selection.store.get().skillNames.join(','), 'one,two,three');
selection.controller.actions.setSkillNames([]);
selection.catalog.selectedId = 'custom:changed-persona';
await selection.controller.actions.enhancePreview();
assert.equal(selectionBody.personaId, 'custom:changed-persona', 'preview uses the current sidebar persona');
assert.equal(selectionBody.text, 'Preview one', 'unchanged preview is input, not the original composer draft');
assert.equal(selectionBody.skillNames.length, 0, 'manual empty selection is distinct from auto');
selection.controller.actions.setSkillNames(null);
selection.controller.actions.editPreview('Preview edited for another pass');
selection.changeDraft('Different composer text');
selection.setPhase('sending');
assert.equal(selection.snapshot().canRerun, true);
assert.equal(selection.snapshot().canApply, false);
const previewPending = deferred();
fetchImpl = async (url, options) => {
  assert.ok(url.endsWith('/enhance'), 'preview rerun never enters preference learning');
  selectionBody = JSON.parse(options.body);
  return previewPending.promise;
};
const previewRequest = selection.controller.actions.enhancePreview();
assert.equal(selectionBody.text, 'Preview edited for another pass');
assert.equal(selectionBody.skillNames, null);
assert.equal(selection.store.get().enhanced, 'Preview edited for another pass', 'pending request preserves editor');
selection.controller.actions.editPreview('Ignored while busy');
assert.equal(selection.store.get().enhanced, 'Preview edited for another pass');
previewPending.resolve(response({ enhanced: 'Preview second pass', skillContext: { status: 'matched', skills: [{ name: 'one' }] } }));
await previewRequest;
assert.equal(selection.store.get().enhanced, 'Preview second pass');
assert.equal(selection.snapshot().canApply, false);
assert.equal(selection.controller.actions.replace(), false);
fetchImpl = async () => { throw new Error('Preview failure'); };
await selection.controller.actions.enhancePreview();
assert.equal(selection.store.get().enhanced, 'Preview second pass');
assert.equal(selection.store.get().status, 'preview');
assert.equal(selection.store.get().error, 'Preview failure');
assert.equal(selection.store.get().skillContext.skills[0].name, 'one', 'failure restores reference metadata of retained result');
const cancelPreview = deferred();
fetchImpl = () => cancelPreview.promise;
const cancelPreviewRequest = selection.controller.actions.enhancePreview();
selection.controller.actions.cancel();
assert.equal(selection.bridge.get().activeSessionId, 'selection', 'cancel does not close workspace');
assert.equal(selection.store.get().skillContext.skills[0].name, 'one', 'cancel restores retained result metadata');
assert.equal(selection.store.get().enhanced, 'Preview second pass');
cancelPreview.resolve(response({ enhanced: 'Ignored cancelled result' }));
await cancelPreviewRequest;
assert.equal(selection.store.get().enhanced, 'Preview second pass');
selection.setPhase('plain');
assert.equal(selection.snapshot().canApply, false, 'preview-only rerun never reauthorizes replacing changed composer');

let enhanceBody;
fetchImpl = async (_url, options) => {
  enhanceBody = JSON.parse(options.body);
  return response({ enhanced: 'Generated result', persona });
};
const editable = makeSession('editable');
assert.equal(editable.snapshot().canStart, true);
await editable.controller.actions.start();
assert.equal(enhanceBody.format, 'plain');
assert.equal(enhanceBody.sessionId, 'editable');
assert.equal(enhanceBody.personaId, persona.id);
assert.equal(editable.bridge.get().activeSessionId, 'editable');
assert.equal(editable.snapshot().canApply, true);
const capturedTarget = editable.captures[0];
editable.controller.actions.editPreview('<script>text only</script>\nEdited result');
assert.equal(editable.store.get().enhanced, '<script>text only</script>\nEdited result');
assert.equal(editable.store.get().history[0].enhanced, 'Generated result');
assert.equal(editable.controller.actions.replace(), true);
assert.equal(editable.writes[0].text, '<script>text only</script>\nEdited result');
assert.equal(editable.writes[0].span.opaqueRevision, capturedTarget.opaqueRevision);
assert.equal(editable.writes[0].span.extra, capturedTarget.extra);
assert.equal(editable.writes[0].span.start, 0);
assert.equal(editable.writes[0].span.end, 'Original task'.length);
assert.equal(editable.bridge.get().activeSessionId, null);
editable.sync();
assert.equal(editable.snapshot().canUndo, true);
assert.equal(editable.timers.size, 1);
assert.ok([...editable.timers.values()][0].delay > 9800);
assert.ok([...editable.timers.values()][0].delay <= 10000);
assert.equal(editable.controller.actions.undo(), true);
assert.equal(editable.draft(), 'Original task');
assert.equal(editable.store.get().undo, null);
assert.equal(editable.timers.size, 0);

const formats = makeSession('formats', 'Original source, not edited preview');
await formats.controller.actions.start();
formats.controller.actions.editPreview('Local preview edits');
await formats.controller.actions.rerun({ format: 'markdown' });
assert.equal(enhanceBody.text, 'Local preview edits');
assert.equal(enhanceBody.format, 'markdown');
assert.equal(formats.store.get().format, 'markdown');
assert.equal(formats.store.get().history[0].format, 'markdown');
assert.equal(formats.store.get().history[1].format, 'plain');
await formats.controller.actions.rerun({ mode: 'concise' });
assert.equal(enhanceBody.mode, 'concise');
assert.equal(enhanceBody.format, 'markdown');
assert.equal(formats.store.get().mode, 'concise');
formats.controller.actions.editPreview('');
assert.equal(formats.store.get().generated, 'Generated result');
assert.equal(formats.snapshot().canApply, false);
formats.controller.actions.editPreview('Restored edits');
assert.equal(formats.snapshot().canApply, true);
formats.controller.actions.openHistory({ original: 'Old task', enhanced: 'Legacy result', mode: 'general' });
assert.equal(formats.store.get().format, 'plain');
assert.equal(formats.store.get().targetDraft, 'Original source, not edited preview');

const changedBack = makeSession('changed-back');
await changedBack.controller.actions.start();
changedBack.changeDraft('Another task');
changedBack.changeDraft('Original task');
assert.equal(changedBack.snapshot().canApply, false);
assert.equal(changedBack.snapshot().canRerun, true);
assert.equal(changedBack.controller.actions.replace(), false);
assert.equal(changedBack.writes.length, 0);
assert.equal(changedBack.store.get().enhanced, 'Generated result');

const finalRevision = makeSession('final-revision');
await finalRevision.controller.actions.start();
finalRevision.advanceRevision();
assert.equal(finalRevision.snapshot().canApply, true);
assert.equal(finalRevision.controller.actions.replace(), false);
assert.equal(finalRevision.snapshot().canApply, false);
assert.equal(finalRevision.store.get().error, 'previewChanged');
assert.equal(finalRevision.store.get().enhanced, 'Generated result');
assert.equal(finalRevision.writes.length, 0);

const sending = makeSession('sending');
const duringSend = deferred();
fetchImpl = () => duringSend.promise;
const sendPending = sending.controller.actions.start();
sending.setPhase('sending');
assert.equal(sending.snapshot().canStart, false);
duringSend.resolve(response({ enhanced: 'Retained stale result', persona, format: 'markdown' }));
await sendPending;
assert.equal(sending.store.get().status, 'preview');
assert.equal(sending.store.get().enhanced, 'Retained stale result');
assert.equal(sending.store.get().format, 'markdown');
assert.equal(sending.snapshot().canApply, false);
assert.equal(sending.controller.actions.replace(), false);
sending.controller.actions.editPreview('Still editable while sending');
assert.equal(sending.store.get().enhanced, 'Still editable while sending');
sending.setPhase('plain');
assert.equal(sending.snapshot().canApply, false);
assert.equal(sending.writes.length, 0);

fetchImpl = async () => response({ enhanced: 'Generated result', persona });
const expiredUndo = makeSession('expired-undo');
await expiredUndo.controller.actions.start();
expiredUndo.controller.actions.replace();
expiredUndo.sync();
assert.equal(expiredUndo.snapshot().canUndo, true);
[...expiredUndo.timers.values()][0].callback();
assert.equal(expiredUndo.store.get().undo, null);
assert.equal(expiredUndo.controller.actions.undo(), false);
assert.equal(expiredUndo.writes.length, 1);
const staleUndo = makeSession('stale-undo');
await staleUndo.controller.actions.start();
staleUndo.controller.actions.replace();
staleUndo.sync();
staleUndo.advanceRevision();
assert.equal(staleUndo.controller.actions.undo(), false);
assert.equal(staleUndo.store.get().undo, null);
assert.equal(staleUndo.store.get().error, 'undoExpired');
assert.equal(staleUndo.writes.length, 1);
const changedUndo = makeSession('changed-undo');
await changedUndo.controller.actions.start();
changedUndo.controller.actions.replace();
changedUndo.sync();
changedUndo.changeDraft('Other draft');
changedUndo.changeDraft('Generated result');
assert.equal(changedUndo.snapshot().canUndo, false);
assert.equal(changedUndo.timers.size, 0);

const closePending = makeSession('close-pending');
const closeLate = deferred();
let closeSignal;
fetchImpl = (_url, options) => { closeSignal = options.signal; return closeLate.promise; };
const closedRequest = closePending.controller.actions.start();
closePending.controller.actions.close();
assert.equal(closeSignal.aborted, true);
assert.equal(closePending.bridge.get().activeSessionId, null);
closeLate.resolve(response({ enhanced: 'Ignored closed result' }));
await closedRequest;
assert.equal(closePending.store.get().status, 'idle');
assert.equal(closePending.store.get().history.length, 0);
const disposedSession = makeSession('disposed');
const disposeLate = deferred();
let disposeSignal;
fetchImpl = (_url, options) => { disposeSignal = options.signal; return disposeLate.promise; };
const disposedRequest = disposedSession.controller.actions.start();
disposedSession.controller.dispose();
assert.equal(disposeSignal.aborted, true);
assert.equal(disposedSession.snapshot(), undefined);
disposeLate.resolve(response({ enhanced: 'Ignored disposed result' }));
await disposedRequest;
assert.equal(disposedSession.store.get().history.length, 0);
assert.equal(disposedSession.controller.actions.replace(), false);
const learnedCalls = [];
fetchImpl = async (url, options) => {
  const body = JSON.parse(options.body); learnedCalls.push(body);
  return response(url.endsWith('/enhance') ? { enhanced: 'Write a useful report with clear paragraphs.', baselineId: 'baseline' }
    : body.action === 'infer' ? { text: 'Prefer short paragraphs.', proposalId: 'proposal', revision: 0, rules: [], cwd: 'D:/project' }
      : { revision: 1, rules: [] });
};
const learning = makeSession('learning');
await learning.controller.actions.start();
learning.controller.actions.editPreview('Write a useful report with short paragraphs.');
await learning.controller.actions.start();
assert.equal(learning.store.get().learning.status, 'review');
assert.equal(learning.store.get().learning.scope, 'project');
assert.equal(learnedCalls.at(-1).action, 'infer');
assert.equal(learning.snapshot().canApply, false);
learning.controller.actions.changeLearning({ scope: 'session' });
await learning.controller.actions.confirmLearning();
assert.equal(learnedCalls.at(-2).action, 'confirm');
assert.equal(learnedCalls.at(-2).scope, 'session');
assert.equal(learnedCalls.at(-1).text, 'Write a useful report with short paragraphs.');
assert.equal(learning.store.get().learning, null);
learning.controller.actions.replace(); learning.sync();
learning.changeDraft('Write a useful report with concise paragraphs.');
await learning.controller.actions.start();
assert.equal(learnedCalls.at(-1).action, 'infer', 'composer edits retain baseline after replace');
const count = learnedCalls.length;
learning.controller.actions.close();
assert.equal(learnedCalls.length, count, 'cancel writes nothing');
learning.changeDraft(''); learning.changeDraft('An unrelated brand new task');
await learning.controller.actions.start();
assert.equal(learnedCalls.at(-1).action, undefined, 'clearing the composer drops learning baseline');
assert.equal(learning.store.get().learning, null);
learning.controller.actions.openHistory({ original: 'old', enhanced: 'Write a useful report with clear paragraphs.' });
learning.controller.actions.editPreview('Write a useful report with shorter paragraphs.');
await learning.controller.actions.start();
assert.equal(learnedCalls.at(-1).action, undefined, 'history is never a learning baseline');
const continuity = makeSession('continuity');
await continuity.controller.actions.start();
continuity.controller.actions.replace(); continuity.sync();
await continuity.controller.actions.start();
assert.equal(learnedCalls.at(-1).action, undefined, 'unchanged applied text does not infer a habit');
continuity.controller.actions.editPreview('Write a useful report with short paragraphs.');
await continuity.controller.actions.start();
continuity.controller.actions.changeLearning({ resolution: 'replace' });
continuity.controller.actions.changeLearning({ scope: 'global' });
assert.equal(continuity.store.get().learning.resolution, '', 'scope changes require a renewed conflict choice');
const frozenPreview = continuity.store.get().enhanced;
continuity.controller.actions.editPreview('Ignored during review');
assert.equal(continuity.store.get().enhanced, frozenPreview);
continuity.controller.actions.close();

for (const cancelMode of ['close', 'dispose', 'draft-change', 'send']) {
  const pendingReview = makeSession(`review-${cancelMode}`);
  fetchImpl = async () => response({ enhanced: 'Write a useful report with clear paragraphs.', baselineId: 'baseline' });
  await pendingReview.controller.actions.start();
  pendingReview.controller.actions.editPreview('Write a useful report with short paragraphs.');
  const inferenceResult = deferred();
  let inferenceSignal;
  let pendingCalls = 0;
  fetchImpl = (_url, options) => { pendingCalls++; inferenceSignal = options.signal; return inferenceResult.promise; };
  const inferencePending = pendingReview.controller.actions.start();
  if (cancelMode === 'close') pendingReview.controller.actions.close();
  else if (cancelMode === 'dispose') pendingReview.controller.dispose();
  else if (cancelMode === 'send') pendingReview.setPhase('sending');
  else pendingReview.changeDraft('Unrelated new task');
  if (['close', 'dispose'].includes(cancelMode)) assert.equal(inferenceSignal.aborted, true);
  inferenceResult.resolve(response({ text: '', revision: 0, rules: [] }));
  await inferencePending;
  assert.equal(pendingCalls, 1, 'invalidated inference never launches another model call');
  assert.equal(pendingReview.store.get().learning, null);
  assert.equal(pendingReview.writes.length, 0);
}
const preferenceRace = makeSession('preference-race');
preferenceRace.store.update({ preferenceCatalog: { revision: 1, rules: [{ id: 'old' }] } });
const stalePreferenceList = deferred();
fetchImpl = async (_url, options) => JSON.parse(options.body).action === 'list-preferences'
  ? stalePreferenceList.promise : response({ revision: 2, rules: [] });
const staleListRequest = preferenceRace.controller.actions.managePreferences();
await preferenceRace.controller.actions.managePreferences('old');
stalePreferenceList.resolve(response({ revision: 1, rules: [{ id: 'old' }] }));
await staleListRequest;
assert.equal(preferenceRace.store.get().preferenceCatalog.revision, 2);
assert.equal(preferenceRace.store.get().preferenceCatalog.rules.length, 0);
fetchImpl = async (_url, options) => JSON.parse(options.body).action === 'delete-preference'
  ? response({ error: { code: 'preference-conflict', message: 'Changed elsewhere' } }, 409)
  : response({ revision: 3, rules: [] });
await preferenceRace.controller.actions.managePreferences('old');
assert.equal(preferenceRace.store.get().preferenceCatalog.revision, 3);

for (const fixture of fixtures) fixture.dispose();
library.dispose();
for (const dispose of disposers.reverse()) if (typeof dispose === 'function') await dispose();
await tick();
console.log('Client state tests passed: slot bridge, bilingual labels, Skill reference defaults/sidebar toggle/POST/reruns/metadata-only history/statuses/reset, formats, editable text, legacy history, stale revisions, sending protection, undo, cancellation, disposal and persona conflicts. UI element structure was checked with a minimal React stub; no browser DOM rendering was performed.');
