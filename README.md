# dsh-codex-auth

> 仓库地址：<https://github.com/casuak/dsh-codex-auth.git><br>
> 安装使用：`dsh plugin --profile web add file:<本目录>` 或 `git clone https://github.com/casuak/dsh-codex-auth.git` 后本地安装。

利用本机 Codex CLI 的 ChatGPT 登录凭据（`~/.codex/auth.json`），让 DeepSeek Harness 通过
`llm-pi-ai` 的 `openai-codex` 路由直接调用 GPT 模型（`gpt-6-astra-1m` / `gpt-6-astra` / `gpt-5.6-sol`）。

## 设置面板位置（重要）

本插件的两个面板都挂在 **设置 → 插件（Plugins）→ 本插件的行 / llm-pi-ai 的行** 上——
即打开插件卡片后，行上的「配置」入口所打开的页面：

- **dsh-codex-auth** 行 → 代理设置面板；
- **`@deepseek-ai/dsh-llm-pi-ai`** 行 → 模型上下文面板。

客户端一半通过客户端槽位 `plugins.row.config` 注册页面，键分别是
`dsh-codex-auth#codex-auth` 与 `@deepseek-ai/dsh-llm-pi-ai#llm-pi-ai`，
表单数据取自客户端的 `configForms` 服务（按 namespace 取：`codex-auth` / `llm-pi-ai`）。

> 升级提示：旧版本注入客户端服务 `settingsScope` 并向槽位 `settings.plugin.item`
> 注册卡片。两者在当前 DSH 客户端都已不存在，结果是插件一直停留在
> `pending (waiting for service: settingsScope)`、整个客户端插件不激活
> （页面顶部报 “Failed to load plugins / 1 entry did not activate”）。
> 现版本改用 `inject: ['slots', 'configForms']` + `plugins.row.config`。

## 模型上下文设置面板

更新安装并重启 DSH、刷新页面后，在 **设置 → 插件 → `llm-pi-ai` 行 → 配置** 中：

- 按 `openai-codex` 已配置的模型列表，分别编辑 **contextWindow**（单位 token）。支持自定义模型，不限于内置三个模型。
- 输入正整数；留空移除显式值，使用 pi-ai 模型目录或提供方默认值。
- 点击 **保存**，直接持久化到 `llm-pi-ai.providers.openai-codex.models`，后续请求使用新配置，无需再次重启。正在进行的请求保留原配置。
- 保留模型的 `maxTokens`、图片输入、推理档位等其他配置，不改变其他提供方。
- 设置的是 DSH 使用的上下文容量，不会提高服务端的实际限制。并发修改时请点击 **重新载入** 后再编辑。

## 代理设置面板

更新安装并重启 DSH、刷新页面后，在 **设置 → 插件 → `dsh-codex-auth` 行 → 配置** 中：

- **启用代理**：默认开启；关闭后恢复原 dispatcher，不再由本插件强制代理。
- **代理地址**：例如 `http://127.0.0.1:7897`；留空自动检测系统/环境变量代理。
- 点击 **保存**，设置持久化到 DSH settings，立即用于新请求，无需再次重启；正在进行的请求不被中断。
- 开启代理却无法自动检测地址时，GPT 请求会报错而非回退直连，仍可从面板修复或关闭代理。

用户设置优先于 composition 中的 `proxyEnabled` / `proxyUrl`。仅影响 OpenAI/ChatGPT 域名。

面板的读写走当前 DSH 的配置通道：插件通过导出 `Config`（schemastery schema）声明可配置项，
其中 `proxyEnabled` / `proxyUrl` 标记为 `volatile()`（可实时编辑）。面板保存时写入 profile
patch 并重新激活插件，因此**保存后立即生效、无需重启**；`volatile()` 需要
`@deepseek-ai/schemastery` >= 3.18.3（`package.json` 已如此声明）。

> 升级提示：旧版本曾在 `apply` 里调用 `ctx.get('settings').register(...)`。当前 DSH 的
> `settings` 是一个 `SettingsForms` 服务，只有 `configure/describe/update/replace/mutate`，
> **没有 `register`**——该调用会抛出 `TypeError: settings?.register is not a function` 并使
> 整个插件启动失败（凭据桥接、`-1m` 重映射、代理全部不生效）。现版本已移除该调用。

## Clash Verge 系统代理（无需 TUN）

插件启动时自动读取 Windows 已启用的系统代理（本机为 `http://127.0.0.1:7897`），
通过 Undici dispatcher 将 `openai.com`、`chatgpt.com` 及其子域名的 HTTP/SSE 和
WebSocket 请求送入代理；其他域名沿用原来的连接方式。适用于本 DSH 进程的原生
fetch/WebSocket 与 Undici 默认 dispatcher，不会修改系统设置或独立 Codex CLI。
第三方 GPT 中转域名、显式自定义 dispatcher 或其他 HTTP 客户端不在此范围内。

- 优先级：插件 `proxyUrl` → `DSH_GPT_PROXY` → Windows 系统代理 → HTTP(S)/ALL_PROXY 环境变量。
- 找不到代理会报错；代理连接失败不会回退直连，GPT 域名不受 `NO_PROXY` 绕过。
- 只支持 HTTP/HTTPS 代理地址（Clash mixed port），不支持 PAC/SOCKS 地址。
- Clash 仍按自己的规则选择出口；如需确保不从 Clash DIRECT 出口访问，请将 OpenAI/ChatGPT 规则设为代理节点。
- 需 Node.js >=22.19.0。面板修改地址/开关实时生效；外部系统代理或环境变量改变后需重启 DSH 重新检测。

更新已有安装并重启 `dsh web` 后生效（不会热更新当前进程）：

```powershell
dsh plugin --profile web add file:D:\winshare\icloud\code\dsh-codex-auth
```

可用 `proxyUrl: http://127.0.0.1:7897` 固定地址（`codex-auth` 行的 `config` 中），
也可在启动 DSH 的终端设置 `$env:DSH_GPT_PROXY = 'http://127.0.0.1:7897'`。
启动日志应包含 `GPT HTTP/WebSocket proxy: http://127.0.0.1:7897`。

## 工作原理

1. 插件（Host 机进程，随 profile 启动）读取 `~/.codex/auth.json` 中的
   ChatGPT OAuth 令牌（`tokens.access_token` / `refresh_token` / `account_id`）。
2. 将其镜像进 DSH 凭据库记录 `llm-pi-ai/openai-codex`（`kind: grant, type: oauth`），
   这样 pi-ai 的 `openai-codex` catalog 路由（端点 `https://chatgpt.com/backend-api`）
   就能用你的 Codex 登录完成认证。
3. 每 30 秒重新读取 auth.json 并同步一次；Codex CLI 刷新令牌后，记录自动跟随。

### 对 Codex CLI 的只读契约（重要）

- **绝不回写** `~/.codex/auth.json`，**绝不主动刷新**令牌。
- 写入的凭据将 `expires` 固定为远未来值，使 pi-ai 的自动刷新路径永远不会触发
  （否则 pi-ai 刷新会轮换 refresh_token，导致你本地 Codex CLI 需要重新登录）。
- 令牌过期/被撤销且 Codex CLI 长时间未使用时：模型请求会以认证错误失败，
  运行一次 `codex login`（或任意 Codex CLI 调用）即恢复。

## 在其他电脑上开箱即用

1. **复制/打包本目录**（`package.json` + `index.js` + `proxy.js` + `settings.js` + `client.js` + `cordis.patch.yml`，
   或整个 `dsh-codex-auth` 目录）。
2. 在该机器上安装到目标 profile：
   ```powershell
   dsh plugin --profile <name> add file:<路径>\dsh-codex-auth
   ```
3. 该机器需已登录 Codex CLI（`codex login` 或使用过 Codex CLI，产生 `~/.codex/auth.json`）。
4. 重启该 profile 的 DSH 服务。插件自动：
   - 把本机 Codex 凭据桥接进 `llm-pi-ai/openai-codex`；
   - 注册 `openai-codex` 路由（三个模型：`gpt-6-astra-1m` / `gpt-6-astra` / `gpt-5.6-sol`、
      全部上下文上限 1M、小写名称、五档思考强度、
      全部声明 `input: [ text, image ]` 图片输入）。

无需任何机器相关的配置修改：auth 路径默认取 `%USERPROFILE%\.codex\auth.json`，
全部路由参数内置于插件。

## 安装

在你的 web profile 目录用官方插件通道安装（推荐）：

```powershell
# 在任意目录：
dsh plugin --profile web add file:C:\Users\wyj\Desktop\dsh_test\dsh_codex_auth\dsh-codex-auth
```

或者手动方式：

```powershell
# 在 profile 目录（C:\Users\wyj\.dsh\profiles\web）执行：
pnpm add file:C:\Users\wyj\Desktop\dsh_test\dsh_codex_auth\dsh-codex-auth
# 并把 "dsh-codex-auth" 追加到 package.json 的 dsh.profile.bundles 列表：
#   "bundles": [ "@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", ..., "dsh-codex-auth" ]
```

然后 **重启 web 服务**（`dsh web`）。重启后插件在 Host 启动时自动生效，
无需任何手动激活。

## 配置全部内置于插件（开箱即用）

本插件是 `openai-codex` 路由配置的**唯一来源**（通过 bundle patch 以 row id `llm-pi-ai`
覆盖组合行，见 `cordis.patch.yml`）：

- 三个模型（按陈列顺序）：`gpt-6-astra-1m` / `gpt-6-astra` / `gpt-5.6-sol`，
  **全部声明 `contextWindow: 1000000`（上下文上限 1M）、`maxTokens: 128000`**；
  线缆上把 `*-1m` 重映射回本体模型；
- 显示名统一小写 id 风格（覆盖 catalog 默认的 "GPT-5.6 Sol" 式命名）；
- 全部三个模型显式声明图片输入（`input: [ text, image ]`）——`gpt-5.6-sol` 本体虽可从
  pi-ai catalog 继承该能力，但 `gpt-6-astra` 不在 catalog 内，若不声明会退化为纯文本；
- 全部模型思考强度档位：`low / medium / high / xhigh / max` 五档；
- 凭据自动桥接：无需配置任何机器相关路径，默认读 `%USERPROFILE%\.codex\auth.json`。

**你不需要再编辑 `settings.yaml`。** 如果某台机器已有 `llm-pi-ai:` settings 分节，
其 `providers` 与插件内配置按提供方合并：本插件未占用的路由（如 `kimi-coding`、`glm`）
照常生效；`openai-codex` 键若同时存在于两者，以你的 settings 分节为准（内容相同则无差异）。
本机（已编辑过 settings.yaml 的情况）在装包重启后，可删除其中的 `openai-codex` 分节，
使插件成为唯一来源（删除前请知悉：删除后需要重启才生效）。

> 提示：`llm-pi-ai.providers.openai-codex` 是 pi-ai 内置的 catalog 路由（dsh-llm-pi-ai
> 安装后即被识别），插件内仅声明模型的裁剪与呈现元数据，端点/协议继承自 catalog。

### `-1m` 别名（1M 上下文呈现副本）

- `gpt-6-astra-1m` 是 `gpt-6-astra` 的**呈现副本**：选择器中显示为独立模型，声明与本体一致
  （`contextWindow: 1000000`、`maxTokens: 128000`、图片输入、推理档位 low/medium/high/xhigh/max）。
- **实际调用与本体相同**：pi-ai 把 `model.id` 原样发给 chatgpt.com，因此插件在
  `llm/stream` Waterfall 上把 `*-1m` 重映射回本体（用**新的** options 对象替换请求，
  从不修改深冻结的请求对象）——后端始终收到 `gpt-6-astra`，界面看到的是
  `gpt-6-astra-1m`。
- **重点**：因为重映射发生在瀑布里，pi-ai 实际按**本体模型条目**做容量判定
  （`modelOf` 按最终 `options.model` 解析）。所以本体条目也必须声明真实容量——
  早前本体未声明（`gpt-5.6-*` 回落到 catalog 的 272000、`gpt-6-astra` 回落到默认
  262144），导致 pi-ai 的「静默溢出」启发式在 26 万~27 万 token 级别的对话上误报
  `CONTEXT_WINDOW_EXCEEDED`（详见下一节）。现统一声明 `1000000`。

### 传输错误自动重试（5 次 × 10 秒）

偶尔会在界面看到 `本轮运行失败 WebSocket error PI_AI_ERROR`。原因链如下：

1. GPT 模型走 pi-ai 的 `openai-codex` catalog 路由，默认优先用 **WebSocket** 传输
   （`wss://chatgpt.com/backend-api/codex/responses`；仅「首事件之前」的连接失败才会
   自动回落 SSE）。流已开始后一旦连接异常（服务端连接过期/空闲超时、网络抖动、代理
   断开），pi-ai 直接以 `WebSocket error`（或 `WebSocket closed 1006 …`）报错。
2. dsh-llm-pi-ai 的 `classifyPiAiError` 把这些 WebSocket 文本归类到兜底错误码
   `PI_AI_ERROR`（其 TRANSPORT 规则只匹配 `WebSocket closed unexpectedly` 等精确短语）。
3. 框架重试（dsh-base 内置 `llm-retry`，挂在 agent 循环的 `agent/request-error`
   恢复点）默认只重试 `EMPTY_RESPONSE / RATE_LIMIT / SERVER / TIMEOUT / TRANSPORT`，
   **不包含 `PI_AI_ERROR`**，于是该失败直接结束本轮。

插件通过 `cordis.patch.yml` 为 `openai-codex` 路由声明如下策略（无需改 settings.yaml）：

- `maxRetries: 5` —— 首次请求失败后最多再试 5 次（共 6 次尝试）；
- `backoff: { initialDelayMs: 10000, maxDelayMs: 10000, jitterRatio: 0 }` —— 固定间隔
  10 秒、无抖动；
- `retryableCodes` —— 在框架默认集合上追加 `PI_AI_ERROR`，并把五类瞬时错误全部纳入。

重试期间 Web 界面会显示「正在重试模型请求」及 10 秒倒计时；5 次耗尽后仍失败才显示
本轮错误。重试请求不携带上一次的部分输出（失败的尝试不会产生 assistant 消息），因此
不会污染上下文。认证（AUTH）、配额（QUOTA_EXCEEDED）、参数（INVALID_REQUEST）与
用户取消（ABORTED）不重试。

### 上下文溢出的误报与恢复（CONTEXT_WINDOW_EXCEEDED）

偶尔会出现 `本轮运行失败 pi-ai detected context overflow for model "gpt-6-astra"
CONTEXT_WINDOW_EXCEEDED`，而对话其实未达到模型的真实容量（输入“继续”往往就能恢复）。
原因链：

1. pi-ai 有一道「静默溢出」判定（`isContextOverflow`）：当某次请求**成功完成**
   （stopReason `stop`/`length`）但 `usage.input + usage.cacheRead > contextWindow`
   时，推定后端“静默截断”，把成功响应改判为 `CONTEXT_WINDOW_EXCEEDED`。
2. 该判定用的 `contextWindow` 是**线缆上最终模型条目**的容量（见上一节）。
   `gpt-6-astra` 不在 pi-ai catalog 中，此前插件未给本体声明容量，回落到默认
   `262144`——26 万 token 级别的大上下文（本插件的 `-1m` 副本则声明 1M）在此
   触发误报，而消息里的模型名是线缆上的本体名（`gpt-6-astra`）。
3. 平台对 `CONTEXT_WINDOW_EXCEEDED` 的自动恢复（compaction-basic：压缩后重试）在
   web profile 中被 dsh-web-app 显式禁用（`compaction-basic` row `disabled: true`），
   因此该失败直接结束本轮，没有恢复路径。

修复与重试策略（`cordis.patch.yml`）：

- 给全部三个模型（含本体）声明 `contextWindow: 1000000` / `maxTokens: 128000`，
  使判定容量与模型真实能力（及 `-1m` 呈现声明）一致——这是消除误报的根本修复；
- `retryableCodes` 追加 `CONTEXT_WINDOW_EXCEEDED`：在 web profile 无压缩恢复的
  前提下，给这类失败同样的 5 次 × 10 秒重试兜底（观察到重试可成功；若为真实
  溢出，5 次耗尽后仍会以服务端真实错误结束本轮）。

> 注：在有 compaction-basic 自动压缩的 profile（非 web）中，本策略的恢复点
> （llm-retry）先于压缩恢复点运行；如需保留「先压缩再重试」的平台默认行为，
> 可从 `retryableCodes` 中移除 `CONTEXT_WINDOW_EXCEEDED`。

## 使用

- Web 界面的模型选择器中会出现 `OpenAI Codex` 提供方及三个模型
  （`gpt-6-astra-1m` / `gpt-6-astra` / `gpt-5.6-sol`，按此顺序陈列），按需选择。
- 默认 agent 模型保持 `deepseek-v4-flash-vision-exp` 不变（除非你另外修改
  `agent-default-model` 设置）。
- 插件日志里每次同步会打印 `[dsh-codex-auth] synced codex OAuth credential ...` 与
  路由模型清单，便于确认。

## 验证

```powershell
# 确认凭据记录已写入（不显示令牌值）：
Select-String -Path C:\Users\wyj\.dsh\.credentials.yaml -Pattern "llm-pi-ai/openai-codex"
```

在模型选择器里切到 `gpt-6-astra` 发一条消息即可。若报认证错误，先运行 `codex login`。

## 卸载

**第一步：从 profile 移除插件（并重启）**

```powershell
# 在 profile 目录（C:\Users\wyj\.dsh\profiles\web）：
dsh plugin --profile web remove dsh-codex-auth
# 然后重启 dsh web 服务
```

`remove` 会卸载包并从 `dsh.profile.bundles` 移除 `dsh-codex-auth`。重启后：

- `codex-auth` 桥（凭据同步、`-1m` 重映射）停止；
- `llm-pi-ai` 组合行回落到 dsh-base 的休眠态，`openai-codex` 路由与 3 个模型
  从模型选择器中消失。

**第二步：清理凭据记录（可选，推荐）**

重启后删除 DSH 凭据库中的 `llm-pi-ai/openai-codex` 记录，二选一：

```powershell
# 方式 A：手动删除（先备份文件）
#   打开 C:\Users\wyj\.dsh\.credentials.yaml，删除 records 段下的：
#   llm-pi-ai/openai-codex:
#     kind: grant
#     payload: {...}

# 方式 B：Web 界面 —— 设置 → 模型(MODELS) → OpenAI Codex → 登出
```

清空后 pi-ai 对该路由报告「未配置凭据」，不会残留令牌。

**第三步：清理 settings.yaml 中的 openai-codex（可选，仅本机）**

若你的 `$DSH_HOME/settings.yaml`（`C:\Users\wyj\.dsh\settings.yaml`）里仍保留着
`llm-pi-ai.providers.openai-codex` 分节（本机在插件化之前手动添加的），删除它以恢复
卸载前的配置边界（`kimi-coding`、`glm` 等分节保留不动）：

```yaml
llm-pi-ai:
  providers:
    kimi-coding: ...
    glm: ...
    # openai-codex: ...   ← 删除这一整段
```

> 卸载不需要动 `~/.codex/auth.json`——插件从不写它，Codex CLI 登录不受任何影响。
> 若你在卸载前曾用动态插件验证过，进程重启后动态插件与会话侧遗留的
> `/codex-bridge-status` 诊断路由也会一并消失，无残留。

**重新安装**：与首次安装相同（`dsh plugin --profile web add file:<路径>` + 重启），
凭据记录为空时会自动重新桥接本机 Codex 登录。

## 配置项（可选）

| 字段 | 默认 | 可实时编辑 | 说明 |
|---|---|---|---|
| `authPath` | `%USERPROFILE%\.codex\auth.json` | 否 | Codex 认证文件路径 |
| `recordKey` | `llm-pi-ai/openai-codex` | 否 | 写入的 DSH 凭据记录键 |
| `syncIntervalMs` | `30000` | 否 | 同步间隔 |
| `proxyEnabled` | `true` | 是 | 是否由本插件代理 GPT 域名 |
| `proxyUrl` | 空（自动检测） | 是 | HTTP/HTTPS 代理地址 |

「可实时编辑」的字段同时出现在 **设置 → 插件 → 可配置项 → dsh-codex-auth** 面板中；
其余字段只能写在 `config:` 里（改动后需重新激活插件，通常重启即可）。

> 注意：`Config` schema 必须声明 `apply` 读取的**每一个**字段——cordis 在校验行配置时
> 会丢弃 schema 未声明的键；同时至少要有一个 `volatile()` 字段，否则设置服务会以
> `Plugin entry … has no volatile fields` 拒绝保存。

在 `cordis.patch.yml` 的插入行 `config:`（或本包的 `cordis.patch.yml`）中覆盖：

```yaml
- insert:
    # Optional configuration overrides (all defaults shown):
    #   config:
    #     authPath: C:\Users\wyj\.codex\auth.json
    #     recordKey: llm-pi-ai/openai-codex
    #     syncIntervalMs: 30000
    - id: codex-auth
      name: dsh-codex-auth
      config: {}
```

> 注意：`config:` 不能只跟注释——那会解析为 `null`（此前的启动报错
> `cannot get property "config" without inject` 即由此而来）。要么写 `config: {}`
> （用默认配置），要么把字段直接写在 `config:` 下（覆盖），注释放在行外。
