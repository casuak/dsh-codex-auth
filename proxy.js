import { execFileSync } from 'node:child_process'
import { Dispatcher, ProxyAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici'

export function parseWindowsProxy(output) {
  if (!/ProxyEnable\s+REG_DWORD\s+0x1\b/i.test(output)) return null
  const server = output.match(/ProxyServer\s+REG_SZ\s+([^\r\n]+)/i)?.[1]?.trim()
  if (!server) return null
  const entries = Object.fromEntries(server.split(';').filter(x => x.includes('=')).map(x => x.trim().split('=')))
  const address = entries.https || entries.http || (!server.includes('=') ? server : null)
  return address ? (/^https?:\/\//i.test(address) ? address : `http://${address}`) : null
}

export function resolveProxyUrl(config = {}, env = process.env, platform = process.platform, readRegistry = () => execFileSync('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'], { encoding: 'utf8', windowsHide: true })) {
  let value = config.proxyUrl?.trim() || env.DSH_GPT_PROXY
  if (!value && platform === 'win32') {
    try { value = parseWindowsProxy(readRegistry()) } catch { /* Fall back to explicit proxy environment. */ }
  }
  value ||= env.HTTPS_PROXY || env.https_proxy || env.ALL_PROXY || env.all_proxy || env.HTTP_PROXY || env.http_proxy
  if (!value) throw new Error('No GPT proxy found. Enable the Windows system proxy or set DSH_GPT_PROXY / proxyUrl to an HTTP proxy URL.')
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('GPT proxy must use http:// or https:// (Clash mixed port), not SOCKS/PAC.')
  return url.href
}

export function isGptOrigin(origin) {
  const hostname = new URL(origin).hostname.toLowerCase()
  return ['openai.com', 'chatgpt.com'].some(domain => hostname === domain || hostname.endsWith(`.${domain}`))
}

export class GptProxyDispatcher extends Dispatcher {
  constructor(direct, proxy) {
    super()
    this.direct = direct
    this.proxy = proxy
  }
  dispatch(options, handler) {
    // No direct fallback, even when the proxy is unavailable or NO_PROXY matches.
    return (isGptOrigin(options.origin) ? this.proxy : this.direct).dispatch(options, handler)
  }
}

export function installGptProxy(ctx, config = {}) {
  const previous = getGlobalDispatcher()
  // Keep one routing wrapper across edits: other plugins may wrap it in turn.
  const dispatcher = new GptProxyDispatcher(previous, previous)
  let currentProxy
  let currentUrl
  let disposed = false
  const retiring = new Set()
  const retire = (proxy) => {
    if (!proxy) return
    const pending = proxy.close().catch(error => {
      console.error(`[dsh-codex-auth] closing proxy failed: ${error.message}`)
    }).finally(() => retiring.delete(pending))
    retiring.add(pending)
  }
  const update = (next = {}) => {
    if (disposed) return
    let url
    try {
      url = next.proxyEnabled === false ? undefined : resolveProxyUrl(next)
    } catch (error) {
      // Leave the panel usable even when automatic detection finds no proxy.
      dispatcher.proxy = { dispatch(_options, handler) {
        handler.onError(error)
        return false
      } }
      retire(currentProxy)
      currentProxy = undefined
      currentUrl = null
      console.error(`[dsh-codex-auth] GPT requests blocked until proxy settings are fixed: ${error.message}`)
      return
    }
    if (url === currentUrl) return
    // Construct first so a bad replacement cannot break the current route.
    const proxy = url === undefined ? undefined : new ProxyAgent(url)
    const old = currentProxy
    dispatcher.proxy = proxy ?? previous
    currentProxy = proxy
    currentUrl = url
    retire(old)
    if (url) {
      const safe = new URL(url)
      console.log(`[dsh-codex-auth] GPT HTTP/WebSocket proxy: ${safe.protocol}//${safe.host} (OpenAI/ChatGPT domains only)`)
    } else {
      console.log('[dsh-codex-auth] GPT proxy disabled; using the original dispatcher')
    }
  }
  update(config)
  setGlobalDispatcher(dispatcher)
  ctx.on('dispose', async () => {
    disposed = true
    dispatcher.proxy = previous
    if (getGlobalDispatcher() === dispatcher) setGlobalDispatcher(previous)
    retire(currentProxy)
    currentProxy = undefined
    await Promise.all(retiring)
  })
  return { update }
}
