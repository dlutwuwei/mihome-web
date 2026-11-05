import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";
import type { ApiKeyRow, ApiKeyScope, AuditRow, CreatedKey } from "../types";
import { api, apiBearer, errorText } from "../utils/api";

const SCOPES: Array<{ id: ApiKeyScope; name: string; note: string }> = [
  { id: "devices:read", name: "读设备", note: "设备列表与详情" },
  { id: "devices:live", name: "读实时", note: "实时读数 / 状态" },
  { id: "devices:control", name: "可控制", note: "写属性、执行动作" },
];

const EXPIRY: Array<{ days: string; name: string }> = [
  { days: "0", name: "永久有效" },
  { days: "30", name: "30 天" },
  { days: "90", name: "90 天" },
  { days: "365", name: "一年" },
];

const TABS = [
  { id: "keys", name: "Key 管理" },
  { id: "audit", name: "调用记录" },
  { id: "guide", name: "接入指南" },
] as const;

type ManagerTab = typeof TABS[number]["id"];

const LEAVE_MS = 240;

/** 明文 Key 只返回一次，临时放到 sessionStorage 里方便本机自测。 */
const VAULT = "mihome.key.secret";

function vaultRead(): Record<string, string> {
  try {
    return JSON.parse(sessionStorage.getItem(VAULT) || "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

function vaultWrite(entries: Record<string, string>) {
  try {
    sessionStorage.setItem(VAULT, JSON.stringify(entries));
  } catch {
    /* 隐私模式下存不下就放弃自测能力 */
  }
}

function formatDate(value: number) {
  if (!value) return "—";
  const date = new Date(value);
  const pad = (input: number) => String(input).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function dayAgo(value: number) {
  if (!value) return "从未使用";
  const diff = Date.now() - value;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} 小时前`;
  return `${Math.round(diff / 86_400_000)} 天前`;
}

function scopeNames(scopes: ApiKeyScope[]) {
  return scopes.map((scope) => SCOPES.find((item) => item.id === scope)?.name || scope).join(" · ");
}

function keyState(key: ApiKeyRow): { text: string; tone: string } {
  if (!key.enabled) return { text: "已停用", tone: "off" };
  if (key.expiresAt && Date.now() > key.expiresAt) return { text: "已过期", tone: "off" };
  return { text: "启用中", tone: "on" };
}

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

export function ApiKeyManager({ anchorRef, onClose }: { anchorRef: RefObject<HTMLButtonElement>; onClose: () => void }) {
  const drawerRef = useRef<HTMLElement>(null);
  const closingTimer = useRef<number | null>(null);
  const [closing, setClosing] = useState(false);
  const [tab, setTab] = useState<ManagerTab>("keys");
  const [confirmation, setConfirmation] = useState<{ type: "revoke"; key: ApiKeyRow } | { type: "clear" } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [requests, setRequests] = useState<AuditRow[]>([]);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ApiKeyScope[]>(["devices:read", "devices:live"]);
  const [expiry, setExpiry] = useState("0");
  const [secret, setSecret] = useState("");
  const [secretFor, setSecretFor] = useState("");
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const data = await api<{ keys: ApiKeyRow[] }>("/api/keys");
      setKeys(data.keys || []);
      const audit = await api<{ requests: AuditRow[] }>(
        `/api/keys/audit/requests?limit=120${filter ? `&keyId=${encodeURIComponent(filter)}` : ""}`,
      );
      setRequests(audit.requests || []);
    } catch (err) {
      setError(errorText(err));
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const requestClose = useCallback(() => {
    if (closingTimer.current != null) return;
    setClosing(true);
    closingTimer.current = window.setTimeout(() => {
      closingTimer.current = null;
      onClose();
      anchorRef.current?.focus({ preventScroll: true });
    }, LEAVE_MS);
  }, [anchorRef, onClose]);

  useEffect(() => {
    const drawer = drawerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    drawer?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = previousOverflow;
      if (closingTimer.current != null) window.clearTimeout(closingTimer.current);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
        return;
      }
      if (event.key !== "Tab") return;
      const drawer = drawerRef.current;
      if (!drawer) return;
      const focusable = Array.from(drawer.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.getClientRects().length > 0);
      if (!focusable.length) {
        event.preventDefault();
        drawer.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === drawer)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || active === drawer)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [requestClose]);

  function selectTab(next: ManagerTab) {
    setTab(next);
    setConfirmation(null);
    setError("");
    setNotice("");
  }

  function onTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % TABS.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = TABS.length - 1;
    else return;
    event.preventDefault();
    const id = TABS[next].id;
    selectTab(id);
    document.getElementById(`key-tab-${id}`)?.focus();
  }

  async function create() {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const data = await api<CreatedKey>("/api/keys", {
        method: "POST",
        body: { name, scopes, expiresInDays: Number(expiry) },
      });
      setSecret(data.secret);
      setSecretFor(data.key.id);
      const entries = vaultRead();
      entries[data.key.id] = data.secret;
      vaultWrite(entries);
      setName("");
      await load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(key: ApiKeyRow) {
    setError("");
    try {
      await api(`/api/keys/${key.id}/enabled`, { method: "POST", body: { enabled: !key.enabled } });
      await load();
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function revoke(key: ApiKeyRow) {
    if (confirmBusy) return;
    setError("");
    setConfirmBusy(true);
    try {
      await api(`/api/keys/${key.id}`, { method: "DELETE" });
      const entries = vaultRead();
      delete entries[key.id];
      vaultWrite(entries);
      if (secretFor === key.id) setSecret("");
      setConfirmation(null);
      await load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setConfirmBusy(false);
    }
  }

  async function test(key: ApiKeyRow) {
    setError("");
    setNotice("");
    const value = vaultRead()[key.id];
    if (!value) {
      setError("本地没有保存该 Key 的明文，明文只在创建时展示一次。");
      return;
    }
    try {
      const data = await apiBearer<{ keyName: string; scopes: ApiKeyScope[] }>("/api/open/info", value);
      setNotice(`自测通过：${data.keyName} · ${scopeNames(data.scopes)}`);
      await load();
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function clearAudit() {
    if (confirmBusy) return;
    setError("");
    setConfirmBusy(true);
    try {
      await api("/api/keys/audit/clear", { method: "POST", body: {} });
      setConfirmation(null);
      await load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setConfirmBusy(false);
    }
  }

  const origin = window.location.origin;

  return (
    <div
      className={closing ? "key-drawer-mask leave" : "key-drawer-mask"}
      onClick={(event) => { if (event.target === event.currentTarget) requestClose(); }}
    >
      <aside
        ref={drawerRef}
        id="api-key-drawer"
        className={closing ? "keys leave" : "keys"}
        role="dialog"
        aria-modal="true"
        aria-labelledby="api-key-title"
        tabIndex={-1}
      >
        <header className="keys-head">
          <div>
            <p className="brand">设备信息分发</p>
            <h2 id="api-key-title">开放接口与 API Key</h2>
            <p className="sub">为其它应用提供受控的设备数据访问。</p>
          </div>
          <button type="button" className="text keys-close" onClick={requestClose}>关闭</button>
        </header>

        <nav className="key-tabs" role="tablist" aria-label="设备信息分发功能">
          {TABS.map((item, index) => (
            <button
              type="button"
              role="tab"
              id={`key-tab-${item.id}`}
              key={item.id}
              className={tab === item.id ? "on" : ""}
              aria-selected={tab === item.id}
              aria-controls={`key-panel-${item.id}`}
              tabIndex={tab === item.id ? 0 : -1}
              onClick={() => selectTab(item.id)}
              onKeyDown={(event) => onTabKeyDown(event, index)}
            >
              {item.name}
            </button>
          ))}
        </nav>

        <div className="key-drawer-body">
          {error || notice ? (
            <div className="key-feedback" aria-live="polite">
              {error ? <p className="err">{error}</p> : <p className="hint left">{notice}</p>}
            </div>
          ) : null}

          {tab === "keys" ? (
            <div id="key-panel-keys" className="key-panel" role="tabpanel" aria-labelledby="key-tab-keys">
              <section className="key-section key-create">
                <div className="key-section-head">
                  <div>
                    <p className="kicker">新建访问凭证</p>
                    <h3>创建 API Key</h3>
                  </div>
                </div>
                <div className="key-form">
                  <div className="key-form-grid">
                    <label>
                      名称
                      <input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：客厅中控屏" maxLength={40} />
                    </label>
                    <label>
                      有效期
                      <select value={expiry} onChange={(event) => setExpiry(event.target.value)}>
                        {EXPIRY.map((item) => <option key={item.days} value={item.days}>{item.name}</option>)}
                      </select>
                    </label>
                  </div>
                  <p className="kicker inline">权限范围</p>
                  <div className="chips">
                    {SCOPES.map((item) => (
                      <button
                        type="button"
                        key={item.id}
                        className={scopes.includes(item.id) ? "on" : ""}
                        aria-pressed={scopes.includes(item.id)}
                        onClick={() => setScopes((prev) => (prev.includes(item.id) ? prev.filter((id) => id !== item.id) : [...prev, item.id]))}
                      >
                        <b>{item.name}</b>
                        <span>{item.note}</span>
                      </button>
                    ))}
                  </div>
                  <div className="key-foot">
                    <p>明文 Key 仅在创建后展示一次。</p>
                    <button type="button" className="primary compact" disabled={!name.trim() || !scopes.length || busy} onClick={() => void create()}>
                      {busy ? "正在生成" : "生成 Key"}
                    </button>
                  </div>
                </div>
                {secret ? (
                  <div className="secret">
                    <p className="label">明文 Key（仅显示这一次，请立即保存）</p>
                    <p className="secret-value">{secret}</p>
                    <div className="print-actions">
                      <button
                        type="button"
                        className="action"
                        onClick={async () => setNotice(await copyText(secret) ? "已复制到剪贴板" : "复制失败，请手动选中复制")}
                      >
                        复制
                      </button>
                      <button type="button" className="cancel" onClick={() => { setSecret(""); setSecretFor(""); }}>知道了</button>
                    </div>
                  </div>
                ) : null}
              </section>

              <section className="key-section">
                <div className="key-section-head">
                  <div>
                    <p className="kicker">访问凭证</p>
                    <h3>已创建的 Key</h3>
                  </div>
                  <span className="key-count">{keys.length} 个</span>
                </div>
                <div className="key-list">
                  {keys.length ? keys.map((key) => {
                    const state = keyState(key);
                    return (
                      <div className="key-item" key={key.id}>
                        <div className="key-head">
                          <b>{key.name}</b>
                          <code title={key.prefix}>{key.prefix}</code>
                          <span className={`key-state ${state.tone}`}>{state.text}</span>
                        </div>
                        <p className="key-meta">
                          {scopeNames(key.scopes)} · {key.requestCount} 次调用 · {dayAgo(key.lastUsedAt)}
                          {key.expiresAt ? ` · 到期 ${formatDate(key.expiresAt)}` : ""}
                        </p>
                        {confirmation?.type === "revoke" && confirmation.key.id === key.id ? (
                          <div className="inline-confirm" role="alert">
                            <p>撤销「{key.name}」后，使用该 Key 的应用会立即失效。</p>
                            <div>
                              <button type="button" className="text" disabled={confirmBusy} onClick={() => setConfirmation(null)}>取消</button>
                              <button type="button" className="text danger" disabled={confirmBusy} onClick={() => void revoke(key)}>
                                {confirmBusy ? "正在撤销" : "确认撤销"}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="key-actions">
                            <button type="button" className="text" onClick={() => void test(key)}>自测</button>
                            <button type="button" className="text" onClick={() => void toggle(key)}>{key.enabled ? "停用" : "启用"}</button>
                            <button type="button" className="text danger" onClick={() => setConfirmation({ type: "revoke", key })}>撤销</button>
                          </div>
                        )}
                      </div>
                    );
                  }) : <p className="key-empty">还没有 Key，使用上方表单创建第一个访问凭证。</p>}
                </div>
              </section>
            </div>
          ) : null}

          {tab === "audit" ? (
            <div id="key-panel-audit" className="key-panel" role="tabpanel" aria-labelledby="key-tab-audit">
              <section className="key-section audit">
                <div className="key-section-head">
                  <div>
                    <p className="kicker">接口活动</p>
                    <h3>最近调用记录</h3>
                  </div>
                  <div className="audit-actions">
                    <button type="button" className="text" onClick={() => void load()}>刷新</button>
                    <button type="button" className="text danger" disabled={!requests.length} onClick={() => setConfirmation({ type: "clear" })}>清空</button>
                  </div>
                </div>
                <label className="audit-filter">
                  按 Key 筛选
                  <select value={filter} onChange={(event) => setFilter(event.target.value)}>
                    <option value="">全部 Key</option>
                    {keys.map((key) => <option key={key.id} value={key.id}>{key.name}</option>)}
                  </select>
                </label>
                {confirmation?.type === "clear" ? (
                  <div className="inline-confirm audit-confirm" role="alert">
                    <p>清空本账号的全部接口调用记录？</p>
                    <div>
                      <button type="button" className="text" disabled={confirmBusy} onClick={() => setConfirmation(null)}>取消</button>
                      <button type="button" className="text danger" disabled={confirmBusy} onClick={() => void clearAudit()}>
                        {confirmBusy ? "正在清空" : "确认清空"}
                      </button>
                    </div>
                  </div>
                ) : null}
                <div className="audit-table">
                  <div className="audit-row audit-columns" aria-hidden="true">
                    <span>时间</span><span>Key</span><span>方法</span><span>接口</span><span>状态</span><span>耗时</span><span>IP</span>
                  </div>
                  <ul className="audit-list">
                    {requests.slice(0, 60).map((row, index) => (
                      <li className="audit-row" key={`${row.time}-${index}`}>
                        <span className="t">{formatDate(row.time)}</span>
                        <span className="n" title={row.keyName}>{row.keyName}</span>
                        <span className="m">{row.method}</span>
                        <span className="p" title={row.path}>{row.path}</span>
                        <span className={`s ${row.status < 400 ? "ok" : "bad"}`}>{row.status}</span>
                        <span className="c">{row.ms}ms</span>
                        <span className="i" title={row.message || ""}>{row.ip}</span>
                      </li>
                    ))}
                    {!requests.length ? <li className="key-empty">暂无调用记录。</li> : null}
                  </ul>
                </div>
                <p className="hint left audit-note">最多显示最近 60 条记录。</p>
              </section>
            </div>
          ) : null}

          {tab === "guide" ? (
            <div id="key-panel-guide" className="key-panel" role="tabpanel" aria-labelledby="key-tab-guide">
              <section className="key-section guide-intro">
                <p className="kicker">应用接入</p>
                <h3>通过开放接口访问设备</h3>
                <p className="sub">先在“Key 管理”中创建访问凭证，再将凭证放入请求头调用 <code>/api/open</code> 接口。</p>
              </section>
              <section className="key-section usage">
                <div className="usage-step">
                  <p className="kicker">步骤 1</p>
                  <h3>设置请求头</h3>
                  <p>每个请求都携带 Bearer 凭证，不要将 Key 放在公开网页或代码仓库中。</p>
                  <pre>{`Authorization: Bearer <API Key>`}</pre>
                </div>
                <div className="usage-step">
                  <p className="kicker">步骤 2</p>
                  <h3>调用设备接口</h3>
                  <pre>{`GET  ${origin}/api/open/devices
GET  ${origin}/api/open/devices/:accountId/:did
GET  ${origin}/api/open/devices/:accountId/:did/props
POST ${origin}/api/open/devices/:accountId/:did/props
POST ${origin}/api/open/devices/:accountId/:did/actions
GET  ${origin}/api/open/live`}</pre>
                </div>
                <div className="usage-step">
                  <p className="kicker">权限说明</p>
                  <ul className="scope-guide">
                    {SCOPES.map((item) => <li key={item.id}><b>{item.name}</b><span>{item.note}</span></li>)}
                  </ul>
                </div>
              </section>
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
