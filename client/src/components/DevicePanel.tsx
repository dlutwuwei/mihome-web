import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { PropRow } from "./PropRow";
import type { DeviceAction, DeviceDetail, DeviceProp, PropValue } from "../types";
import { errorText } from "../utils/api";

export interface PrintOptions {
  copies: number;
  mode: string;
  duplex: string;
  collate: string;
  paperSize: string;
  paperType: string;
  feeder: string;
}

const PRINT_DEFAULTS: PrintOptions = {
  copies: 1,
  mode: "bw",
  duplex: "simplex",
  collate: "non-collate",
  paperSize: "A4",
  paperType: "plain_1",
  feeder: "auto",
};

const PRINT_FIELDS: Array<{ key: keyof PrintOptions; label: string; options: Array<{ value: string; label: string }> }> = [
  { key: "mode", label: "色彩", options: [{ value: "bw", label: "黑白" }, { value: "color", label: "彩色" }] },
  { key: "duplex", label: "单双面", options: [
    { value: "simplex", label: "单面" },
    { value: "duplex_long_edge", label: "双面（长边）" },
    { value: "duplex_short_edge", label: "双面（短边）" },
    { value: "manual_duplex_long_edge", label: "手动双面（长边）" },
    { value: "manual_duplex_short_edge", label: "手动双面（短边）" },
  ] },
  { key: "collate", label: "逐份", options: [
    { value: "non-collate", label: "不逐份" },
    { value: "collate", label: "逐份" },
  ] },
  { key: "paperSize", label: "纸张", options: [
    { value: "A4", label: "A4" },
    { value: "A5", label: "A5" },
    { value: "A3", label: "A3" },
    { value: "A6", label: "A6" },
    { value: "Letter", label: "Letter" },
    { value: "Legal", label: "Legal" },
    { value: "16K", label: "16K" },
    { value: "JIS_B5", label: "B5" },
    { value: "4x6", label: "4×6" },
  ] },
  { key: "paperType", label: "纸张类型", options: [
    { value: "plain_1", label: "普通纸" },
    { value: "plain", label: "普通纸（plain）" },
    { value: "tissue", label: "薄纸" },
    { value: "tough_1", label: "厚纸" },
    { value: "cardstock", label: "卡片" },
    { value: "envelope", label: "信封" },
    { value: "labels", label: "标签" },
    { value: "recycled_paper", label: "再生纸" },
    { value: "photo_plain", label: "相片纸" },
  ] },
  { key: "feeder", label: "进纸", options: [
    { value: "auto", label: "自动" },
    { value: "auto_tray", label: "自动进纸盒" },
    { value: "standard_tray", label: "标准纸盒" },
    { value: "manual_tray", label: "手动进纸" },
    { value: "mpf_tray", label: "多功能纸盒" },
    { value: "tray_1", label: "选配纸盒" },
  ] },
];

const LEAVE_MS = 240;

export function DevicePanel({
  detail,
  subtitle,
  error,
  onClose,
  onSet,
  onAction,
  onUpload,
}: {
  detail: DeviceDetail;
  subtitle: string;
  error: string;
  onClose: () => void;
  onSet: (prop: DeviceProp, value: PropValue) => void;
  onAction: (action: DeviceAction) => void;
  onUpload: (file: File, options: PrintOptions) => Promise<void>;
}) {
  const { device, services } = detail;
  const [pending, setPending] = useState<File | null>(null);
  const [options, setOptions] = useState<PrintOptions>(PRINT_DEFAULTS);
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState("");
  const [closing, setClosing] = useState(false);
  const closingTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (closingTimer.current != null) window.clearTimeout(closingTimer.current);
  }, []);
  const startClose = useCallback(() => {
    if (closingTimer.current != null) return;
    setClosing(true);
    closingTimer.current = window.setTimeout(() => {
      closingTimer.current = null;
      onClose();
    }, LEAVE_MS);
  }, [onClose]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) startClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pending, startClose]);
  const requestClose = (event?: MouseEvent) => {
    if (event && event.target !== event.currentTarget) return;
    startClose();
  };
  return (
    <>
    <div className={closing ? "mask leave" : "mask"} onClick={(event) => { if (!pending) requestClose(event); }}>
      <aside className={closing ? "panel leave" : "panel"} role="dialog" aria-modal="true" aria-label={device.name}>
        <div className="panel-head">
          <h2>{device.name}</h2>
          <button type="button" className="text" onClick={() => requestClose()}>关闭</button>
        </div>
        <p className="sub">{subtitle}</p>
        <p className="err">{error}</p>
        {services.length ? services.map((service) => (
          <section className="svc" key={service.name}>
            <h3>{service.name}</h3>
            {service.properties.map((prop) => (
              <PropRow key={prop.id || `${prop.siid}:${prop.piid}`} prop={prop} onSet={onSet} />
            ))}
            {service.actions.map((action) => (
              action.id === "print" || action.name === "上传打印" ? (
                <div className="row" key={action.id || `${action.siid}:${action.aiid}`}>
                  <span>{action.name}</span>
                  <label className="action file">
                    选择文件
                    <input
                      type="file"
                      accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (!file) return;
                        setOptions(PRINT_DEFAULTS);
                        setPrintError("");
                        setPending(file);
                      }}
                    />
                  </label>
                </div>
              ) : (
                <div className="row" key={action.id || `${action.siid}:${action.aiid}`}>
                  <span>{action.name}</span>
                  <button type="button" className="action" onClick={() => onAction(action)}>执行</button>
                </div>
              )
            ))}
          </section>
        )) : <p className="hint">这个设备暂无可展示的属性</p>}
      </aside>
    </div>
    {pending ? (
      <div className="sheet print-sheet" onClick={(event) => { if (event.target === event.currentTarget && !printing) setPending(null); }}>
        <form
          className="card"
          onSubmit={(event) => {
            event.preventDefault();
            const file = pending;
            if (!file || printing) return;
            const copies = Math.min(99, Math.max(1, Math.floor(Number(options.copies) || 1)));
            setPrinting(true);
            setPrintError("");
            void onUpload(file, { ...options, copies }).then(() => setPending(null)).catch((err) => setPrintError(errorText(err))).finally(() => setPrinting(false));
          }}
        >
          <p className="brand">打印</p>
          <h2>打印设置</h2>
          <p className="print-file">{pending.name}</p>
          <label>
            份数
            <input
              type="number"
              min={1}
              max={99}
              value={options.copies}
              onChange={(event) => setOptions({ ...options, copies: Number(event.target.value) })}
            />
          </label>
          {PRINT_FIELDS.map((field) => (
            <label key={field.key}>
              {field.label}
              <select
                value={String(options[field.key])}
                onChange={(event) => setOptions({ ...options, [field.key]: event.target.value })}
              >
                {field.options.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
          ))}
          <p className="err">{printError}</p>
          <div className="print-actions">
            <button type="button" className="cancel" disabled={printing} onClick={() => setPending(null)}>取消</button>
            <button type="submit" className="primary" disabled={printing}>{printing ? "正在打印" : "打印"}</button>
          </div>
        </form>
      </div>
    ) : null}
    </>
  );
}
