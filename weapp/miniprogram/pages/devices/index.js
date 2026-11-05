const { createStoreBindings } = require("mobx-miniprogram-bindings");
const { deviceStore } = require("../../stores/deviceStore");

Page({
  onLoad() {
    this.storeBindings = createStoreBindings(this, {
      store: deviceStore,
      fields: [
        "devices",
        "filteredDevices",
        "rooms",
        "selectedRoom",
        "loading",
        "error",
        "warning",
        "configured",
        "info",
        "onlineCount",
        "accountCount",
      ],
      actions: ["setRoom", "loadDevices"],
    });
  },

  onShow() {
    if (this.data.configured) this.loadDevices().catch(() => {});
  },

  onUnload() {
    this.storeBindings.destroyStoreBindings();
  },

  onPullDownRefresh() {
    const pending = this.data.configured ? this.loadDevices().catch(() => {}) : Promise.resolve();
    pending.finally(() => wx.stopPullDownRefresh());
  },

  onRoomTap(event) {
    this.setRoom(event.currentTarget.dataset.room);
  },

  onDeviceSelect(event) {
    const device = event.detail.device;
    wx.navigateTo({
      url: `/pages/device/index?accountId=${encodeURIComponent(device.accountId)}&did=${encodeURIComponent(device.did)}`,
    });
  },

  onSettingsTap() {
    wx.switchTab({ url: "/pages/settings/index" });
  },

  onRetryTap() {
    this.loadDevices().catch(() => {});
  },
});
