import z from '@deepseek-ai/schemastery'
import { installGptProxy, resolveProxyUrl } from './proxy.js'

export const SETTINGS_NAMESPACE = 'dsh-codex-auth'
export const ProxySettings = z.object({
  proxyEnabled: z.boolean().default(true).description('是否使用代理'),
  proxyUrl: z.string().default('').description('HTTP/HTTPS 代理地址；留空自动检测'),
})

export function installProxySettings(ctx, config = {}) {
  const base = ProxySettings({
    ...(config.proxyEnabled === undefined ? {} : { proxyEnabled: config.proxyEnabled }),
    ...(config.proxyUrl === undefined ? {} : { proxyUrl: config.proxyUrl }),
  })
  // Without a settings provider, retain the composition-only deployment path.
  const settings = ctx.get('settings')
  const scope = settings?.register(SETTINGS_NAMESPACE, ProxySettings, {
    base,
    applies: 'live',
    validate(value) {
      if (value.proxyEnabled && value.proxyUrl.trim()) resolveProxyUrl(value)
    },
  })
  const proxy = installGptProxy(ctx, scope?.get() ?? base)
  if (scope) ctx.effect(() => scope.watch(next => proxy.update(next)))
  return proxy
}
