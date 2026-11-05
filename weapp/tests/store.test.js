const assert = require("node:assert/strict");
const { humidityOf, apparentTemperatureOf, comfortOf } = require("../miniprogram/utils/device");

const storage = new Map([
  ["mihome.weapp.baseUrl", "http://127.0.0.1:8787"],
  ["mihome.weapp.apiKey", "test-secret"],
]);
const requests = [];
let failNextWrite = false;

const detail = {
  device: {
    did: "did/1",
    accountId: "account one",
    vendorId: "demo",
    name: "客厅空调",
    model: "demo.ac.v1",
    online: true,
    room: "客厅",
    icon: "",
    live: [{ name: "温度", text: "24°C" }, { name: "湿度", text: "52%" }],
  },
  services: [{
    siid: 2,
    name: "空调",
    properties: [
      { siid: 2, piid: 1, name: "温度", kind: "slider", writable: true, range: [16, 30, 1], list: [], unit: "°C", value: 24 },
      { siid: 2, piid: 2, name: "开关", kind: "switch", writable: true, range: null, list: [], value: false },
      { siid: 2, piid: 3, name: "模式", kind: "segmented", writable: true, range: null, list: [{ value: 0, name: "制冷" }, { value: 1, name: "送风" }], value: 0 },
    ],
    actions: [{ siid: 2, aiid: 1, name: "自动清洁" }],
  }],
};

global.wx = {
  getStorageSync: (key) => storage.get(key) || "",
  setStorageSync: (key, value) => storage.set(key, value),
  removeStorageSync: (key) => storage.delete(key),
  request(options) {
    requests.push(options);
    const path = new URL(options.url).pathname;
    setTimeout(() => {
      if (path === "/api/open/info") {
        options.success({ statusCode: 200, data: { keyId: "key-1", keyName: "小程序", scopes: ["devices:read", "devices:live", "devices:control"], accounts: [{ accountId: "account one" }] } });
      } else if (path === "/api/open/devices") {
        options.success({ statusCode: 200, data: { devices: [detail.device, { ...detail.device, did: "light-1", name: "卧室台灯", room: "卧室" }] } });
      } else if (path === "/api/open/live") {
        options.success({ statusCode: 200, data: { live: { "account one:did/1": [{ name: "温度", text: "24°C" }, { name: "湿度", text: "52%" }] } } });
      } else if (path === "/api/open/devices/account%20one/did%2F1") {
        options.success({ statusCode: 200, data: detail });
      } else if (path === "/api/open/devices/account%20one/did%2F1/props") {
        if (failNextWrite) {
          failNextWrite = false;
          options.success({ statusCode: 500, data: { error: "模拟写入失败" } });
        } else {
          options.success({ statusCode: 200, data: { ok: true } });
        }
      } else if (path === "/api/open/devices/account%20one/did%2F1/actions") {
        options.success({ statusCode: 200, data: { ok: true } });
      } else {
        options.success({ statusCode: 404, data: { error: `未知测试路径 ${path}` } });
      }
    }, 2);
  },
};

(async () => {
  const { deviceStore: store, temperatureTone } = require("../miniprogram/stores/deviceStore");
  assert.equal(store.configured, true);
  await store.loadDevices();
  assert.equal(store.devices.length, 2);
  assert.equal(store.onlineCount, 2);
  assert.equal(store.rooms.length, 3);
  assert.equal(store.devices[0].primaryLive, "24°C");
  assert.equal(store.averageTemperature, 24);
  assert.equal(store.averageHumidity, 52);
  assert.equal(store.averageHumidityText, "52%");
  assert.equal(store.apparentTemperature, 24);
  assert.equal(store.comfortText, "体感舒适");
  assert.equal(store.devices[0].humidity, 52);
  assert.equal(humidityOf([{ name: "目标湿度", text: "70%" }, { name: "湿度", text: "44.4%" }]), 44.4);
  assert.equal(humidityOf([{ name: "湿度", text: "120%" }]), null);
  assert.equal(apparentTemperatureOf(25, 50), 25);
  assert.ok(apparentTemperatureOf(30, 70) > 30);
  assert.equal(comfortOf(5, 50), "体感寒冷");
  assert.equal(comfortOf(18, 50), "体感微凉");
  assert.equal(comfortOf(18, 80), "体感湿冷");
  assert.equal(comfortOf(24, 20), "体感干燥");
  assert.equal(comfortOf(24, 50), "体感舒适");
  assert.equal(comfortOf(28, 70), "体感闷热");
  assert.equal(comfortOf(31, 50), "体感炎热");
  assert.equal(comfortOf(35, 80), "体感酷热");
  assert.equal(comfortOf(null, 50), "");
  assert.equal(store.heroTone, "hero-temp-mild");
  assert.equal(temperatureTone(-2), "hero-temp-cold");
  assert.equal(temperatureTone(11.9), "hero-temp-cold");
  assert.equal(temperatureTone(12), "hero-temp-cool");
  assert.equal(temperatureTone(19.9), "hero-temp-cool");
  assert.equal(temperatureTone(20), "hero-temp-mild");
  assert.equal(temperatureTone(25.9), "hero-temp-mild");
  assert.equal(temperatureTone(26), "hero-temp-warm");
  assert.equal(temperatureTone(29.9), "hero-temp-warm");
  assert.equal(temperatureTone(30), "hero-temp-hot");
  assert.equal(temperatureTone(null), "");
  store.setRoom("卧室");
  assert.equal(store.filteredDevices.length, 1);
  assert.equal(store.filteredDevices[0].name, "卧室台灯");
  store.setRoom("全部");

  await store.loadDeviceDetail("account one", "did/1");
  assert.equal(store.featuredProperty.key, "2:1");
  assert.equal(store.featuredProperty.displayValue, "24°C");
  store.previewProperty("2:1", 26);
  assert.equal(store.featuredProperty.value, 26);
  assert.equal(requests.filter((request) => request.method === "POST").length, 0, "预览不应发送写请求");
  await store.writeProperty("2:1", 27);
  assert.equal(store.featuredProperty.value, 27);
  await store.writeProperty("2:2", true);
  const switchProperty = store.services[0].properties[1];
  assert.equal(switchProperty.value, true);
  await store.writeProperty("2:3", 1);
  assert.equal(store.services[0].properties[2].options[1].selected, true);

  failNextWrite = true;
  await assert.rejects(store.writeProperty("2:1", 18), /模拟写入失败/);
  assert.equal(store.featuredProperty.value, 27, "写入失败应回滚到原值");

  await store.runDeviceAction("action:2:1");
  const actionRequest = requests.find((request) => new URL(request.url).pathname.endsWith("/actions"));
  assert.deepEqual(actionRequest.data, { siid: 2, aiid: 1 });
  const propertyRequest = requests.find((request) => new URL(request.url).pathname.endsWith("/props"));
  assert.deepEqual(propertyRequest.data, { siid: 2, piid: 1, id: undefined, value: 27 });
  assert.ok(requests.every((request) => request.header.Authorization === "Bearer test-secret"));
  assert.ok(requests.every((request) => !request.url.includes("apiKey=")));
  assert.ok(requests.some((request) => request.url.includes("account%20one/did%2F1")));

  // 回归：拖动时先预览、松手后写同一个值，不能因为 property.value 已相等就跳过请求
  store.previewProperty("2:1", 30);
  await store.writeProperty("2:1", 30);
  assert.equal(store.featuredProperty.value, 30);
  const draggedRequest = requests.filter((request) => request.method === "POST").slice(-1)[0];
  assert.deepEqual(draggedRequest.data, { siid: 2, piid: 1, id: undefined, value: 30 });
  const beforeDup = requests.length;
  await store.writeProperty("2:1", 30);
  assert.equal(requests.length, beforeDup, "设备已确认相同值时不再重复写入");

  store.info = { ...store.info, scopes: ["devices:read"] };
  await assert.rejects(store.writeProperty("2:1", 20), /devices:control/);
  store.clearConnection();
  assert.equal(store.configured, false);
  assert.equal(storage.has("mihome.weapp.apiKey"), false);
  assert.equal(store.devices.length, 0);

  console.log("MobX 行为测试通过：设备/房间、详情、预览、写入、回滚、动作、权限与 Bearer 鉴权");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
