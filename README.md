# dsh-codex-auth

利用本机 Codex CLI 的 ChatGPT 登录凭据（`~/.codex/auth.json`），让 DeepSeek Harness 通过
`llm-pi-ai` 的 `openai-codex` 路由直接调用 GPT 模型（`gpt-5.6-sol` / `gpt-5.6-terra` / `gpt-5.6-luna`）。

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

1. **复制/打包本目录**（`package.json` + `index.js` + `cordis.patch.yml` 三个文件即可，
   或整个 `dsh-codex-auth` 目录）。
2. 在该机器上安装到目标 profile：
   ```powershell
   dsh plugin --profile <name> add file:<路径>\dsh-codex-auth
   ```
3. 该机器需已登录 Codex CLI（`codex login` 或使用过 Codex CLI，产生 `~/.codex/auth.json`）。
4. 重启该 profile 的 DSH 服务。插件自动：
   - 把本机 Codex 凭据桥接进 `llm-pi-ai/openai-codex`；
   - 注册 `openai-codex` 路由（八个模型：四本体 + 四个 `-1m` 副本、小写名称、五档思考强度、
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

- 八个模型：`gpt-5.6-sol` / `gpt-5.6-terra` / `gpt-5.6-luna` / `gpt-6-astra` 及各自 `-1m` 呈现副本
  （`gpt-6-astra-1m` 与五个 5.6 模型的本体/副本结构一致；**全部八个模型均声明
  `contextWindow: 1000000`、`maxTokens: 128000`**；线缆上把 `-1m` 重映射回本体模型）；
- 显示名统一小写 id 风格（覆盖 catalog 默认的 "GPT-5.6 Sol" 式命名）；
- 全部八个模型显式声明图片输入（`input: [ text, image ]`）——`gpt-5.6-*` 本体虽可从
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

- `gpt-5.6-sol-1m` / `gpt-5.6-terra-1m` / `gpt-5.6-luna-1m` / `gpt-6-astra-1m` 是四个模型的
  **呈现副本**：选择器中显示为独立模型，声明与本体一致（`contextWindow: 1000000`、
  `maxTokens: 128000`、图片输入、推理档位 low/medium/high/xhigh/max）。
- **实际调用与本体相同**：pi-ai 把 `model.id` 原样发给 chatgpt.com，因此插件在
  `llm/stream` Waterfall 上把 `*-1m` 重映射回本体（用**新的** options 对象替换请求，
  从不修改深冻结的请求对象）——后端始终收到 `gpt-5.6-sol`，界面看到的是
  `gpt-5.6-sol-1m`。
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

- 给全部八个模型（含本体）声明 `contextWindow: 1000000` / `maxTokens: 128000`，
  使判定容量与模型真实能力（及 `-1m` 呈现声明）一致——这是消除误报的根本修复；
- `retryableCodes` 追加 `CONTEXT_WINDOW_EXCEEDED`：在 web profile 无压缩恢复的
  前提下，给这类失败同样的 5 次 × 10 秒重试兜底（观察到重试可成功；若为真实
  溢出，5 次耗尽后仍会以服务端真实错误结束本轮）。

> 注：在有 compaction-basic 自动压缩的 profile（非 web）中，本策略的恢复点
> （llm-retry）先于压缩恢复点运行；如需保留「先压缩再重试」的平台默认行为，
> 可从 `retryableCodes` 中移除 `CONTEXT_WINDOW_EXCEEDED`。

## 使用

- Web 界面的模型选择器中会出现 `OpenAI Codex` 提供方及八个模型
  （`gpt-5.6-sol` / `gpt-5.6-terra` / `gpt-5.6-luna` / `gpt-6-astra` 及各自 `-1m` 副本），按需选择。
- 默认 agent 模型保持 `deepseek-v4-flash-vision-exp` 不变（除非你另外修改
  `agent-default-model` 设置）。
- 插件日志里每次同步会打印 `[dsh-codex-auth] synced codex OAuth credential ...` 与
  路由模型清单，便于确认。

## 验证

```powershell
# 确认凭据记录已写入（不显示令牌值）：
Select-String -Path C:\Users\wyj\.dsh\.credentials.yaml -Pattern "llm-pi-ai/openai-codex"
```

在模型选择器里切到 `gpt-5.6-sol` 发一条消息即可。若报认证错误，先运行 `codex login`。

## 卸载

**第一步：从 profile 移除插件（并重启）**

```powershell
# 在 profile 目录（C:\Users\wyj\.dsh\profiles\web）：
dsh plugin --profile web remove dsh-codex-auth
# 然后重启 dsh web 服务
```

`remove` 会卸载包并从 `dsh.profile.bundles` 移除 `dsh-codex-auth`。重启后：

- `codex-auth` 桥（凭据同步、`-1m` 重映射）停止；
- `llm-pi-ai` 组合行回落到 dsh-base 的休眠态，`openai-codex` 路由与 6 个模型
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

| 字段 | 默认 | 说明 |
|---|---|---|
| `authPath` | `%USERPROFILE%\.codex\auth.json` | Codex 认证文件路径 |
| `recordKey` | `llm-pi-ai/openai-codex` | 写入的 DSH 凭据记录键 |
| `syncIntervalMs` | `30000` | 同步间隔 |

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
