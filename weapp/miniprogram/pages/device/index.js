const { createStoreBindings } = require("mobx-miniprogram-bindings");
const { deviceStore } = require("../../stores/deviceStore");

function decode(value) {
  try {
    return decodeURIComponent(value || "");
  } catch {
    return value || "";
  }
}

Page({
  onLoad(options) {
    this.accountId = decode(options.accountId);
    this.did = decode(options.did);
    this.storeBindings = createStoreBindings(this, {
      store: deviceStore,
      fields: [
        "detail",
        "services",
        "featuredProperty",
        "detailLoading",
        "detailError",
        "busyKey",
        "actionBusyKey",
        "canControl",
      ],
      actions: [
        "loadDeviceDetail",
        "previewProperty",
        "writeProperty",
        "stepFeatured",
        "runDeviceAction",
      ],
    });
    this.refreshDetail();
  },

  onUnload() {
    this.storeBindings.destroyStoreBindings();
  },

  onPullDownRefresh() {
    this.loadDeviceDetail(this.accountId, this.did)
      .catch(() => {})
      .finally(() => wx.stopPullDownRefresh());
  },

  refreshDetail() {
    this.loadDeviceDetail(this.accountId, this.did)
      .then(() => {
        if (this.data.detail) wx.setNavigationBarTitle({ title: this.data.detail.device.name });
      })
      .catch(() => {});
  },

  showControlError(error) {
    wx.showToast({ title: error.message || "操作失败", icon: "none", duration: 2500 });
  },

  onGaugeChanging(event) {
    if (this.data.featuredProperty) this.previewProperty(this.data.featuredProperty.key, event.detail.value);
  },

  onGaugeChange(event) {
    if (!this.data.featuredProperty) return;
    this.writeProperty(this.data.featuredProperty.key, event.detail.value).catch((error) => this.showControlError(error));
  },

  onStepTap(event) {
    this.stepFeatured(Number(event.currentTarget.dataset.direction)).catch((error) => this.showControlError(error));
  },

  onSwitchChange(event) {
    this.writeProperty(event.currentTarget.dataset.key, event.detail.value).catch((error) => this.showControlError(error));
  },

  onOptionTap(event) {
    const { key, value } = event.currentTarget.dataset;
    this.writeProperty(key, value).catch((error) => this.showControlError(error));
  },

  onSliderChanging(event) {
    this.previewProperty(event.currentTarget.dataset.key, event.detail.value);
  },

  onSliderChange(event) {
    this.writeProperty(event.currentTarget.dataset.key, event.detail.value).catch((error) => this.showControlError(error));
  },

  onInputBlur(event) {
    const { key, numeric } = event.currentTarget.dataset;
    const value = numeric ? Number(event.detail.value) : event.detail.value;
    if (numeric && !Number.isFinite(value)) {
      this.showControlError(new Error("请输入有效数字"));
      this.refreshDetail();
      return;
    }
    this.writeProperty(key, value).catch((error) => this.showControlError(error));
  },

  onActionTap(event) {
    this.runDeviceAction(event.currentTarget.dataset.key)
      .then(() => wx.showToast({ title: "指令已执行", icon: "success" }))
      .catch((error) => this.showControlError(error));
  },

  onRetryTap() {
    this.refreshDetail();
  },
});
