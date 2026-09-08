/* Packaged DSH browser entry: loaded by the existing ModuleLoader, not Node. */
window.__ModuleLoader__.load({
  id: 'dsh-codex-auth',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const namespace = 'dsh-codex-auth';
    const values = (snapshot) => ({
      proxyEnabled: typeof snapshot.value?.proxyEnabled === 'boolean' ? snapshot.value.proxyEnabled : true,
      proxyUrl: typeof snapshot.value?.proxyUrl === 'string' ? snapshot.value.proxyUrl : '',
    });
    const canWrite = (snapshot) => snapshot.status === 'ready' && snapshot.writable && snapshot.mode === 'host';
    // Native colors inherit the current page scheme; no private theme tokens.
    const controlStyle = { font: 'inherit', color: 'inherit', background: 'transparent', border: '1px solid currentColor', borderRadius: 8, padding: '8px 12px' };

    return {
      inject: ['slots', 'settingsScope'],
      apply(ctx) {
        // bind owns its subscription/disposal on the consumer's Cordis fiber.
        const scope = ctx.settingsScope.bind({ namespace });
        const subscribe = (listener) => scope.subscribe(listener);
        const getSnapshot = () => scope.getSnapshot();

        function Card() {
          const snapshot = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
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
            if (busy.current || !draft || !canWrite(scope.getSnapshot())) return;
            busy.current = true;
            setSaving(true);
            setMessage(null);
            try {
              await scope.mutate([
                { op: 'set', path: ['proxyEnabled'], value: draft.proxyEnabled },
                { op: 'set', path: ['proxyUrl'], value: draft.proxyUrl },
              ], draft.revision);
              if (!mounted.current) return;
              // A rejected Host response can resolve after recovery, not throw.
              const latest = scope.getSnapshot();
              const landed = values(latest);
              if (latest.status !== 'ready' || landed.proxyEnabled !== draft.proxyEnabled || landed.proxyUrl !== draft.proxyUrl) {
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

        ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({ name: 'settings.plugin.item', key: namespace }, Card));
      },
    };
  },
});
