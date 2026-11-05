/**
 * 控制面板通用数据结构。
 *
 * 分三层：
 * 1. VendorField —— 厂商适配器唯一需要产出的东西：某个字段此刻的原始值。
 * 2. DeviceProfile + FieldRule —— 可配置的转换器档案，按 厂商 / 型号 / 设备 逐层叠加。
 * 3. DeviceDetail（下发给前端）—— 由 buildPanel 把前两层合成，前端只认控件类型与归一化值。
 */

/** 面板控件类型；"auto" 表示交给约束（options / range / format）推断 */
export type ControlKind = "switch" | "segmented" | "select" | "slider" | "number" | "text";

export interface ControlOption {
  value: string | number | boolean;
  name: string;
}

/** 厂商适配器输出的最小事实：字段名 + 原始值 + 厂商规范已知的约束 */
export interface VendorField {
  /** 稳定标识，写回时用它做字段名（美的是 lua 字段名，米家是 "服务.属性" 语义名） */
  key: string;
  /** 未转换的设备原始值 */
  raw: unknown;
  writable: boolean;
  /** 厂商规范给出的名字，档案里的 label 优先级更高 */
  label?: string;
  /** 厂商规范给出的权威类型，缺省时由档案或推断补齐 */
  kind?: ControlKind;
  unit?: string;
  range?: [number, number, number] | null;
  options?: ControlOption[];
  /** 分组名，同一组的字段渲染在同一个 section 下 */
  group?: string;
  siid?: number;
  piid?: number;
  /** 写回需要的厂商私有信息（如美的是 boolStyle / asText） */
  meta?: Record<string, unknown>;
}

export interface VendorAction {
  key: string;
  name: string;
  group?: string;
  siid?: number;
  aiid?: number;
  meta?: Record<string, unknown>;
}

/**
 * 字段转换规则：把原始值翻译成面板值，以及反向。
 * codec 只写名字，参数放 codecArgs，保证整份档案可以存成 JSON。
 */
export interface FieldRule {
  label?: string;
  kind?: ControlKind | "auto";
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: ControlOption[] | Record<string, string>;
  /** 双向转换器名，见 codecs.ts */
  codec?: string;
  codecArgs?: Record<string, unknown>;
  /** 数值显示的小数位，配合 scale / divide 一类转换器 */
  digits?: number;
  writable?: boolean;
  hidden?: boolean;
  /** 组内排序，小者靠前；未声明时保持适配器原始顺序 */
  order?: number;
  group?: string;
}

export interface ProfileMatch {
  /** 型号通配，支持 "*" */
  model?: string[];
  /** 米家 spec_type 之类的能力标识，支持 "*" */
  specType?: string[];
  /** 直接指定设备，优先级最高 */
  did?: string[];
}

/** 一个厂商 / 一类机型 / 一台设备的面板配置 */
export interface DeviceProfile {
  id: string;
  vendor: string;
  match?: ProfileMatch;
  /** 键支持精确字段名和 "*" 通配，精确规则覆盖通配规则 */
  fields?: Record<string, FieldRule>;
  /** 丢弃这些字段，支持 "*" 通配 */
  omit?: string[];
  /** 展示顺序，每项可以是字段名或通配模式；未命中的字段按适配器原始顺序排在后面 */
  order?: string[];
  groups?: Record<string, { name?: string; order?: number }>;
  actions?: Record<string, { label?: string; hidden?: boolean; order?: number }>;
}

/** 合并后的单字段视图，provider 与前端都用它 */
export interface ResolvedField {
  key: string;
  label: string;
  kind: ControlKind;
  unit: string;
  writable: boolean;
  range: [number, number, number] | null;
  options: ControlOption[];
  group: string;
  value: unknown;
  raw: unknown;
  order: number;
  siid?: number;
  piid?: number;
  meta?: Record<string, unknown>;
}
