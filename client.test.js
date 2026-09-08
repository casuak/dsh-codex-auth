import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./client.js', import.meta.url), 'utf8');
const plain = (value) => JSON.parse(JSON.stringify(value));

function fixture(overrides = {}) {
  let snapshot = { status: 'ready', writable: true, mode: 'host', revision: 7, value: { proxyEnabled: true, proxyUrl: '' }, ...overrides };
  const listeners = new Set();
  const mutations = [];
  const hooks = [];
  const cleanups = [];
  let cursor = 0;
  let tree;
  let Card;
  let behavior;
  let binding;
  let registration;
  let registered = false;
  let injectCallback;
  let externalStoreArgs;
  const scope = {
    getSnapshot() { assert.equal(this, scope); return snapshot; },
    subscribe(listener) { assert.equal(this, scope); listeners.add(listener); return () => listeners.delete(listener); },
    async mutate(ops, revision) {
      assert.equal(this, scope);
      mutations.push({ ops: plain(ops), revision });
      if (behavior) return behavior(ops, revision);
      const value = { ...snapshot.value };
      for (const op of ops) value[op.path[0]] = op.value;
      publish({ ...snapshot, revision: snapshot.revision + 1, value });
    },
  };
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
      externalStoreArgs = { subscribe, getSnapshot, getServerSnapshot };
      const index = cursor++;
      if (!(index in hooks)) { hooks[index] = true; cleanups.push(subscribe(render)); }
      return getSnapshot();
    },
  };
  let bundle;
  vm.runInNewContext(source, { window: { __ModuleLoader__: { load: (value) => { bundle = value; } } } });
  const plugin = bundle.factory((name) => { assert.equal(name, 'react'); return React; });
  plugin.apply({
    settingsScope: { bind(spec) { binding = plain(spec); return scope; } },
    slots: {
      inject(name, callback) { assert.equal(name, 'settings.plugin.item'); injectCallback = callback; },
      register(spec, component) { registration = plain(spec); Card = component; registered = true; return () => { registered = false; }; },
    },
  });
  assert.equal(registered, false, 'registration waits for the slot lifecycle');
  const unregister = injectCallback();
  function render() { cursor = 0; tree = Card(); return tree; }
  function publish(next) { snapshot = next; for (const listener of listeners) listener(); }
  function nodes(node = tree) { return !node || typeof node !== 'object' ? [] : [node, ...node.children.flatMap((child) => nodes(child))]; }
  const find = (type, predicate = () => true) => nodes().find((node) => node.type === type && predicate(node));
  const input = (type) => find('input', (node) => node.props.type === type);
  const edit = (type, value) => { input(type).props.onChange({ target: type === 'checkbox' ? { checked: value } : { value } }); render(); };
  render();
  return {
    bundle, plugin, binding, registration, mutations, scope, listeners, render, publish, find, input, edit,
    get snapshot() { return snapshot; },
    get externalStoreArgs() { return externalStoreArgs; },
    get registered() { return registered; },
    set behavior(next) { behavior = next; },
    submit() { return find('form').props.onSubmit({ preventDefault() {} }); },
    text() { return nodes().flatMap((node) => node.children.filter((child) => typeof child === 'string')).join(' '); },
    dispose() { for (const cleanup of cleanups) cleanup?.(); unregister(); },
  };
}

test('packaged module registers its namespace/card through the slot lifecycle', () => {
  const f = fixture();
  assert.equal(f.bundle.id, 'dsh-codex-auth');
  assert.deepEqual(plain(f.plugin.inject), ['slots', 'settingsScope']);
  assert.deepEqual(f.binding, { namespace: 'dsh-codex-auth' });
  assert.deepEqual(f.registration, { name: 'settings.plugin.item', key: 'dsh-codex-auth' });
  assert.match(f.text(), /dsh-codex-auth/);
  assert.equal(f.listeners.size, 1);
  const initial = f.externalStoreArgs;
  f.render();
  assert.equal(f.externalStoreArgs.subscribe, initial.subscribe);
  assert.equal(f.externalStoreArgs.getSnapshot, initial.getSnapshot);
  assert.equal(initial.getSnapshot(), f.snapshot);
  f.dispose();
  assert.equal(f.listeners.size, 0);
  assert.equal(f.registered, false);
});

test('defaults and external snapshots render reactively, without writes', () => {
  const f = fixture({ value: {} });
  assert.equal(f.input('checkbox').props.checked, true);
  assert.equal(f.input('text').props.value, '');
  f.publish({ ...f.snapshot, value: { proxyEnabled: false, proxyUrl: 'http://localhost:3128' } });
  assert.equal(f.input('checkbox').props.checked, false);
  assert.equal(f.input('text').props.value, 'http://localhost:3128');
  assert.equal(f.mutations.length, 0);
  f.dispose();
});

test('address and switch are staged and saved atomically with the draft revision', async () => {
  const f = fixture();
  f.edit('text', 'http://127.0.0.1:7890');
  f.edit('checkbox', false);
  assert.equal(f.mutations.length, 0);
  await f.submit();
  f.render();
  assert.deepEqual(f.mutations, [{ revision: 7, ops: [
    { op: 'set', path: ['proxyEnabled'], value: false },
    { op: 'set', path: ['proxyUrl'], value: 'http://127.0.0.1:7890' },
  ] }]);
  assert.match(f.text(), /已保存/);
  assert.equal(f.find('button', (node) => node.props.type === 'submit').props.disabled, true);
  f.edit('text', '');
  await f.submit();
  assert.equal(f.snapshot.value.proxyUrl, '', 'empty addresses can be saved');
  f.dispose();
});

test('external updates preserve a dirty draft; reload discards it', async () => {
  const f = fixture();
  f.edit('text', 'http://draft:7890');
  f.publish({ ...f.snapshot, revision: 8, value: { proxyEnabled: false, proxyUrl: 'http://external:3128' } });
  assert.equal(f.input('text').props.value, 'http://draft:7890');
  f.behavior = async () => {}; // Host rejected the stale revision and recovered.
  await f.submit();
  f.render();
  assert.equal(f.mutations[0].revision, 7);
  assert.match(f.text(), /保存未生效/);
  assert.equal(f.input('text').props.value, 'http://draft:7890');
  f.find('button', (node) => node.props.type === 'button').props.onClick();
  f.render();
  assert.equal(f.input('text').props.value, 'http://external:3128');
  assert.equal(f.input('checkbox').props.checked, false);
  f.dispose();
});

test('transport failure keeps the draft and permits retry', async () => {
  const f = fixture();
  f.edit('text', 'http://retry:7890');
  f.behavior = async () => { throw new Error('offline'); };
  await f.submit();
  f.render();
  assert.match(f.text(), /保存失败/);
  assert.equal(f.input('text').props.value, 'http://retry:7890');
  f.behavior = undefined;
  await f.submit();
  f.render();
  assert.match(f.text(), /已保存/);
  f.dispose();
});

test('loading, unavailable, memory and read-only snapshots cannot save', async () => {
  for (const override of [{ status: 'loading' }, { status: 'unavailable' }, { writable: false }, { mode: 'memory' }]) {
    const f = fixture();
    f.edit('text', 'http://staged:7890');
    f.publish({ ...f.snapshot, ...override });
    assert.equal(f.input('text').props.disabled, true);
    assert.equal(f.input('checkbox').props.disabled, true);
    await f.submit();
    assert.equal(f.mutations.length, 0);
    f.dispose();
  }
});

test('pending save prevents duplicate submissions and unmount removes watchers', async () => {
  const f = fixture();
  let resolve;
  f.behavior = () => new Promise((done) => { resolve = done; });
  f.edit('text', 'http://pending:7890');
  const first = f.submit();
  await f.submit();
  f.render();
  assert.equal(f.mutations.length, 1);
  assert.equal(f.input('text').props.disabled, true);
  assert.match(f.text(), /保存中/);
  f.dispose();
  assert.equal(f.listeners.size, 0);
  resolve();
  await first;
});
