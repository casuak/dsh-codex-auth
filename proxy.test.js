import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { parseWindowsProxy, resolveProxyUrl, isGptOrigin, GptProxyDispatcher, installGptProxy } from './proxy.js'

test('Windows single and per-protocol system proxy', () => {
  assert.equal(parseWindowsProxy('ProxyEnable REG_DWORD 0x1\nProxyServer REG_SZ 127.0.0.1:7897'), 'http://127.0.0.1:7897')
  assert.equal(parseWindowsProxy('ProxyEnable REG_DWORD 0x1\nProxyServer REG_SZ http=localhost:1;https=localhost:2'), 'http://localhost:2')
  assert.equal(parseWindowsProxy('ProxyEnable REG_DWORD 0x0\nProxyServer REG_SZ localhost:1'), null)
})
test('precedence and fail closed', () => {
  assert.equal(resolveProxyUrl({ proxyUrl: 'http://localhost:7897' }, {}, 'linux'), 'http://localhost:7897/')
  assert.throws(() => resolveProxyUrl({}, {}, 'linux'), /No GPT proxy/)
  assert.throws(() => resolveProxyUrl({ proxyUrl: 'socks5://localhost:7897' }), /must use/)
})
test('domain boundary and selective dispatch', () => {
  for (const host of ['chatgpt.com', 'api.openai.com', 'auth.openai.com']) assert.ok(isGptOrigin(`https://${host}`))
  for (const host of ['localhost', 'api.deepseek.com', 'openai.com.evil.test', 'notopenai.com']) assert.ok(!isGptOrigin(`https://${host}`))
  const calls = []
  const dispatcher = new GptProxyDispatcher({ dispatch: () => calls.push('direct') }, { dispatch: () => calls.push('proxy') })
  dispatcher.dispatch({ origin: 'https://api.openai.com' }, {})
  dispatcher.dispatch({ origin: 'https://api.deepseek.com' }, {})
  assert.deepEqual(calls, ['proxy', 'direct'])
})
test('native fetch and native WebSocket both CONNECT through proxy', async () => {
  const targets = []
  const server = createServer()
  server.on('connect', (req, socket) => {
    targets.push(req.url)
    socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  let dispose
  installGptProxy({ on: (_event, fn) => { dispose = fn } }, { proxyUrl: `http://127.0.0.1:${server.address().port}` })
  try {
    await assert.rejects(fetch('https://api.openai.com/v1/models', { signal: AbortSignal.timeout(3000) }))
    await new Promise((resolve, reject) => {
      const ws = new WebSocket('wss://chatgpt.com/backend-api/codex/responses')
      const timer = setTimeout(() => { ws.close(); reject(new Error('WebSocket did not use proxy')) }, 3000)
      ws.addEventListener('error', () => { clearTimeout(timer); resolve() }, { once: true })
    })
    assert.ok(targets.includes('api.openai.com:443'))
    assert.ok(targets.includes('chatgpt.com:443'))
  } finally {
    await dispose()
    await new Promise(resolve => server.close(resolve))
  }
})
