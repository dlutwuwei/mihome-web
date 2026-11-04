import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DevicePanel, type PrintOptions } from "../components/DevicePanel";
import { VendorLogin } from "../components/VendorLogin";
import type { Account, Device, DeviceAction, DeviceDetail, DeviceProp, LiveChip, PropValue, VendorInfo } from "../types";
import { api, apiForm, errorText } from "../utils/api";
import { deviceKey, devicePath, mergeLive } from "../utils/device";
import { climatePlace, climateView, isClimate, placeOf, runningView, shortVendor, summarize } from "../utils/present";

const LIVE_MS = 8000;
const STATUS_MS = 5 * 60 * 1000;

export function Home({
  accounts,
  vendors,
  onAccounts,
}: {
  accounts: Account[];
  vendors: VendorInfo[];
  onAccounts: (accounts: Account[]) => void;
}) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [room, setRoom] = useState("全部");
  const [vendor, setVendor] = useState("全部");
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<DeviceDetail | null>(null);
  const [current, setCurrent] = useState<{ accountId: string; did: string } | null>(null);
  const [error, setError] = useState("");
  const [relogin, setRelogin] = useState<Account | null>(null);
  const detailSeq = useRef(0);
  const accountKey = accounts.map((account) => account.accountId).join(",");

  const loadDevices = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const data = await api<{ devices: Device[] }>("/api/devices");
      setDevices(data.devices || []);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const checkStatuses = useCallback(async () => {
    try {
      const data = await api<{ accounts: Account[] }>("/api/accounts/status");
      onAccounts(data.accounts || []);
    } catch {
      /* 检查失败时保留已有状态，下一轮再试 */
    }
  }, [onAccounts]);

  useEffect(() => {
    if (!accountKey) return undefined;
    let stop = false;
    let inflight = false;

    async function tick() {
      if (stop || inflight || document.hidden) return;
      inflight = true;
      try {
        await checkStatuses();
      } finally {
        inflight = false;
      }
    }

    void tick();
    const timer = window.setInterval(() => {
      void tick();
    }, STATUS_MS);
    function onVisible() {
      if (!document.hidden) void tick();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stop = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [accountKey, checkStatuses]);

  useEffect(() => {
    if (!accounts.length) {
      setDevices([]);
      setError("");
      setLoading(false);
      return undefined;
    }
    let stop = false;
    let inflight = false;
    void loadDevices();

    async function tick() {
      if (stop || inflight || document.hidden) return;
      inflight = true;
      try {
        const data = await api<{ live: Record<string, LiveChip[]> }>("/api/devices/live");
        if (!stop) setDevices((prev) => mergeLive(prev, data.live || {}));
      } catch {
        /* 下一轮再读 */
      } finally {
        inflight = false;
      }
    }

    const timer = window.setInterval(() => {
      void tick();
    }, LIVE_MS);
    function onVisible() {
      if (!document.hidden) void tick();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stop = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [loadDevices, accountKey]);

  async function openDevice(device: Device) {
    const seq = ++detailSeq.current;
    setCurrent({ accountId: device.accountId, did: device.did });
    setError("");
    try {
      const next = await api<DeviceDetail>(devicePath(device.accountId, device.did));
      if (seq !== detailSeq.current) return;
      setDetail(next);
    } catch (err) {
      if (seq !== detailSeq.current) return;
      setError(errorText(err));
      setDetail({ device, services: [] });
    }
  }

  function closePanel() {
    detailSeq.current += 1;
    setDetail(null);
    setError("");
  }

  async function refreshDetail(target: { accountId: string; did: string }, seq: number) {
    const next = await api<DeviceDetail>(devicePath(target.accountId, target.did));
    if (seq !== detailSeq.current) return;
    setDetail(next);
  }

  async function setProp(prop: DeviceProp, value: PropValue) {
    const target = current;
    const seq = detailSeq.current;
    if (!target) return;
    setError("");
    try {
      await api(`${devicePath(target.accountId, target.did)}/prop`, {
        method: "POST",
        body: { siid: prop.siid, piid: prop.piid, value },
      });
      if (seq !== detailSeq.current) return;
      await refreshDetail(target, seq);
    } catch (err) {
      if (seq === detailSeq.current) setError(errorText(err));
    }
  }

  async function uploadPrint(file: File, options: PrintOptions) {
    const target = current;
    const seq = detailSeq.current;
    if (!target) return;
    setError("");
    const body = new FormData();
    body.append("file", file);
    body.append("copies", String(options.copies));
    body.append("mode", options.mode);
    body.append("duplex", options.duplex);
    body.append("collate", options.collate);
    body.append("paperSize", options.paperSize);
    body.append("paperType", options.paperType);
    body.append("feeder", options.feeder);
    try {
      await apiForm(`${devicePath(target.accountId, target.did)}/print`, body);
      if (seq !== detailSeq.current) return;
      await refreshDetail(target, seq);
    } catch (err) {
      if (seq === detailSeq.current) setError(errorText(err));
      throw err;
    }
  }

  async function runAction(action: DeviceAction) {
    const target = current;
    const seq = detailSeq.current;
    if (!target) return;
    setError("");
    try {
      await api(`${devicePath(target.accountId, target.did)}/action`, {
        method: "POST",
        body: { siid: action.siid, aiid: action.aiid },
      });
      if (seq !== detailSeq.current) return;
      await refreshDetail(target, seq);
    } catch (err) {
      if (seq === detailSeq.current) setError(errorText(err));
    }
  }

  async function unlink(accountId: string) {
    setError("");
    try {
      const data = await api<{ accounts: Account[] }>("/api/logout", { method: "POST", body: { accountId } });
      onAccounts(data.accounts);
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function logout() {
    setError("");
    try {
      await api("/api/logout", { method: "POST", body: {} });
      onAccounts([]);
    } catch (err) {
      setError(errorText(err));
    }
  }

  function vendorName(id?: string) {
    return vendors.find((item) => item.id === id)?.name || id || "";
  }

  function accountView(account: Account) {
    const status = account.status;
    if (!status || !status.checkedAt) {
      return { state: "unknown" as const, text: "检查中", title: "正在确认登录状态" };
    }
    if (status.state === "ok") return { state: "ok" as const, text: "正常", title: "登录状态正常" };
    if (status.state === "expired") {
      return { state: "expired" as const, text: "登录已失效", title: status.message || "请重新登录" };
    }
    return { state: "unknown" as const, text: "无法确认", title: status.message || "暂时无法确认登录状态" };
  }

  function accountLabel(account: Account) {
    const id = account.userId || "";
    if (!id) return "未知账号";
    if (/^1\d{10}$/.test(id)) return `${id.slice(0, 3)}****${id.slice(-4)}`;
    if (/^\d+$/.test(id)) return `ID …${id.slice(-4)}`;
    if (id.length > 10) return `${id.slice(0, 4)}…${id.slice(-4)}`;
    return id;
  }

  function openRelogin(account: Account) {
    setRelogin(account);
    setAdding(true);
  }

  function openAdd() {
    setRelogin(null);
    setAdding(true);
  }

  function closeLogin() {
    setAdding(false);
    setRelogin(null);
  }

  const vendorIds = useMemo(() => {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const account of accounts) {
      if (seen.has(account.vendorId)) continue;
      seen.add(account.vendorId);
      ids.push(account.vendorId);
    }
    for (const device of devices) {
      const id = device.vendorId || "";
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    return ids;
  }, [accounts, devices]);

  const activeVendor = vendor === "全部" || vendorIds.includes(vendor) ? vendor : "全部";
  const vendorScoped = devices.filter((device) => activeVendor === "全部" || device.vendorId === activeVendor);
  const roomNames = useMemo(() => {
    const names: string[] = [];
    const seen = new Set<string>();
    for (const device of vendorScoped) {
      if (!device.room || seen.has(device.room)) continue;
      seen.add(device.room);
      names.push(device.room);
    }
    return names;
  }, [vendorScoped]);
  const activeRoom = room === "全部" || roomNames.includes(room) ? room : "全部";
  const roomScoped = devices.filter((device) => activeRoom === "全部" || device.room === activeRoom);
  const list = vendorScoped.filter((device) => activeRoom === "全部" || device.room === activeRoom);
  const placeOrder = ["客厅", "门厅", "厨房", "餐厅", "主卧", "次卧", "卧室", "卫生间", "阳台", "默认家庭"];
  const climates = list.filter(isClimate).slice().sort((a, b) => {
    const left = placeOrder.indexOf(placeOf(a));
    const right = placeOrder.indexOf(placeOf(b));
    return (left < 0 ? 99 : left) - (right < 0 ? 99 : right) || a.name.localeCompare(b.name, "zh");
  });
  const running = list.filter((device) => device.online && !isClimate(device));
  const offline = list.filter((device) => !device.online && !isClimate(device));
  const summary = summarize(list);
  const onlineCount = devices.filter((device) => device.online).length;
  const showMast = summary.average != null || summary.humidity != null || summary.lowBattery > 0;

  function countRoom(name: string) {
    if (name === "全部") return vendorScoped.length;
    return vendorScoped.filter((device) => device.room === name).length;
  }

  function countVendor(id: string) {
    const source = activeRoom === "全部" ? devices : roomScoped;
    if (id === "全部") return source.length;
    return source.filter((device) => device.vendorId === id).length;
  }

  const detailDevice = detail?.device;
  const subtitle = detailDevice
    ? `${shortVendor(vendorName(detailDevice.vendorId))} · ${placeOf(detailDevice)} · ${detailDevice.online ? "在线" : "离线"}`
    : "";

  return (
    <div className="app">
      <aside className="side">
        <h1>我的家</h1>
        <p className="quiet">{onlineCount} 台在线 · {devices.length} 台设备</p>
        {devices.length ? (
          <>
            <p className="kicker">房间</p>
            <nav className="nav">
              {["全部", ...roomNames].map((name) => (
                <button type="button" key={name} className={name === activeRoom ? "on" : ""} onClick={() => setRoom(name)}>
                  {name}
                  <em>{countRoom(name)}</em>
                </button>
              ))}
            </nav>
          </>
        ) : null}
        {vendorIds.length ? (
          <div className="group">
            <p className="kicker">厂商</p>
            <nav className="nav">
              <button type="button" className={activeVendor === "全部" ? "on" : ""} onClick={() => setVendor("全部")}>
                全部
                <em>{countVendor("全部")}</em>
              </button>
              {vendorIds.map((id) => (
                <button type="button" key={id} className={activeVendor === id ? "on" : ""} onClick={() => setVendor(id)}>
                  {shortVendor(vendorName(id))}
                  <em>{countVendor(id)}</em>
                </button>
              ))}
            </nav>
          </div>
        ) : null}
        {accounts.length ? (
          <div className="group accounts">
            <p className="kicker">账号</p>
            <ul className="account-list">
              {accounts.map((account) => {
                const view = accountView(account);
                return (
                  <li className="account" key={account.accountId}>
                    <div className="account-top">
                      <span className={`account-dot ${view.state}`} />
                      <span className="account-vendor">{shortVendor(vendorName(account.vendorId))}</span>
                      <span className={`account-state ${view.state}`} title={view.title}>{view.text}</span>
                    </div>
                    <div className="account-bottom">
                      <span className="account-id" title={account.userId}>{accountLabel(account)}</span>
                      <button type="button" className="text account-exit" onClick={() => void unlink(account.accountId)}>退出</button>
                    </div>
                    {view.state === "expired" ? (
                      <button type="button" className="relogin" onClick={() => openRelogin(account)}>重新登录</button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
        <div className={accounts.length ? "foot tight" : "foot"}>
          <button type="button" className="text" onClick={openAdd}>添加厂商</button>
          {accounts.length ? (
            <button type="button" className="text" onClick={() => { void loadDevices(); void checkStatuses(); }}>刷新读数</button>
          ) : null}
          {accounts.length > 1 ? <button type="button" className="text" onClick={() => void logout()}>全部退出</button> : null}
        </div>
      </aside>
      <main className="main">
        {showMast ? (
          <header className="mast">
            <div>
              <p className="label">全屋此刻 · 上次上报</p>
              {summary.average != null ? <p className="figure">{summary.average}°</p> : null}
            </div>
            <ul className="facts">
              {summary.humidity != null ? <li><b>{summary.humidity}%</b><span>平均湿度</span></li> : null}
              {summary.driest ? <li><b>{summary.driest.value}%</b><span>{summary.driest.place}最干</span></li> : null}
              {summary.lowBattery ? <li><b className="copper">{summary.lowBattery}</b><span>电量偏低</span></li> : null}
            </ul>
          </header>
        ) : null}
        {error && !detail && list.length ? <p className="err banner">{error}</p> : null}
        {running.length ? (
          <section className="sec">
            <h2>正在运行</h2>
            <div className="run">
              {running.map((device) => {
                const view = runningView(device);
                return (
                  <button type="button" className="run-card" key={deviceKey(device)} onClick={() => void openDevice(device)}>
                    <p className="room"><b>{shortVendor(vendorName(device.vendorId))}</b> · {view.place}</p>
                    <h3>{device.name}</h3>
                    <div className="grow" />
                    {view.mode === "pair" ? (
                      <div className="tds">
                        <div><b>{view.left}</b><span>{view.leftLabel}</span></div>
                        <i>→</i>
                        <div><b className={view.rightLabel === "出水" ? "out" : ""}>{view.right}</b><span>{view.rightLabel}</span></div>
                      </div>
                    ) : <p className="status">{view.text}</p>}
                    <p className="meta"><i className="dot" />{view.meta}</p>
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}
        {climates.length ? (
          <section className="sec">
            <h2>室温 · 上次上报</h2>
            <div className="sensors">
              {climates.map((device) => {
                const view = climateView(device);
                return (
                  <button type="button" className="sensor" key={deviceKey(device)} onClick={() => void openDevice(device)}>
                    <p className="room"><b>{shortVendor(vendorName(device.vendorId))}</b> · {climatePlace(device, climates)}</p>
                    <p className={view.temp ? "temp" : "temp dim"}>{view.temp || "—"}</p>
                    <p className="row">
                      <span>{view.humidity ? `湿度 ${view.humidity}` : (device.online ? "暂无读数" : "未连接")}</span>
                      {view.battery ? <span className={view.low ? "copper" : ""}>电量 {view.battery}</span> : <span />}
                    </p>
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}
        {offline.length ? (
          <section className="sec">
            <h2>未连接</h2>
            <div className="offline">
              {offline.map((device) => (
                <button type="button" key={deviceKey(device)} onClick={() => void openDevice(device)}>
                  <span>{device.name}</span>
                  <span className="where"><b>{shortVendor(vendorName(device.vendorId))}</b> · {placeOf(device)}</span>
                </button>
              ))}
            </div>
          </section>
        ) : null}
        {!list.length ? <p className="empty">{loading ? "正在读取" : error || (accounts.length ? "这个筛选下没有设备" : "还没有厂商账号")}</p> : null}
      </main>
      {detail ? (
        <DevicePanel
          detail={detail}
          subtitle={subtitle}
          error={error}
          onClose={closePanel}
          onSet={(prop, value) => void setProp(prop, value)}
          onAction={(action) => void runAction(action)}
          onUpload={(file, options) => uploadPrint(file, options)}
        />
      ) : null}
      {adding ? (
        <div className="sheet" onClick={(event) => { if (event.target === event.currentTarget) closeLogin(); }}>
          <VendorLogin
            vendors={vendors}
            initialVendorId={relogin?.vendorId}
            initialRegion={relogin?.region}
            initialUsername={relogin && /^1\d{10}$/.test(relogin.userId) ? relogin.userId : ""}
            replaceAccountId={relogin?.accountId || ""}
            heading={relogin ? "重新登录" : "添加厂商"}
            note={relogin ? "登录成功后替换当前失效的账号。" : "登录对应厂商账号。已添加的账号保持不变。"}
            vendorLocked={Boolean(relogin)}
            onCancel={closeLogin}
            onSuccess={(next) => {
              const wasRelogin = Boolean(relogin);
              closeLogin();
              onAccounts(next);
              if (wasRelogin) void loadDevices();
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
