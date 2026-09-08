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
  let value = config.proxyUrl || env.DSH_GPT_PROXY
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

export function installGptProxy(ctx, config) {
  const url = resolveProxyUrl(config)
  const previous = getGlobalDispatcher()
  const proxy = new ProxyAgent(url)
  const dispatcher = new GptProxyDispatcher(previous, proxy)
  setGlobalDispatcher(dispatcher)
  ctx.on('dispose', async () => {
    if (getGlobalDispatcher() === dispatcher) setGlobalDispatcher(previous)
    await proxy.close()
  })
  const safe = new URL(url)
  console.log(`[dsh-codex-auth] GPT HTTP/WebSocket proxy: ${safe.protocol}//${safe.host} (OpenAI/ChatGPT domains only)`)
}
