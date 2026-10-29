import { useEffect, useState } from "react";
import type { PointerEvent } from "react";
import type { DeviceProp, PropValue } from "../types";
import { cast, showValue } from "../utils/device";

export function PropRow({ prop, onSet }: { prop: DeviceProp; onSet: (prop: DeviceProp, value: PropValue) => void }) {
  const [draft, setDraft] = useState(prop.value);
  useEffect(() => setDraft(prop.value), [prop.value]);
  if (!prop.writable) {
    return <div className="row"><span>{prop.name}</span><strong>{showValue(prop)}</strong></div>;
  }
  if (prop.format === "bool") {
    return (
      <div className="row">
        <span>{prop.name}</span>
        <button type="button" className={prop.value ? "switch on" : "switch"} onClick={() => onSet(prop, !prop.value)}><i /></button>
      </div>
    );
  }
  if (prop.list.length) {
    return (
      <div className="row">
        <span>{prop.name}</span>
        <select value={String(prop.value ?? "")} onChange={(event) => onSet(prop, cast(event.target.value))}>
          {prop.list.map((item) => <option key={String(item.value)} value={String(item.value)}>{item.name}</option>)}
        </select>
      </div>
    );
  }
  if (prop.range) {
    const [min, max, step = 1] = prop.range;
    return (
      <div className="row">
        <span>{prop.name}</span>
        <input
          type="range"
          min={min}
          max={max}
          step={step || 1}
          value={Number(draft ?? min)}
          onChange={(event) => setDraft(Number(event.target.value))}
          onPointerUp={(event: PointerEvent<HTMLInputElement>) => onSet(prop, Number(event.currentTarget.value))}
        />
      </div>
    );
  }
  return <div className="row"><span>{prop.name}</span><strong>{showValue(prop)}</strong></div>;
}
