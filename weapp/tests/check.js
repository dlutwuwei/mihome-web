const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

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
  if (file.endsWith(".json")) JSON.parse(fs.readFileSync(file, "utf8"));
}
JSON.parse(fs.readFileSync(path.join(root, "project.config.json"), "utf8"));

const app = JSON.parse(fs.readFileSync(path.join(miniprogram, "app.json"), "utf8"));
for (const page of app.pages) {
  for (const extension of ["js", "json", "wxml", "wxss"]) {
    assert.ok(fs.existsSync(path.join(miniprogram, `${page}.${extension}`)), `${page}.${extension} 缺失`);
  }
}
for (const file of files.filter((name) => name.endsWith(".json"))) {
  const config = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const component of Object.values(config.usingComponents || {})) {
    const base = path.join(miniprogram, component);
    for (const extension of ["js", "json", "wxml", "wxss"]) {
      assert.ok(fs.existsSync(`${base}.${extension}`), `${base}.${extension} 缺失`);
    }
  }
}

console.log(`静态检查通过：${files.filter((file) => file.endsWith(".js")).length} 个 JS、${app.pages.length} 个页面及组件引用`);
