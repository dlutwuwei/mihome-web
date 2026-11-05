const { createStoreBindings } = require("mobx-miniprogram-bindings");
const { deviceStore } = require("../../stores/deviceStore");

Page({
  data: {
    showKey: false,
    confirmingClear: false,
  },

  onLoad() {
    this.storeBindings = createStoreBindings(this, {
      store: deviceStore,
      fields: ["baseUrl", "apiKey", "info", "connecting", "error", "accountCount"],
      actions: {
        updateBaseUrl: "updateBaseUrl",
        updateApiKey: "updateApiKey",
        saveConnection: "saveConnection",
        clearConnection: "clearConnection",
      },
    });
  },

  onUnload() {
    this.storeBindings.destroyStoreBindings();
  },

  onBaseUrlInput(event) {
    this.updateBaseUrl(event.detail.value);
  },

  onApiKeyInput(event) {
    this.updateApiKey(event.detail.value);
  },

  onToggleKey() {
    this.setData({ showKey: !this.data.showKey });
  },

  async onConnectTap() {
    try {
      await this.saveConnection();
      wx.showToast({ title: "连接成功", icon: "success" });
      setTimeout(() => wx.switchTab({ url: "/pages/devices/index" }), 500);
    } catch (error) {
      wx.showToast({ title: error.message || "连接失败", icon: "none", duration: 2500 });
    }
  },

  onClearTap() {
    this.setData({ confirmingClear: true });
  },

  onCancelClear() {
    this.setData({ confirmingClear: false });
  },

  onConfirmClear() {
    this.clearConnection();
    this.setData({ confirmingClear: false });
    wx.showToast({ title: "已清除接入信息", icon: "none" });
  },
});
