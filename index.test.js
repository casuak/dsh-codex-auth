// End-to-end apply: the host plugin module must start up exactly the way cordis
// starts it — with the row config already validated through its own `Config`
// schema, so volatile fields arrive as `{ get() }` wrappers.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getGlobalDispatcher } from 'undici'
import * as plugin from './index.js'

/** Minimal cordis host context: services by name, effects, events, timers. */
function hostContext(services = {}) {
  const handlers = new Map()
  const disposers = []
  let global = getGlobalDispatcher()
  return {
    handlers,
    disposers,
    ctx: {
      credentials: services.credentials,
      credentialsKey: 'credentials',
      get: (name) => {
        if (name === 'llm') return services.llm
        // The removed `settings.register` call read this service at apply time.
        if (name === 'settings') throw new Error('the plugin must not read the settings service')
        return undefined
      },
      on(event, listener) {
        if (!handlers.has(event)) handlers.set(event, [])
        handlers.get(event).push(listener)
        return () => {}
      },
      effect(fn) { const dispose = fn(); disposers.push(dispose); return dispose },
      interval(fn, ms) { disposers.push(() => {}) ; return { fn, ms } },
      get globalDispatcher() { return global },
    },
  }
}

function rowConfig(config) {
  const result = plugin.Config['~standard'].validate(config)
  assert.equal(result.issues, undefined)
  return result.value
}

test('apply starts up with the validated row config and installs the proxy', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'codex-auth-'))
  const authPath = join(dir, 'auth.json')
  await writeFile(authPath, JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: 'a.b.c', refresh_token: 'r' } }))

  const written = []
  const host = hostContext({
    credentials: { async modifyRecord(key, change) { written.push(key); return change(undefined) } },
    llm: { async listModels() { return [{ id: 'gpt-6-astra' }] } },
  })
  const config = rowConfig({ authPath, proxyUrl: 'http://localhost:7897' })
  // A volatile field is a wrapper here; a plugin that logged or compared it
  // directly would print "[object Object]" or never see `false`.
  assert.equal(typeof config.proxyUrl.get, 'function')

  plugin.apply(host.ctx, config)
  assert.equal(typeof plugin.Config, 'function')
  assert.deepEqual(plugin.inject, ['credentials', 'timer'])
  await new Promise(resolve => setTimeout(resolve, 50))

  assert.deepEqual(written, ['llm-pi-ai/openai-codex'], 'the bridge syncs the codex credential')
  assert.notEqual(getGlobalDispatcher().proxy, undefined, 'the GPT proxy route is installed')
  // The `-1m` presentation alias is remapped at the llm/stream waterfall.
  const stream = host.handlers.get('llm/stream')[0]
  let remapped
  const next = () => { throw new Error('the alias must be remapped, not passed through') }
  await stream.call({ stream: (options) => { remapped = options; return 'streamed' } },
    { provider: 'openai-codex', model: 'gpt-6-astra-1m' }, next)
  assert.equal(remapped.model, 'gpt-6-astra')
  for (const dispose of host.disposers.reverse()) await dispose?.()
})
