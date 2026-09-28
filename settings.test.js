import test from 'node:test'
import assert from 'node:assert/strict'
import z from '@deepseek-ai/schemastery'
import { getGlobalDispatcher } from 'undici'
import { Config, installProxySettings, readConfigValue, validateProxySettings } from './settings.js'
import { installGptProxy } from './proxy.js'

/** Paths covered by a `volatile()` marker in the Config schema. */
function volatilePaths(schema, path = []) {
  if (schema.meta.volatile) return [path.join('.')]
  return Object.entries(schema.dict ?? {}).flatMap(([key, child]) => volatilePaths(child, [...path, key]))
}

/** Simulate cordis `resolveConfig`: validate the row config through `Config`. */
function resolved(config) {
  const result = Config['~standard'].validate(config)
  assert.equal(result.issues, undefined)
  return result.value
}

test('schema defaults and types', () => {
  const value = resolved({})
  assert.equal(readConfigValue(value.proxyEnabled), true)
  assert.equal(readConfigValue(value.proxyUrl), '')
  assert.equal(readConfigValue(value.syncIntervalMs), 30000)
  assert.equal(readConfigValue(value.authPath), '')
  assert.equal(Config['~standard'].validate({ proxyEnabled: 'false' }).issues?.length > 0, true)
})

test('Config declares every field apply reads, with the editable ones volatile', () => {
  // `resolveConfig` drops undeclared keys before `apply` sees them, so a field
  // missing from this schema would silently disappear from the row config.
  assert.deepEqual(Object.keys(Config.dict).sort(), ['authPath', 'proxyEnabled', 'proxyUrl', 'recordKey', 'syncIntervalMs'])
  // Without a volatile field the settings service rejects every write with
  // "Plugin entry ... has no volatile fields", which the panel shows as a save failure.
  assert.deepEqual(volatilePaths(Config).sort(), ['proxyEnabled', 'proxyUrl'])
  const value = resolved({ proxyEnabled: false, authPath: 'C:\\auth.json', recordKey: 'k', syncIntervalMs: 5000 })
  assert.deepEqual({
    proxyEnabled: readConfigValue(value.proxyEnabled),
    proxyUrl: readConfigValue(value.proxyUrl),
    authPath: readConfigValue(value.authPath),
    recordKey: readConfigValue(value.recordKey),
    syncIntervalMs: readConfigValue(value.syncIntervalMs),
  }, { proxyEnabled: false, proxyUrl: '', authPath: 'C:\\auth.json', recordKey: 'k', syncIntervalMs: 5000 })
})

test('the settings service JSON round-trip keeps volatile metadata and defaults', () => {
  // dsh-settings rehydrates `Config.toJSON()` before validating a write.
  const rehydrated = new z(Config.toJSON())
  assert.deepEqual(volatilePaths(rehydrated).sort(), ['proxyEnabled', 'proxyUrl'])
  const value = rehydrated['~standard'].validate({}).value
  assert.equal(readConfigValue(value.proxyEnabled), true)
  assert.equal(readConfigValue(value.proxyUrl), '')
  const enabled = rehydrated['~standard'].validate({ proxyUrl: 'http://localhost:7897' }).value
  assert.equal(readConfigValue(enabled.proxyUrl), 'http://localhost:7897')
})

test('readConfigValue reads a volatile wrapper and passes plain fields through', () => {
  assert.equal(readConfigValue('plain'), 'plain')
  assert.equal(readConfigValue(0), 0)
  assert.equal(readConfigValue(undefined), undefined)
  assert.equal(readConfigValue({ get: () => 'duck', [Symbol.for('cosmokit.volatile.write')]: () => {} }), 'duck')
  // A plain object without the cosmokit marker is not a volatile wrapper.
  const plain = { get: () => 'nope' }
  assert.equal(readConfigValue(plain), plain)
})

test('validateProxySettings rejects only unusable enabled proxies', () => {
  assert.equal(validateProxySettings({ proxyEnabled: true, proxyUrl: 'http://localhost:7897' }), undefined)
  assert.equal(validateProxySettings({ proxyEnabled: true, proxyUrl: '' }), undefined)
  // A disabled proxy never dials, so its leftover address must not block saving.
  assert.equal(validateProxySettings({ proxyEnabled: false, proxyUrl: 'socks5://localhost:1' }), undefined)
  assert.throws(() => validateProxySettings({ proxyEnabled: true, proxyUrl: 'socks5://localhost:1' }), /must use/)
})

test('installProxySettings reads the row config without the removed settings.register', async () => {
  const previous = getGlobalDispatcher()
  const ctx = {
    // The plugin used to call `ctx.get('settings').register(...)`, which threw
    // "settings?.register is not a function" during apply on every startup.
    get: () => { throw new Error('installProxySettings must not read the settings service') },
    on: () => {},
  }
  const proxy = installProxySettings(ctx, resolved({ proxyUrl: 'http://localhost:7897' }))
  const wrapper = getGlobalDispatcher()
  assert.equal(typeof proxy.update, 'function')
  assert.notEqual(wrapper, previous)
  assert.notEqual(wrapper.proxy, previous)
  const first = wrapper.proxy
  // A config edit re-activates the plugin: the same wrapper takes the new route.
  proxy.update({ proxyEnabled: true, proxyUrl: 'http://localhost:7898' })
  assert.notEqual(wrapper.proxy, first)
  proxy.update({ proxyEnabled: false })
  assert.equal(wrapper.proxy, previous)
  assert.equal(getGlobalDispatcher(), wrapper)
})

test('a volatile-disabled proxy restores the original dispatcher', () => {
  const previous = getGlobalDispatcher()
  installProxySettings({ on: () => {} }, resolved({ proxyEnabled: false, proxyUrl: 'http://localhost:7897' }))
  // The wrapper is installed globally, but routes GPT traffic to the original dispatcher.
  assert.equal(getGlobalDispatcher().proxy, previous)
})

test('dispose restores the original dispatcher', async () => {
  const previous = getGlobalDispatcher()
  let dispose
  const ctx = { on: (_event, fn) => { dispose = fn } }
  installProxySettings(ctx, resolved({ proxyUrl: 'http://localhost:7897' }))
  const wrapper = getGlobalDispatcher()
  assert.notEqual(wrapper, previous)
  await dispose()
  assert.equal(getGlobalDispatcher(), previous)
})

test('invalid startup blocks GPT until repaired without blocking the plugin', async () => {
  const previous = getGlobalDispatcher()
  let dispose
  // A missing proxy must not unmount the plugin: the panel stays usable.
  const control = installGptProxy({ on: (_event, fn) => { dispose = fn } }, { proxyUrl: 'invalid' })
  try {
    let error
    getGlobalDispatcher().dispatch({ origin: 'https://api.openai.com' }, { onError: e => { error = e } })
    assert.ok(error)
    control.update({ proxyEnabled: false })
    assert.equal(getGlobalDispatcher().proxy, previous)
  } finally { await dispose() }
})
