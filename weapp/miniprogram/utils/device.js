function deviceKey(device) {
  return `${device.accountId}:${device.did}`;
}

function glyphFor(device) {
  const text = `${device.name || ""} ${device.model || ""}`;
  const rules = [
    [/灯|照明|light/i, "灯"],
    [/空调|温度|air|ac\b/i, "温"],
    [/音乐|音箱|sound|speaker/i, "音"],
    [/摄像|相机|camera/i, "影"],
    [/电视|tv/i, "视"],
    [/打印|print/i, "印"],
    [/扫地|吸尘|vacuum/i, "扫"],
    [/风扇|fan/i, "风"],
  ];
  const hit = rules.find(([pattern]) => pattern.test(text));
  return hit ? hit[1] : "设";
}

function decorateDevice(device, index, liveMap) {
  const live = (liveMap && liveMap[deviceKey(device)]) || device.live || [];
  return {
    ...device,
    key: deviceKey(device),
    glyph: glyphFor(device),
    accent: (index + String(device.did || "").length) % 4,
    statusText: device.online ? "在线" : "离线",
    primaryLive: live.length ? live[0].text : (device.online ? "可控制" : "暂不可用"),
    live: live.slice(0, 3),
  };
}

function inferKind(property) {
  if (property.kind) return property.kind;
  if (typeof property.value === "boolean") return "switch";
  if (property.list && property.list.length) return property.list.length <= 4 ? "segmented" : "select";
  if (property.range && property.range.length >= 2) return "slider";
  return typeof property.value === "number" ? "number" : "text";
}

function formatPropertyValue(property) {
  const value = property.value;
  if (value === null || value === undefined || value === "") return "--";
  if (typeof value === "boolean") return value ? "开启" : "关闭";
  if (property.kind === "switch") return value ? "开启" : "关闭";
  const unit = property.unit || "";
  if (!unit) return String(value);
  return /^(°|%|℃|℉)/.test(unit) ? `${value}${unit}` : `${value} ${unit}`;
}

function propertyKey(property) {
  return `${property.siid}:${property.piid}`;
}

function updatePropertyView(property) {
  property.displayValue = formatPropertyValue(property);
  property.options = (property.list || []).map((option, index) => ({
    ...option,
    key: `${propertyKey(property)}:${index}`,
    selected: option.value === property.value,
  }));
}

function decorateServices(services) {
  let featuredKey = "";
  const decorated = services.map((service) => ({
    ...service,
    key: `service:${service.siid}`,
    properties: (service.properties || []).map((source) => {
      const property = {
        ...source,
        id: source.id || "",
        key: propertyKey(source),
        kind: inferKind(source),
        hasRange: Array.isArray(source.range) && source.range.length >= 2,
        rangeMin: source.range && source.range.length >= 2 ? Number(source.range[0]) : 0,
        rangeMax: source.range && source.range.length >= 2 ? Number(source.range[1]) : 100,
        rangeStep: source.range && source.range.length >= 3 ? Number(source.range[2]) || 1 : 1,
        featured: false,
      };
      if (!featuredKey && property.writable && property.hasRange && ["slider", "number"].includes(property.kind)) {
        featuredKey = property.key;
        property.featured = true;
      }
      updatePropertyView(property);
      return property;
    }),
    actions: (service.actions || []).map((action) => ({
      ...action,
      key: `action:${action.siid}:${action.aiid}`,
    })),
  }));
  return { services: decorated, featuredKey };
}

function findProperty(services, key) {
  for (const service of services) {
    const property = service.properties.find((item) => item.key === key);
    if (property) return property;
  }
  return null;
}

function findAction(services, key) {
  for (const service of services) {
    const action = service.actions.find((item) => item.key === key);
    if (action) return { action, service };
  }
  return null;
}

function clampPropertyValue(property, value) {
  const min = property.rangeMin;
  const max = property.rangeMax;
  const step = property.rangeStep || 1;
  const clamped = Math.min(max, Math.max(min, Number(value)));
  const stepped = min + Math.round((clamped - min) / step) * step;
  const precision = String(step).includes(".") ? String(step).split(".")[1].length : 0;
  return Number(stepped.toFixed(Math.min(precision, 6)));
}

module.exports = {
  deviceKey,
  decorateDevice,
  decorateServices,
  findProperty,
  findAction,
  updatePropertyView,
  clampPropertyValue,
};
