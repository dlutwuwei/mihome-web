import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { isOkSession, type Account, type PasswordLogin, type QrPoll, type VendorInfo } from "../types";
import { api, errorText } from "../utils/api";

const POLL_GAP_MS = 1000;
type LoginMode = "qr" | "password" | "sms";

function firstMode(modes: string[]): LoginMode {
  if (modes.includes("sms")) return "sms";
  if (modes.includes("qr")) return "qr";
  return "password";
}

function delay(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export function VendorLogin({
  vendors,
  onSuccess,
  onCancel,
}: {
  vendors: VendorInfo[];
  onSuccess: (accounts: Account[]) => void;
  onCancel: () => void;
}) {
  const [vendorId, setVendorId] = useState(vendors[0]?.id || "xiaomi");
  const vendor = useMemo(() => vendors.find((item) => item.id === vendorId) || vendors[0], [vendors, vendorId]);
  const regions = vendor?.regions || [];
  const authModes = vendor?.authModes || ["password"];
  const [mode, setMode] = useState<LoginMode>(firstMode(authModes));
  const [region, setRegion] = useState(regions[0]?.id || "cn");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [captcha, setCaptcha] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [pendingId, setPendingId] = useState("");
  const [needCaptcha, setNeedCaptcha] = useState(false);
  const [needEmail, setNeedEmail] = useState(false);
  const [smsSent, setSmsSent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const smsLogin = mode === "sms";

  useEffect(() => {
    setRegion(regions[0]?.id || "cn");
    setMode(firstMode(authModes));
    setPendingId("");
    setNeedCaptcha(false);
    setNeedEmail(false);
    setSmsSent(false);
    setCaptcha("");
    setEmailCode("");
    setError("");
  }, [vendorId]);

  useEffect(() => {
    if (mode !== "qr" || !pendingId) return undefined;
    let stop = false;
    (async function poll() {
      while (!stop) {
        try {
          const data = await api<QrPoll>("/api/login/qr/poll", { method: "POST", body: { pendingId } });
          if (stop) return;
          if (isOkSession(data)) {
            onSuccess(data.accounts);
            return;
          }
          await delay(POLL_GAP_MS);
        } catch (err) {
          if (!stop) setError(errorText(err));
          return;
        }
      }
    })();
    return () => {
      stop = true;
    };
  }, [mode, pendingId, onSuccess]);

  function switchMode(next: LoginMode) {
    setMode(next);
    setPendingId("");
    setNeedCaptcha(false);
    setNeedEmail(false);
    setSmsSent(false);
    setCaptcha("");
    setEmailCode("");
    setError("");
  }

  async function sendCode() {
    setError("");
    setBusy(true);
    const vendorValue = vendorId;
    const regionValue = region;
    const usernameValue = username;
    const captchaValue = captcha;
    const pendingValue = pendingId;
    try {
      const data = await api<{ pendingId: string; needCaptcha?: boolean }>("/api/login/sms", {
        method: "POST",
        body: {
          vendor: vendorValue,
          region: regionValue,
          username: usernameValue,
          captcha: captchaValue,
          pendingId: pendingValue,
        },
      });
      setPendingId(data.pendingId);
      setNeedCaptcha(Boolean(data.needCaptcha));
      setSmsSent(!data.needCaptcha);
      setCaptcha("");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const vendorValue = vendorId;
    const regionValue = region;
    const usernameValue = username;
    const passwordValue = password;
    const captchaValue = captcha;
    const emailCodeValue = emailCode;
    const pendingValue = pendingId;
    try {
      if (mode === "qr") {
        const data = await api<{ pendingId: string }>("/api/login/qr", {
          method: "POST",
          body: { vendor: vendorValue, region: regionValue },
        });
        setPendingId(data.pendingId);
        return;
      }
      if (needEmail) {
        const verified = await api<PasswordLogin>("/api/login/email", { method: "POST", body: { pendingId: pendingValue, code: emailCodeValue } });
        if (isOkSession(verified)) onSuccess(verified.accounts);
        return;
      }
      const data = await api<PasswordLogin>("/api/login/password", {
        method: "POST",
        body: {
          vendor: vendorValue,
          region: regionValue,
          username: usernameValue,
          password: passwordValue,
          captcha: captchaValue,
          pendingId: pendingValue,
          method: mode === "sms" ? "sms" : undefined,
        },
      });
      if ("needCaptcha" in data) {
        setNeedCaptcha(true);
        setPendingId(data.pendingId);
        setCaptcha("");
        return;
      }
      if ("needEmailCode" in data) {
        setNeedCaptcha(false);
        setNeedEmail(true);
        setPendingId(data.pendingId);
        return;
      }
      if (isOkSession(data)) onSuccess(data.accounts);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login embed">
      <form className="card" onSubmit={submit}>
        <div className="brand">SMART HOME</div>
        <h1>添加厂商</h1>
        <p className="sub">登录对应厂商账号。已添加的账号保持不变。</p>
        <label>
          厂商
          <select value={vendorId} onChange={(event) => setVendorId(event.target.value)}>
            {vendors.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        {authModes.length > 1 ? (
          <div className="tabs">
            {authModes.includes("sms") ? (
              <button type="button" className={mode === "sms" ? "on" : ""} onClick={() => switchMode("sms")}>验证码</button>
            ) : null}
            {authModes.includes("qr") ? (
              <button type="button" className={mode === "qr" ? "on" : ""} onClick={() => switchMode("qr")}>扫码</button>
            ) : null}
            {authModes.includes("password") ? (
              <button type="button" className={mode === "password" ? "on" : ""} onClick={() => switchMode("password")}>{authModes.includes("sms") ? "密码" : "账号"}</button>
            ) : null}
          </div>
        ) : null}
        <label>
          区域
          <select value={region} onChange={(event) => setRegion(event.target.value)}>
            {regions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        {mode !== "qr" ? (
          <>
            <label>{vendorId === "midea" ? "手机号" : "账号"}<input value={username} autoComplete="username" inputMode={vendorId === "midea" ? "tel" : undefined} onChange={(event) => setUsername(event.target.value)} /></label>
            {smsLogin ? (
              <label>短信验证码<input value={password} autoComplete="one-time-code" inputMode="numeric" onChange={(event) => setPassword(event.target.value)} /></label>
            ) : (
              <label>密码<input value={password} type="password" autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} /></label>
            )}
            {needCaptcha ? (
              <>
                <img className="captcha" alt="验证码" src={`/api/login/captcha?pendingId=${encodeURIComponent(pendingId)}`} />
                <label>{smsLogin ? "图形验证码" : "验证码"}<input value={captcha} autoComplete="off" onChange={(event) => setCaptcha(event.target.value)} /></label>
              </>
            ) : null}
            {needEmail ? (
              <>
                <p className="hint">验证码已发到账号邮箱</p>
                <label>邮箱验证码<input value={emailCode} autoComplete="one-time-code" onChange={(event) => setEmailCode(event.target.value)} /></label>
              </>
            ) : null}
            {vendorId === "demo" ? <p className="hint">演示账号任意用户名，密码 demo</p> : null}
            {vendorId === "midea" && mode === "password" ? <p className="hint">美居账号为手机号和密码</p> : null}
            {smsLogin ? <p className="hint">{needCaptcha ? "先填写图形验证码，再获取短信" : smsSent ? "短信已发送" : "验证码会发到这个手机号"}</p> : null}
            {smsLogin ? (
              <button type="button" className="send" disabled={busy} onClick={sendCode}>获取验证码</button>
            ) : null}
          </>
        ) : pendingId ? (
          <>
            <img className="qr" alt="登录二维码" src={`/api/login/qr/image?pendingId=${encodeURIComponent(pendingId)}`} />
            <p className="hint">打开对应厂商 App 扫码</p>
          </>
        ) : null}
        <p className="err">{error}</p>
        <button className="primary" disabled={busy || (mode === "qr" && Boolean(pendingId))}>
          {busy ? "请稍候" : mode === "qr" ? "获取二维码" : "登录"}
        </button>
        <button type="button" className="ghost cancel" onClick={onCancel}>取消</button>
      </form>
    </main>
  );
}
