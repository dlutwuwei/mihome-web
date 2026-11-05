import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, CSSProperties, KeyboardEvent, PointerEvent } from "react";
import type { DeviceProp, PropValue } from "../types";
import { controlKind, showValue, unitOf, withUnit } from "../utils/device";

const sameValue = (a: PropValue, b: PropValue) => String(a) === String(b);

function toDraft(value: PropValue) {
  return value == null ? "" : String(value);
}

function SwitchControl({ prop, onSet }: { prop: DeviceProp; onSet: (prop: DeviceProp, value: PropValue) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={Boolean(prop.value)}
      className={prop.value ? "switch on" : "switch"}
      onClick={() => onSet(prop, !prop.value)}
    ><i /></button>
  );
}

function SegmentedControl({ prop, onSet }: { prop: DeviceProp; onSet: (prop: DeviceProp, value: PropValue) => void }) {
  return (
    <div className="seg" role="radiogroup" aria-label={prop.name}>
      {prop.list.map((item) => (
        <button
          type="button"
          key={String(item.value)}
          className={sameValue(item.value, prop.value) ? "on" : ""}
          onClick={() => onSet(prop, item.value)}
        >{item.name}</button>
      ))}
    </div>
  );
}

function SelectControl({ prop, onSet }: { prop: DeviceProp; onSet: (prop: DeviceProp, value: PropValue) => void }) {
  return (
    <select value={String(prop.value ?? "")} onChange={(event) => {
      const hit = prop.list.find((item) => String(item.value) === event.target.value);
      if (hit) onSet(prop, hit.value);
    }}>
      {prop.list.map((item) => <option key={String(item.value)} value={String(item.value)}>{item.name}</option>)}
    </select>
  );
}

function SliderControl({ prop, onSet }: { prop: DeviceProp; onSet: (prop: DeviceProp, value: PropValue) => void }) {
  const [min, max, step] = useMemo(() => {
    const [lo, hi, s] = prop.range || [0, 100, 1];
    return [lo, hi, s && s > 0 ? s : 1];
  }, [prop.range]);
  const [draft, setDraft] = useState(Number(prop.value ?? min));
  const settle = useRef<number | null>(null);
  useEffect(() => setDraft(Number(prop.value ?? min)), [prop.value, prop.range, min]);
  useEffect(() => () => {
    if (settle.current != null) window.clearTimeout(settle.current);
  }, []);
  const shown = sameValue(prop.value, draft) ? prop.value : draft;
  const span = max - min;
  const fill = span > 0 ? ((Math.min(max, Math.max(min, draft)) - min) / span) * 100 : 0;
  const commit = (value: number, delay = 0) => {
    if (settle.current != null) window.clearTimeout(settle.current);
    if (!delay) {
      settle.current = null;
      if (!sameValue(value, prop.value)) onSet(prop, value);
      return;
    }
    settle.current = window.setTimeout(() => {
      settle.current = null;
      if (!sameValue(value, prop.value)) onSet(prop, value);
    }, delay);
  };
  return (
    <div className="slider">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={draft}
        aria-label={prop.name}
        style={{ "--fill": `${fill}%` } as CSSProperties}
        onChange={(event: ChangeEvent<HTMLInputElement>) => setDraft(Number(event.target.value))}
        onPointerUp={(event: PointerEvent<HTMLInputElement>) => commit(Number(event.currentTarget.value))}
        onKeyUp={(event: KeyboardEvent<HTMLInputElement>) => commit(Number(event.currentTarget.value), 400)}
      />
      <output>{withUnit(prop, shown)}</output>
    </div>
  );
}

function NumberControl({ prop, onSet }: { prop: DeviceProp; onSet: (prop: DeviceProp, value: PropValue) => void }) {
  const [min, max] = prop.range || [];
  const step = prop.range?.[2] && prop.range[2] < 1 ? prop.range[2] : (prop.format === "float" ? 0.1 : 1);
  const [draft, setDraft] = useState(toDraft(prop.value));
  useEffect(() => setDraft(toDraft(prop.value)), [prop.value]);
  const commit = () => {
    const text = draft.trim();
    if (!text || !/^-?\d+(\.\d+)?$/.test(text)) {
      setDraft(toDraft(prop.value));
      return;
    }
    let next = Number(text);
    if (min != null) next = Math.max(min, next);
    if (max != null) next = Math.min(max, next);
    if (!sameValue(next, prop.value)) onSet(prop, next);
    else setDraft(toDraft(prop.value));
  };
  return (
    <div className="number">
      <input
        type="number"
        value={draft}
        min={min}
        max={max}
        step={step}
        aria-label={prop.name}
        onChange={(event: ChangeEvent<HTMLInputElement>) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => { if (event.key === "Enter") event.currentTarget.blur(); }}
      />
      {unitOf(prop) ? <em>{unitOf(prop)}</em> : null}
    </div>
  );
}

export function PropRow({ prop, onSet }: { prop: DeviceProp; onSet: (prop: DeviceProp, value: PropValue) => void }) {
  const kind = controlKind(prop);
  return (
    <div className={`row ctl-${kind}`}>
      <span>{prop.name}</span>
      {kind === "switch" ? <SwitchControl prop={prop} onSet={onSet} />
        : kind === "segmented" ? <SegmentedControl prop={prop} onSet={onSet} />
        : kind === "select" ? <SelectControl prop={prop} onSet={onSet} />
        : kind === "slider" ? <SliderControl prop={prop} onSet={onSet} />
        : kind === "number" ? <NumberControl prop={prop} onSet={onSet} />
        : <strong>{showValue(prop)}</strong>}
    </div>
  );
}
