import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./client.js', import.meta.url), 'utf8');
const plain = (value) => JSON.parse(JSON.stringify(value));

/**
 * Stand-in for the client `configForms` service: one live entry form per
 * namespace, exposing the real `ConfigForm` face (snapshot/subscribe/mutate).
 */
function formFixture(initialValue, overrides = {}) {
  let snapshot = {
    status: 'ready',
    value: initialValue,
    base: undefined,
    user: undefined,
    revision: 7,
    writable: true,
    mode: 'host',
    ...overrides,
  };
  const listeners = new Set();
  const mutations = [];
  let behavior;
  const form = {
    getSnapshot() { return snapshot; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async mutate(ops, revision) {
      mutations.push({ ops: plain(ops), revision });
      if (behavior) return behavior(ops, revision);
      const value = { ...snapshot.value };
      for (const op of ops) {
        if (op.path.length === 1) value[op.path[0]] = op.value;
        else value.providers = { ...value.providers, 'openai-codex': { ...value.providers['openai-codex'], models: op.value } };
      }
      publish({ ...snapshot, revision: snapshot.revision + 1, value });
      return true;
    },
  };
  function publish(next) { snapshot = next; for (const listener of listeners) listener(); }
  return {
    form, mutations, listeners, publish,
    get snapshot() { return snapshot; },
    set behavior(next) { behavior = next; },
    get behavior() { return behavior; },
  };
}

function fixture({ proxy, model, overrides = {}, modelOverrides = {} } = {}) {
  const proxyForm = formFixture(proxy ?? { proxyEnabled: true, proxyUrl: '' }, overrides);
  const modelForm = formFixture(model ?? modelValue(), modelOverrides);
  const forms = new Map([['dsh-codex-auth', proxyForm.form], ['llm-pi-ai', modelForm.form]]);
  const registrations = new Map();
  const hooks = [];
  const cleanups = [];
  let cursor = 0;
  let current = 'dsh-codex-auth#codex-auth';
  let tree;
  let Card;
  const React = {
    createElement(type, props, ...children) { return { type, props: props || {}, children: children.flat() }; },
    useState(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = initial;
      return [hooks[index], (next) => { hooks[index] = typeof next === 'function' ? next(hooks[index]) : next; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = { current: initial };
      return hooks[index];
    },
    useEffect(effect) {
      const index = cursor++;
      if (!(index in hooks)) { hooks[index] = true; cleanups.push(effect()); }
    },
    useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot) {
      const index = cursor++;
      if (!(index in hooks)) { hooks[index] = true; cleanups.push(subscribe(render)); }
      return getSnapshot();
    },
  };
  let bundle;
  vm.runInNewContext(source, { window: { __ModuleLoader__: { load: (value) => { bundle = value; } } } });
  const plugin = bundle.factory((name) => { assert.equal(name, 'react'); return React; });
  plugin.apply({
    configForms: {
      get(id) {
        const form = forms.get(id);
        assert.ok(form, `configForms.get(${id}) must be served`);
        return form;
      },
    },
    slots: {
      inject(name, callback) { assert.equal(name, 'plugins.row.config'); cleanups.push(callback()); },
      register(spec, component) { registrations.set(spec.key, { spec: plain(spec), component }); return () => { registrations.delete(spec.key); }; },
    },
  });

  /** Resolve the element tree the way React would, so hooks run at the top level. */
  function renderNode(node) {
    if (!node || typeof node !== 'object') return node;
    if (typeof node.type === 'function') return renderNode(node.type(node.props));
    return { ...node, children: node.children.map(renderNode) };
  }
  function render(which = current) {
    current = which;
    cursor = 0;
    Card = registrations.get(which).component;
    tree = renderNode(Card({ view: 'page' }));
    return tree;
  }
  function nodes(node = tree) { return !node || typeof node !== 'object' ? [] : [node, ...node.children.flatMap((child) => nodes(child))]; }
  const find = (type, predicate = () => true) => nodes().find((node) => node.type === type && predicate(node));
  const input = (type) => find('input', (node) => node.props.type === type);
  const edit = (type, value) => { input(type).props.onChange({ target: type === 'checkbox' ? { checked: value } : { value } }); render(); };
  render();
  return {
    bundle, plugin, registrations, proxyForm, modelForm, render, find, input, edit,
    keys: () => [...registrations.keys()],
    select(which) { return render(which); },
    submit() { return find('form').props.onSubmit({ preventDefault() {} }); },
    text() { return nodes().flatMap((node) => node.children.filter((child) => typeof child === 'string')).join(' '); },
    dispose() { for (const cleanup of cleanups.reverse()) cleanup?.(); },
  };
}

const modelValue = () => ({
  providers: {
    'openai-codex': { models: [
      { id: 'gpt-6-astra-1m', contextWindow: 1000000, maxTokens: 128000, input: ['text', 'image'], reasoningEfforts: { high: 'high' } },
      { id: 'custom-model', contextWindow: 200000 },
    ] },
    other: { models: [{ id: 'other', contextWindow: 123 }] },
  },
});

test('packaged module registers both row pages through the slot lifecycle', () => {
  const f = fixture();
  assert.equal(f.bundle.id, 'dsh-codex-auth');
  assert.deepEqual(plain(f.plugin.inject), ['slots', 'configForms']);
  assert.deepEqual(f.keys().sort(), ['@deepseek-ai/dsh-llm-pi-ai#llm-pi-ai', 'dsh-codex-auth#codex-auth']);
  assert.match(f.text(), /dsh-codex-auth/);
  f.dispose();
  assert.deepEqual(f.keys(), []);
});

test('proxy card reads defaults and external snapshots reactively, without writes', () => {
  const f = fixture({ proxy: {} });
  assert.equal(f.input('checkbox').props.checked, true);
  assert.equal(f.input('text').props.value, '');
  f.proxyForm.publish({ ...f.proxyForm.snapshot, value: { proxyEnabled: false, proxyUrl: 'http://localhost:3128' } });
  f.render();
  assert.equal(f.input('checkbox').props.checked, false);
  assert.equal(f.input('text').props.value, 'http://localhost:3128');
  assert.equal(f.proxyForm.mutations.length, 0);
  f.dispose();
});

test('proxy address and switch are staged and saved atomically with the draft revision', async () => {
  const f = fixture();
  f.edit('text', 'http://127.0.0.1:7890');
  f.edit('checkbox', false);
  assert.equal(f.proxyForm.mutations.length, 0);
  await f.submit();
  f.render();
  assert.deepEqual(f.proxyForm.mutations, [{ revision: 7, ops: [
    { op: 'set', path: ['proxyEnabled'], value: false },
    { op: 'set', path: ['proxyUrl'], value: 'http://127.0.0.1:7890' },
  ] }]);
  assert.match(f.text(), /已保存/);
  assert.equal(f.find('button', (node) => node.props.type === 'submit').props.disabled, true);
  f.edit('text', '');
  await f.submit();
  assert.equal(f.proxyForm.snapshot.value.proxyUrl, '', 'empty addresses can be saved');
  f.dispose();
});

test('a refused proxy write reports failure and keeps the draft', async () => {
  const f = fixture();
  f.edit('text', 'http://stale:7890');
  f.proxyForm.behavior = async () => false;
  await f.submit();
  f.render();
  assert.match(f.text(), /保存未生效/);
  assert.equal(f.input('text').props.value, 'http://stale:7890');
  f.proxyForm.behavior = undefined;
  await f.submit();
  f.render();
  assert.match(f.text(), /已保存/);
  f.dispose();
});

test('transport failure keeps the draft and permits retry', async () => {
  const f = fixture();
  f.edit('text', 'http://retry:7890');
  f.proxyForm.behavior = async () => { throw new Error('offline'); };
  await f.submit();
  f.render();
  assert.match(f.text(), /保存失败/);
  assert.equal(f.input('text').props.value, 'http://retry:7890');
  f.proxyForm.behavior = undefined;
  await f.submit();
  f.render();
  assert.match(f.text(), /已保存/);
  f.dispose();
});

test('loading, unavailable, memory and read-only snapshots cannot save', async () => {
  for (const overrides of [{ status: 'loading' }, { status: 'unavailable' }, { writable: false }, { mode: 'memory' }]) {
    const f = fixture({ overrides });
    f.edit('text', 'http://staged:7890');
    f.proxyForm.publish({ ...f.proxyForm.snapshot, ...overrides });
    f.render();
    assert.equal(f.input('text').props.disabled, true);
    await f.submit();
    assert.equal(f.proxyForm.mutations.length, 0);
    f.dispose();
  }
});

test('pending save prevents duplicate submissions and unmount removes watchers', async () => {
  const f = fixture();
  let resolve;
  f.proxyForm.behavior = () => new Promise((done) => { resolve = done; });
  f.edit('text', 'http://pending:7890');
  const first = f.submit();
  await f.submit();
  f.render();
  assert.equal(f.proxyForm.mutations.length, 1);
  assert.equal(f.input('text').props.disabled, true);
  assert.match(f.text(), /保存中/);
  f.dispose();
  assert.equal(f.proxyForm.listeners.size, 0);
  resolve(true);
  await first;
});

test('model settings save capacities to the adapter namespace preserving other fields', async () => {
  const f = fixture();
  f.select('@deepseek-ai/dsh-llm-pi-ai#llm-pi-ai');
  assert.match(f.text(), /custom-model/);
  f.edit('number', '500000');
  await f.submit();
  f.render();
  assert.deepEqual(f.modelForm.mutations[0].ops[0].path, ['providers', 'openai-codex', 'models']);
  const expected = modelValue().providers['openai-codex'].models;
  expected[0].contextWindow = 500000;
  assert.deepEqual(plain(f.modelForm.snapshot.value.providers['openai-codex'].models), expected);
  assert.equal(f.modelForm.snapshot.value.providers.other.models[0].contextWindow, 123);
  assert.match(f.text(), /已保存/);
  f.edit('number', '');
  await f.submit();
  assert.equal('contextWindow' in f.modelForm.snapshot.value.providers['openai-codex'].models[0], false);
  f.dispose();
});

test('invalid capacities never reach settings', async () => {
  for (const value of ['0', '-1', '1.5', 'NaN', 'Infinity', '9007199254740992', '1e6']) {
    const f = fixture();
    f.select('@deepseek-ai/dsh-llm-pi-ai#llm-pi-ai');
    f.edit('number', value);
    await f.submit();
    assert.equal(f.modelForm.mutations.length, 0);
    assert.match(f.text(), /必须为正整数/);
    f.dispose();
  }
});

test('model settings reject stale drafts and support reload and transport retry', async () => {
  const f = fixture();
  f.select('@deepseek-ai/dsh-llm-pi-ai#llm-pi-ai');
  f.edit('number', '300000');
  f.modelForm.publish({ ...f.modelForm.snapshot, revision: 8, value: modelValue() });
  f.render();
  await f.submit();
  f.render();
  assert.equal(f.modelForm.mutations.length, 0);
  assert.match(f.text(), /其他页面修改/);
  f.find('button', n => n.props.type === 'button').props.onClick();
  f.render();
  assert.equal(f.input('number').props.value, '1000000');
  f.edit('number', '300000');
  f.modelForm.behavior = async () => { throw new Error('offline'); };
  await f.submit();
  f.render();
  assert.match(f.text(), /保存失败/);
  f.modelForm.behavior = async () => false;
  await f.submit();
  f.render();
  assert.match(f.text(), /其他页面修改/);
  f.modelForm.behavior = undefined;
  await f.submit();
  f.render();
  assert.match(f.text(), /已保存/);
  f.dispose();
});

test('model settings honor readonly states', async () => {
  for (const modelOverrides of [{ status: 'loading' }, { writable: false }, { mode: 'memory' }]) {
    const f = fixture({ modelOverrides });
    f.select('@deepseek-ai/dsh-llm-pi-ai#llm-pi-ai');
    f.edit('number', '123456');
    f.render();
    await f.submit();
    assert.equal(f.input('number').props.disabled, true);
    assert.equal(f.modelForm.mutations.length, 0);
    f.dispose();
  }
});
