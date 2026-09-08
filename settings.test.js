import test from 'node:test'
import assert from 'node:assert/strict'
import { getGlobalDispatcher } from 'undici'
import { installProxySettings, ProxySettings } from './settings.js'
import { installGptProxy } from './proxy.js'

test('schema defaults and types', () => {
  assert.deepEqual(ProxySettings({}), { proxyEnabled: true, proxyUrl: '' })
  assert.throws(() => ProxySettings({ proxyEnabled: 'false' }))
})

test('settings register base, restore saved value, watch changes and dispose', async () => {
  const previous = getGlobalDispatcher()
  const cleanups = []
  let watcher
  let options
  const ctx = {
    get: () => ({ register(ns, schema, opts) {
      assert.equal(ns, 'dsh-codex-auth')
      options = opts
      return {
        get: () => schema({ proxyEnabled: false, proxyUrl: '' }),
        watch(fn) { watcher = fn; return () => { watcher = undefined } },
      }
    } }),
    effect: fn => cleanups.push(fn()),
    on: (_event, fn) => cleanups.push(fn),
  }
  installProxySettings(ctx, { proxyUrl: 'http://localhost:7897' })
  const wrapper = getGlobalDispatcher()
  try {
    assert.equal(options.applies, 'live')
    assert.equal(options.base.proxyUrl, 'http://localhost:7897')
    assert.equal(wrapper.proxy, previous)
    options.validate({ proxyEnabled: false, proxyUrl: 'invalid' })
    assert.throws(() => options.validate({ proxyEnabled: true, proxyUrl: 'socks5://localhost:1' }))
    watcher({ proxyEnabled: true, proxyUrl: 'http://localhost:7897' })
    const first = wrapper.proxy
    assert.notEqual(first, previous)
    watcher({ proxyEnabled: true, proxyUrl: 'http://localhost:7898' })
    assert.notEqual(wrapper.proxy, first)
    assert.equal(getGlobalDispatcher(), wrapper)
    watcher({ proxyEnabled: false, proxyUrl: 'invalid' })
    assert.equal(wrapper.proxy, previous)
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup()
  }
  assert.equal(getGlobalDispatcher(), previous)
  assert.equal(watcher, undefined)
})

test('invalid startup blocks GPT until repaired without blocking settings', async () => {
  const previous = getGlobalDispatcher()
  let dispose
  const control = installGptProxy({ on: (_event, fn) => { dispose = fn } }, { proxyUrl: 'invalid' })
  try {
    let error
    getGlobalDispatcher().dispatch({ origin: 'https://api.openai.com' }, { onError: e => { error = e } })
    assert.ok(error)
    control.update({ proxyEnabled: false })
    assert.equal(getGlobalDispatcher().proxy, previous)
  } finally { await dispose() }
})
