const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const miniprogram = path.join(root, "miniprogram");

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

const files = walk(miniprogram);
for (const file of files) {
  if (file.endsWith(".js")) new vm.Script(fs.readFileSync(file, "utf8"), { filename: file });
  if (file.endsWith(".ts")) {
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(file, "utf8"),
      ts.ScriptTarget.ES2020,
      true,
      ts.ScriptKind.TS,
    );
    assert.equal(source.parseDiagnostics.length, 0, `${file} 存在 TypeScript 语法错误`);
  }
  if (file.endsWith(".json")) JSON.parse(fs.readFileSync(file, "utf8"));
}
JSON.parse(fs.readFileSync(path.join(root, "project.config.json"), "utf8"));

const app = JSON.parse(fs.readFileSync(path.join(miniprogram, "app.json"), "utf8"));
for (const page of app.pages) {
  for (const extension of ["ts", "json", "wxml", "wxss"]) {
    assert.ok(fs.existsSync(path.join(miniprogram, `${page}.${extension}`)), `${page}.${extension} 缺失`);
  }
}
for (const file of files.filter((name) => name.endsWith(".json"))) {
  const config = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const component of Object.values(config.usingComponents || {})) {
    const base = path.join(miniprogram, component);
    for (const extension of ["ts", "json", "wxml", "wxss"]) {
      assert.ok(fs.existsSync(`${base}.${extension}`), `${base}.${extension} 缺失`);
    }
  }
}

const { decorateDevice, isAmbientDevice } = require("../miniprogram/utils/device");
const appearanceCases = [
  [{ name: "M6760DW", model: "M6760DW", vendorId: "pantum" }, "印", 2],
  [{ name: "滚筒洗衣机", model: "TG100V120WDG", vendorId: "midea" }, "洗", 3],
  [{ name: "冰箱", model: "BCD-1", vendorId: "xiaomi" }, "冰", 0],
  [{ name: "米家智能加湿器", model: "CJJSQ", vendorId: "xiaomi" }, "湿", 3],
  [{ name: "客厅空调", model: "KFR-35", vendorId: "midea" }, "温", 0],
];
appearanceCases.forEach(([device, glyph, accent], index) => {
  const decorated = decorateDevice({ ...device, did: `did-${index}`, accountId: "account", room: "家", online: true, icon: "" }, index, {});
  assert.equal(decorated.glyph, glyph, `${device.name} 图标`);
  assert.equal(decorated.accent, accent, `${device.name} 配色`);
});

// 品类过滤：只有“空气类”设备的温湿度才参与家庭均值，其余品类读数被置空。
const liveTemp = [{ name: "温度", text: "60°C" }];
[
  [{ name: "客厅空调", model: "KFR-35" }, true],
  [{ name: "米家温湿度传感器", model: "LYWSD03MMC" }, true],
  [{ name: "电热水器", model: "F6032-JQ5" }, false],
  [{ name: "对开门冰箱", model: "BCD-555" }, false],
  [{ name: "卧室台灯", model: "MJDD07YL" }, false],
].forEach(([device, expected]) => {
  assert.equal(isAmbientDevice(device), expected, `${device.name} 环境品类判定`);
  const decorated = decorateDevice({ ...device, did: "d", accountId: "a", room: "家", online: true, icon: "", live: liveTemp }, 0, {});
  assert.equal(decorated.temperature, expected ? 60 : null, `${device.name} 温度参与均值`);
});

// 真实设备列表快照（来自 /api/open/devices）：作为品类过滤与家庭均值的编码参考。
const realDevices = require("./fixtures/devices.json").devices;
const decoratedReal = realDevices.map((device, index) => decorateDevice(device, index, null));
const tempProviders = decoratedReal.filter((d) => d.temperature !== null).map((d) => d.name);
assert.deepEqual(
  tempProviders,
  ["客厅蓝牙温湿度计", "次卧温湿度计", "主卧温湿度计"],
  "仅在线空气类设备提供家庭温度，且顺序按列表",
);
// 冰箱/洗衣机/微波炉/净水器等内部读数不得进入家庭均值。
["冰箱", "滚筒洗衣机", "微波炉", "净水器", "小米空气净化器2代", "米家智能加湿器"].forEach((name) => {
  const hit = decoratedReal.find((d) => d.name === name);
  assert.equal(hit.temperature, null, `${name} 温度不参与家庭均值`);
  assert.equal(hit.humidity, null, `${name} 湿度不参与家庭均值`);
});
// 家庭均值复用 store 的算法：温度保留 1 位小数，湿度取整。
const temps = decoratedReal.map((d) => d.temperature).filter((v) => typeof v === "number");
const hums = decoratedReal.map((d) => d.humidity).filter((v) => typeof v === "number");
assert.equal(Math.round((temps.reduce((s, v) => s + v, 0) / temps.length) * 10) / 10, 18.9, "家庭平均温度只统计温湿度计");
assert.equal(Math.round(hums.reduce((s, v) => s + v, 0) / hums.length), 38, "家庭平均湿度只统计温湿度计");

console.log(
  `静态检查通过：${files.filter((file) => file.endsWith(".ts")).length} 个 TS 源文件、${app.pages.length} 个页面、组件引用及设备视觉映射`,
);
