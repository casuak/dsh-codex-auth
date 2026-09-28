/* Packaged DSH browser entry: loaded by the existing ModuleLoader, not Node. */
window.__ModuleLoader__.load({
  id: 'dsh-codex-auth',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    /** Host entry id whose row owns the proxy fields (the `codex-auth` row id). */
    const ENTRY_ID = 'codex-auth';
    /** Registered namespace the proxy fields live in (the same entry id). */
    const PROXY_NAMESPACE = 'dsh-codex-auth';
    /** Bundle name and row id the Plugins page keys this bundle's rows by. */
    const BUNDLE = 'dsh-codex-auth';
    const ROW_KEY = `${BUNDLE}#${ENTRY_ID}`;
    /** The adapter row whose `openai-codex` model capacities the second card edits. */
    const MODELS_NAMESPACE = 'llm-pi-ai';
    const MODELS_ROW_KEY = '@deepseek-ai/dsh-llm-pi-ai#llm-pi-ai';
    const MODEL_ROUTE = 'openai-codex';

    // Current client services: the former `settingsScope` service and
    // `settings.plugin.item` slot no longer exist, and a client half that
    // injects them stays "pending (waiting for service: …)" forever.
    const inject = ['slots', 'configForms'];

    const values = (snapshot) => ({
      proxyEnabled: typeof snapshot.value?.proxyEnabled === 'boolean' ? snapshot.value.proxyEnabled : true,
      proxyUrl: typeof snapshot.value?.proxyUrl === 'string' ? snapshot.value.proxyUrl : '',
    });
    const modelsOf = (snapshot) => snapshot.value?.providers?.[MODEL_ROUTE]?.models || [];
    const canWrite = (snapshot) => snapshot.status === 'ready' && snapshot.writable && snapshot.mode === 'host';
    /** Subscribe one entry form to React. */
    const useForm = (form) => React.useSyncExternalStore(
      (listener) => form.subscribe(listener),
      () => form.getSnapshot(),
      () => form.getSnapshot(),
    );
    /**
     * One shape for both form faces: the Plugins page hands a row page
     * `{ state, mutate }`, while the config-forms service hands a `ConfigForm`
     * whose methods and snapshot carry the same names.
     */
    const asForm = (form) => (form && typeof form.getSnapshot === 'function')
      ? { getSnapshot: () => form.getSnapshot(), subscribe: (l) => form.subscribe(l), mutate: (ops, revision) => form.mutate(ops, revision) }
      : form;
    // Native colors inherit the current page scheme; no private theme tokens.
    const controlStyle = { font: 'inherit', color: 'inherit', background: 'transparent', border: '1px solid currentColor', borderRadius: 8, padding: '8px 12px' };

    /** The proxy fields of this plugin's own row. */
    function ProxyCard(props) {
      const form = asForm(props.form || props.forms.get(PROXY_NAMESPACE));
      const snapshot = useForm(form);
      const [draft, setDraft] = React.useState(null);
      const [saving, setSaving] = React.useState(false);
      const [message, setMessage] = React.useState(null);
      const busy = React.useRef(false);
      const mounted = React.useRef(true);
      React.useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
      }, []);
      const current = draft || values(snapshot);
      const disabled = saving || !canWrite(snapshot);
      const change = (field, value) => {
        if (disabled) return;
        setDraft((previous) => ({ ...(previous || { ...values(snapshot), revision: snapshot.revision }), [field]: value }));
        setMessage(null);
      };
      const save = async (event) => {
        event.preventDefault();
        if (busy.current || !draft || !canWrite(snapshot)) return;
        busy.current = true;
        setSaving(true);
        setMessage(null);
        try {
          // `mutate` answers acceptance; a stale revision is refused, not thrown.
          const accepted = await form.mutate([
            { op: 'set', path: ['proxyEnabled'], value: draft.proxyEnabled },
            { op: 'set', path: ['proxyUrl'], value: draft.proxyUrl },
          ], draft.revision);
          if (!mounted.current) return;
          if (accepted === false) {
            setMessage({ error: true, text: '保存未生效，设置可能已被其他页面修改。请重新载入后再试。' });
          } else {
            setDraft(null);
            setMessage({ error: false, text: '已保存，新请求将立即使用此设置。' });
          }
        } catch {
          if (mounted.current) setMessage({ error: true, text: '保存失败，请检查连接后重试。' });
        } finally {
          busy.current = false;
          if (mounted.current) setSaving(false);
        }
      };
      const hint = snapshot.status === 'loading' ? '正在加载设置…'
        : snapshot.status === 'unavailable' ? '设置暂不可用，请确认主机已启用 dsh-codex-auth。'
          : !canWrite(snapshot) ? '当前连接为只读，无法保存到主机。' : null;
      return h('li', { style: { listStyle: 'none', border: '1px solid currentColor', borderRadius: 12, padding: 16, minWidth: 0 } },
        h('form', { onSubmit: save, 'aria-label': 'dsh-codex-auth 代理设置', style: { display: 'grid', gap: 14 } },
          h('strong', { style: { fontSize: 15 } }, 'dsh-codex-auth'),
          h('p', { style: { margin: 0, fontSize: 13, lineHeight: 1.6 } }, '配置 Codex 请求代理。保存后实时生效，无需重启。'),
          h('label', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h('input', { type: 'checkbox', role: 'switch', checked: current.proxyEnabled, disabled, onChange: (event) => change('proxyEnabled', event.target.checked) }),
            '启用代理'),
          h('label', { style: { display: 'grid', gap: 8 } }, '代理地址',
            h('input', { type: 'text', value: current.proxyUrl, disabled, placeholder: '例如：http://127.0.0.1:7890', autoComplete: 'off', spellCheck: false, style: { ...controlStyle, width: '100%', boxSizing: 'border-box', minWidth: 0 }, onChange: (event) => change('proxyUrl', event.target.value) })),
          h('p', { style: { margin: 0, fontSize: 12, lineHeight: 1.6 } }, '支持 HTTP/HTTPS 地址，留空自动检测系统或环境变量代理。默认启用；关闭后恢复原连接方式。不支持 SOCKS/PAC。'),
          hint ? h('p', { role: 'status', style: { margin: 0 } }, hint) : null,
          message ? h('p', { role: message.error ? 'alert' : 'status', style: { margin: 0 } }, message.text) : null,
          h('div', { style: { display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 8 } },
            h('button', { type: 'button', disabled: saving || !draft, style: controlStyle, onClick: () => { setDraft(null); setMessage(null); } }, '重新载入'),
            h('button', { type: 'submit', disabled: disabled || !draft, style: controlStyle }, saving ? '保存中…' : '保存'))));
    }

    /** The `openai-codex` model capacities, edited on the adapter's own row. */
    function ModelCard(props) {
      const form = asForm(props.form || props.forms.get(MODELS_NAMESPACE));
      const snapshot = useForm(form);
      const [draft, setDraft] = React.useState(null);
      const [saving, setSaving] = React.useState(false);
      const [message, setMessage] = React.useState(null);
      const busy = React.useRef(false);
      const mounted = React.useRef(true);
      React.useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
      }, []);
      const models = modelsOf(snapshot);
      const rows = draft?.rows || models.map(model => ({ id: model.id, value: model.contextWindow === undefined ? '' : String(model.contextWindow) }));
      const disabled = saving || !canWrite(snapshot);
      const invalid = rows.some(row => row.value.trim() !== '' && (!/^\d+$/.test(row.value.trim()) || !Number.isSafeInteger(Number(row.value)) || Number(row.value) < 1));
      const change = (index, value) => {
        if (disabled) return;
        setDraft({ revision: draft?.revision ?? snapshot.revision, rows: rows.map((row, i) => i === index ? { ...row, value } : row) });
        setMessage(null);
      };
      const save = async (event) => {
        event.preventDefault();
        if (busy.current || !draft || invalid || !canWrite(snapshot)) return;
        const latest = form.getSnapshot();
        if (latest.revision !== draft.revision) {
          setMessage({ error: true, text: '模型配置已被其他页面修改，请重新载入后再试。' });
          return;
        }
        // Arrays replace wholesale in settings. Keep every existing model field;
        // only change contextWindow, and guard the write with the draft revision.
        const next = modelsOf(latest).map((model, index) => {
          const row = draft.rows[index];
          const result = { ...model };
          if (row.value.trim() === '') delete result.contextWindow;
          else result.contextWindow = Number(row.value);
          return result;
        });
        busy.current = true;
        setSaving(true);
        setMessage(null);
        try {
          const accepted = await form.mutate([{ op: 'set', path: ['providers', MODEL_ROUTE, 'models'], value: next }], draft.revision);
          if (!mounted.current) return;
          if (accepted === false) {
            setMessage({ error: true, text: '模型配置已被其他页面修改，请重新载入后再试。' });
            return;
          }
          const landed = form.getSnapshot();
          const actual = modelsOf(landed);
          if (landed.status !== 'ready' || actual.length !== next.length || next.some((model, i) => actual[i]?.id !== model.id || actual[i]?.contextWindow !== model.contextWindow)) {
            setMessage({ error: true, text: '保存未生效，请检查模型配置并重新载入后再试。' });
          } else {
            setDraft(null);
            setMessage({ error: false, text: '已保存，后续模型请求将使用新的 contextWindow。' });
          }
        } catch {
          if (mounted.current) setMessage({ error: true, text: '保存失败，请检查连接和模型配置后重试。' });
        } finally {
          busy.current = false;
          if (mounted.current) setSaving(false);
        }
      };
      return h('li', { style: { listStyle: 'none', border: '1px solid currentColor', borderRadius: 12, padding: 16, minWidth: 0 } },
        h('form', { onSubmit: save, 'aria-label': 'dsh-codex-auth 模型上下文设置', style: { display: 'grid', gap: 14 } },
          h('strong', null, 'dsh-codex-auth · 模型上下文'),
          h('p', { style: { margin: 0, fontSize: 13 } }, '按模型设置 contextWindow（token 数）。填写正整数，留空使用模型目录或提供方默认值；不会提高服务端实际限制。'),
          ...rows.map((row, index) => h('label', { key: row.id, style: { display: 'grid', gap: 8 } }, row.id,
            h('input', { type: 'number', min: 1, max: Number.MAX_SAFE_INTEGER, step: 1, value: row.value, disabled, 'aria-label': `${row.id} contextWindow`, placeholder: '使用模型目录或提供方默认值', style: { ...controlStyle, width: '100%', boxSizing: 'border-box' }, onChange: event => change(index, event.target.value) }))),
          snapshot.status !== 'ready' ? h('p', { role: 'status' }, '模型设置暂不可用或正在加载，请确认 llm-pi-ai 已启用。')
            : !canWrite(snapshot) ? h('p', { role: 'status' }, '当前连接为只读，无法保存到主机。')
              : !rows.length ? h('p', { role: 'status' }, '未找到 openai-codex 的已配置模型。') : null,
          invalid ? h('p', { role: 'alert' }, 'contextWindow 必须为正整数或留空。') : null,
          message ? h('p', { role: message.error ? 'alert' : 'status' }, message.text) : null,
          h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } },
            h('button', { type: 'button', disabled: saving || !draft, style: controlStyle, onClick: () => { setDraft(null); setMessage(null); } }, '重新载入'),
            h('button', { type: 'submit', disabled: disabled || !draft || invalid, style: controlStyle }, saving ? '保存中…' : '保存'))));
    }

    /** Supply the config-forms service to a card as the transient `forms` prop. */
    const withForms = (ctx, Card) => function Contribution(props) {
      return h(Card, { ...props, forms: ctx.configForms });
    };

    function apply(ctx) {
      // Each page lives on the row whose config it edits: the plugin's own row
      // carries the proxy fields, and the adapter's row carries the capacities.
      ctx.slots.inject('plugins.row.config', () => ctx.slots.register(
        { name: 'plugins.row.config', key: ROW_KEY },
        withForms(ctx, ProxyCard),
      ));
      ctx.slots.inject('plugins.row.config', () => ctx.slots.register(
        { name: 'plugins.row.config', key: MODELS_ROW_KEY },
        withForms(ctx, ModelCard),
      ));
    }

    return { inject, apply };
  },
});
