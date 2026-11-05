const assert = require("node:assert");

const storage = new Map();
const requests = [];

global.wx = {
  getStorageSync: (key) => storage.get(key) || "",
  setStorageSync: (key, value) => storage.set(key, value),
  removeStorageSync: (key) => storage.delete(key),
  nextTick: (fn) => Promise.resolve().then(fn),
  stopPullDownRefresh: () => {},
  navigateTo: () => {},
  switchTab: () => {},
  request(options) {
    requests.push(options);
    const responses = {
      "/api/open/info": {
        keyName: "客厅 Key",
        scopes: ["devices:read", "devices:live", "devices:control"],
        accounts: [{ id: "a1" }],
      },
      "/api/open/devices": {
        devices: [
          {
            accountId: "a1",
            did: "d1",
            name: "客厅空调",
            room: "客厅",
            online: true,
            live: [
              { name: "设定温度", text: "22°C" },
              { name: "室内温度", text: "24°C" },
              { name: "湿度", text: "48%" },
            ],
            services: [],
          },
          {
            accountId: "a1",
            did: "d2",
            name: "卧室空调",
            room: " 卧室 ",
            online: true,
            live: [{ name: "温度", text: "26°C" }, { name: "湿度", text: "52%" }],
            services: [],
          },
          { accountId: "a1", did: "d3", name: "卧室灯", room: "卧室", online: false, services: [] },
        ],
      },
      "/api/open/live": { live: {} },
    };
    const path = options.url.replace(/^https?:\/\/[^/]+/, "");
    const body = responses[path];
    if (body) {
      options.success({ statusCode: 200, data: body });
    } else {
      options.success({ statusCode: 404, data: { error: "not found" } });
    }
  },
};

storage.set("mihome.weapp.baseUrl", "http://127.0.0.1:8787");
storage.set("mihome.weapp.apiKey", "test-key");

global.Behavior = (definition) => definition;
global.Component = (definition) => definition;

let pageDefinition = null;
global.Page = (definition) => {
  pageDefinition = definition;
};

require("../miniprogram/pages/devices/index.ts");

function createPage() {
  const page = Object.create(pageDefinition);
  page.data = JSON.parse(JSON.stringify(pageDefinition.data || {}));
  page.setData = function setData(patch) {
    Object.assign(this.data, patch);
  };
  return page;
}

async function waitBindings() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

(async () => {
  const page = createPage();
  page.onLoad();
  page.onShow();
  await waitBindings();

  assert.strictEqual(page.data.devices.length, 3, "devices should load");
  assert.deepStrictEqual(
    page.data.rooms.map((room) => room.name),
    ["全部", "客厅", "卧室"],
    "rooms should be grouped"
  );
  assert.strictEqual(page.data.filteredDevices.length, 3, "all devices by default");
  assert.strictEqual(page.data.selectedRoomScrollId, "room-0", "default room should be scrollable");
  assert.strictEqual(page.data.averageTemperatureText, "25°C", "average ambient temperature should ignore setpoints");
  assert.strictEqual(page.data.heroTone, "hero-temp-mild", "hero tone should follow the average temperature");
  assert.strictEqual(page.data.averageHumidityText, "50%", "average humidity should be shown");
  assert.strictEqual(page.data.comfortText, "体感舒适", "comfort text should follow temperature and humidity");

  page.onRoomTap({ currentTarget: { dataset: { room: "卧室" } } });
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.strictEqual(page.data.selectedRoom, "卧室", "selectedRoom should update");
  assert.strictEqual(page.data.selectedRoomScrollId, "room-2", "selected room should scroll into view");
  assert.strictEqual(page.data.filteredDevices.length, 2, "filteredDevices should be filtered");

  page.onRoomTap({ currentTarget: { dataset: { room: "全部" } } });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.strictEqual(page.data.filteredDevices.length, 3, "filter reset should work");

  // 部分基础库会丢失 dataset 值，此时用索引回退仍应能筛选。
  page.onRoomTap({ currentTarget: { dataset: { index: 2 } } });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.strictEqual(page.data.selectedRoom, "卧室", "index fallback should select room");
  assert.strictEqual(page.data.selectedRoomScrollId, "room-2", "index fallback should scroll selected room");
  assert.strictEqual(page.data.filteredDevices.length, 2, "index fallback should filter");

  page.onUnload();
  console.log("page binding test passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
