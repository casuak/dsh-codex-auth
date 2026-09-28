import z from '@deepseek-ai/schemastery'
import { installGptProxy, resolveProxyUrl } from './proxy.js'

/**
 * Codex OAuth bridge configuration owned by the plugin's Loader row.
 *
 * `Config` is the plugin's Config schema: Cordis validates the row `config`
 * against it before `apply` runs and re-resolves it on every profile-patch
 * edit, so a settings write re-activates this plugin with the new values and
 * the proxy follows live. `settings.register` does not exist on the current
 * `SettingsForms` service and must never be called here.
 *
 * `volatile()` marks the fields the settings panel may write; without at least
 * one volatile field the settings service refuses every edit ("Plugin entry …
 * has no volatile fields"). Requires `@deepseek-ai/schemastery` >= 3.18.3.
 * A volatile field reaches `apply` as a cosmokit wrapper carrying only `get()`,
 * never as a plain value — read it through {@link readConfigValue}.
 */
export const Config = z.object({
  proxyEnabled: z.boolean().default(true).volatile().description('是否使用代理'),
  proxyUrl: z.string().default('').volatile().description('HTTP/HTTPS 代理地址；留空自动检测系统或环境变量代理'),
  authPath: z.string().default('').description('Codex auth.json 路径；留空使用 %USERPROFILE%\\.codex\\auth.json'),
  recordKey: z.string().default('').description('写入的 DSH 凭据记录键；留空使用 llm-pi-ai/openai-codex'),
  syncIntervalMs: z.number().default(30000).description('同步间隔（毫秒）'),
})

/** Well-known key of the cosmokit volatile wrapper a volatile field resolves to. */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

/**
 * Read one validated Config field as a plain value.
 *
 * A `volatile()` field arrives as `{ get(), [Symbol(cosmokit.volatile.write)] }`
 * and a plain field as itself; anything else is passed through untouched.
 * @param value - validated Config field.
 * @returns The field's current plain value.
 */
export function readConfigValue(value) {
  if (value === null || typeof value !== 'object') return value
  if (typeof Reflect.get(value, VOLATILE_WRITE) === 'function' && typeof value.get === 'function') return value.get()
  return value
}

/**
 * Reject a proxy address the plugin could never dial, before it is persisted.
 * @param value - plain proxy settings.
 * @throws When proxy use is enabled and the address is not a usable HTTP proxy.
 */
export function validateProxySettings(value) {
  if (value.proxyEnabled !== false && String(value.proxyUrl ?? '').trim()) resolveProxyUrl(value)
}

/**
 * Install the GPT proxy routing wrapper from the row config.
 *
 * One global dispatcher wrapper is kept for the lifetime of the plugin, so
 * concurrent plugins can wrap the same instance; a config change reaches this
 * function as a fresh `apply`, and disposal restores the previous dispatcher.
 * @param ctx - plugin context owning the dispatcher's lifetime.
 * @param config - validated row config; proxy fields fall back to their defaults.
 * @returns The proxy control handle (also used by the settings tests).
 */
export function installProxySettings(ctx, config = {}) {
  const proxyEnabled = readConfigValue(config.proxyEnabled)
  const proxyUrl = readConfigValue(config.proxyUrl)
  return installGptProxy(ctx, {
    proxyEnabled: proxyEnabled === undefined ? true : proxyEnabled,
    proxyUrl: proxyUrl === undefined ? '' : proxyUrl,
  })
}
