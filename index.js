/**
 * dsh-codex-auth — host credential bridge.
 *
 * Reads the local Codex CLI ChatGPT OAuth tokens (`~/.codex/auth.json`) and
 * mirrors them into the DSH credential record that llm-pi-ai's `openai-codex`
 * catalog route reads (`llm-pi-ai/openai-codex`), so the GPT models of the
 * Codex catalog (gpt-6-astra-1m / gpt-6-astra / gpt-5.6-sol, endpoint
 * https://chatgpt.com/backend-api) authenticate with the existing Codex
 * login.
 *
 * READ-ONLY contract toward the Codex CLI:
 *  - `~/.codex/auth.json` is never rewritten; no OAuth refresh is ever
 *    performed by this plugin.
 *  - The stored record pins `expires` to a far-future value so pi-ai never
 *    enters its own refresh path (a pi-ai-side refresh would rotate the
 *    refresh token and invalidate the Codex CLI copy).
 *  - When the Codex CLI refreshes the tokens, the bridge notices the changed
 *    access token within one sync interval and updates the record.
 *  - Expired tokens surface as the provider's authentication error on the
 *    next model request; `codex login` restores them.
 *
 * `-1m` model alias: the manifest declares `gpt-6-astra-1m` as the
 * presentation copy of gpt-6-astra with a 1,000,000-token context window.
 * pi-ai sends `model.id` verbatim to chatgpt.com, so this plugin rewrites a
 * `*-1m` model back to its base model at the `llm/stream` waterfall (with a
 * NEW options object — a loop-built request is deep-frozen and must never be
 * mutated). The backend therefore always receives `gpt-6-astra` while the
 * user still sees `gpt-6-astra-1m`.
 */

import { installGptProxy } from './proxy.js'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const name = 'codex-auth'

export const inject = ['credentials', 'timer']

const DEFAULT_RECORD_KEY = 'llm-pi-ai/openai-codex'
const DEFAULT_SYNC_INTERVAL_MS = 30000
const NEVER_REFRESH_EXPIRES = Number.MAX_SAFE_INTEGER
/** Suffix marking presentation copies that map to the same wire model. */
const ALIAS_SUFFIX = '-1m'

function decodeExp(token) {
  try {
    const part = String(token).split('.')[1]
    const payload = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null
  } catch {
    return null
  }
}

export function apply(ctx, configPassed) {
  // `config` is the SECOND apply argument in cordis; `ctx.config` is a
  // guarded identity and must never be touched here. The row config may be
  // `null`/`undefined` when the patch gives it nothing, so default it.
  const cfg = (configPassed !== null && configPassed !== undefined && typeof configPassed === 'object')
    ? configPassed
    : {}
  const authPath = typeof cfg.authPath === 'string' && cfg.authPath.length > 0
    ? cfg.authPath
    : join(homedir(), '.codex', 'auth.json')
  const recordKey = typeof cfg.recordKey === 'string' && cfg.recordKey.length > 0
    ? cfg.recordKey
    : DEFAULT_RECORD_KEY
  const syncIntervalMs = Number.isFinite(cfg.syncIntervalMs) && cfg.syncIntervalMs > 0
    ? cfg.syncIntervalMs
    : DEFAULT_SYNC_INTERVAL_MS

  // Install before any provider request; a missing proxy fails closed.
  installGptProxy(ctx, cfg)

  const credentials = ctx.credentials
  const llm = ctx.get('llm')
  let lastAccess = ''

  // Wire remap for `-1m` presentation copies. The loop-built request object is
  // deep-frozen, so we never mutate `options`; a fresh object replaces it.
  ctx.on('llm/stream', function (options, next) {
    if (options === null || options === undefined || typeof options !== 'object') return next()
    if (options.provider !== 'openai-codex' || typeof options.model !== 'string') return next()
    if (!options.model.endsWith(ALIAS_SUFFIX)) return next()
    const base = options.model.slice(0, -ALIAS_SUFFIX.length)
    if (base.length === 0) return next()
    return this.stream({ ...options, model: base })
  })

  const sync = async () => {
    try {
      const text = await readFile(authPath, 'utf8')
      const auth = JSON.parse(text)
      if (auth.auth_mode !== 'chatgpt' || auth.tokens === undefined || typeof auth.tokens.access_token !== 'string') {
        console.error(`[dsh-codex-auth] ${authPath} is not ChatGPT-mode (auth_mode=${JSON.stringify(auth.auth_mode)}) or has no access_token; run \`codex login\` to restore.`)
        return
      }
      const access = auth.tokens.access_token
      if (access === lastAccess) return
      const exp = decodeExp(access)
      if (exp !== null && exp <= Date.now() + 5 * 60 * 1000) {
        console.error(`[dsh-codex-auth] codex access token expired or expiring (exp=${new Date(exp).toISOString()}); refresh it by running \`codex login\` or any Codex CLI invocation.`)
      }
      const payload = {
        type: 'oauth',
        access,
        refresh: typeof auth.tokens.refresh_token === 'string' ? auth.tokens.refresh_token : '',
        expires: NEVER_REFRESH_EXPIRES,
      }
      if (typeof auth.tokens.account_id === 'string') payload.accountId = auth.tokens.account_id
      const written = await credentials.modifyRecord(recordKey, async (current) => {
        if (current !== undefined && current.kind === 'grant' && current.payload
          && current.payload.access === access) return undefined
        return { kind: 'grant', payload }
      })
      lastAccess = access
      console.log(`[dsh-codex-auth] synced codex OAuth credential${payload.accountId ? ` for account ${payload.accountId}` : ''} (record ${recordKey}; ${written === undefined ? 'unchanged' : 'written'})`)
      if (llm !== undefined) {
        try {
          const models = await llm.listModels('openai-codex')
          console.log(`[dsh-codex-auth] openai-codex route serves: ${models.map((m) => m.id).join(', ')}`)
        } catch (e) {
          console.error(`[dsh-codex-auth] listModels('openai-codex') failed: ${e?.message ?? String(e)} — check the llm-pi-ai.providers.openai-codex section in $DSH_HOME/settings.yaml`)
        }
      }
    } catch (e) {
      console.error(`[dsh-codex-auth] sync failed: ${e?.message ?? String(e)}`)
    }
  }

  void sync()
  ctx.interval(sync, syncIntervalMs)
}