import { PropRow } from "./PropRow";
import type { DeviceAction, DeviceDetail, DeviceProp, PropValue } from "../types";

export function DevicePanel({
  detail,
  subtitle,
  error,
  onClose,
  onSet,
  onAction,
}: {
  detail: DeviceDetail;
  subtitle: string;
  error: string;
  onClose: () => void;
  onSet: (prop: DeviceProp, value: PropValue) => void;
  onAction: (action: DeviceAction) => void;
}) {
  const { device, services } = detail;
  return (
    <div className="mask" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="panel">
        <div className="panel-head">
          <h2>{device.name}</h2>
          <button type="button" className="text" onClick={onClose}>关闭</button>
        </div>
        <p className="sub">{subtitle}</p>
        <p className="err">{error}</p>
        {services.length ? services.map((service) => (
          <section className="svc" key={service.siid}>
            <h3>{service.name}</h3>
            {service.properties.map((prop) => (
              <PropRow key={`${prop.siid}:${prop.piid}`} prop={prop} onSet={onSet} />
            ))}
            {service.actions.map((action) => (
              <div className="row" key={`${action.siid}:${action.aiid}`}>
                <span>{action.name}</span>
                <button type="button" className="action" onClick={() => onAction(action)}>执行</button>
              </div>
            ))}
          </section>
        )) : <p className="hint">这个设备没有可读写的 Spec 属性</p>}
      </aside>
    </div>
  );
}
