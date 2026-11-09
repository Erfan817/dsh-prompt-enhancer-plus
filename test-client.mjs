import fs from 'node:fs';
import vm from 'node:vm';

let loaded;

const fakeReact = {
  createElement() {},
  useState() {},
  useEffect() {},
  useRef() {},
  useCallback() {},
  useSyncExternalStore() {},
};

const sandbox = {
  window: {
    __ModuleLoader__: {
      load(definition) {
        loaded = definition;
      },
    },
    localStorage: {
      getItem() { return null; },
      setItem() {},
    },
  },
  console,
};
vm.runInNewContext(fs.readFileSync(new URL('./client.js', import.meta.url), 'utf8'), sandbox);

if (loaded === undefined) throw new Error('client module did not register');
if (loaded.id !== 'dsh-prompt-enhancer-plus') throw new Error(`unexpected client id: ${loaded.id}`);

const plugin = loaded.factory(() => fakeReact);
const registrations = [];
const dictionaries = [];
let effects = 0;
const ctx = {
  effect(fn) {
    effects += 1;
    return fn();
  },
  locale: {
    register(namespace, dicts) {
      dictionaries.push({ namespace, dicts });
      return () => {};
    },
    bind(namespace) {
      return (key) => `${namespace}:${key}`;
    },
  },
  slots: {
    inject(slot, register) {
      register();
    },
    register(options, component) {
      registrations.push({ options, component });
      return () => {};
    },
  },
};

plugin.apply(ctx);

if (effects < 1) throw new Error('expected a locale effect');
if (dictionaries.length !== 1) throw new Error('expected one locale registration');
if (dictionaries[0].namespace !== 'promptEnhancerPlus') throw new Error('unexpected locale namespace');
if (!dictionaries[0].dicts.en || !dictionaries[0].dicts.zh) throw new Error('baseline locales missing');

const slots = registrations.map((entry) => entry.options.name);
if (!slots.includes('conversation.input.left')) throw new Error('button slot was not registered');
if (!slots.includes('conversation.input.overlay')) throw new Error('preview slot was not registered');
const button = registrations.find((entry) => entry.options.name === 'conversation.input.left');
if (button.options.id !== 'prompt-enhancer-plus') throw new Error('unexpected button id');
if (typeof button.options.label() !== 'string') throw new Error('button label must be a string');

console.log('client registration tests passed:', slots.join(', '));
