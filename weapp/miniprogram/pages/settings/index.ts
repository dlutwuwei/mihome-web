import { createStoreBindings } from "mobx-miniprogram-bindings";
import { deviceStore } from "../../stores/deviceStore";
import type { ApiInfo } from "../../types";

type StoreBindingsManager = ReturnType<typeof createStoreBindings>;

interface SettingsData {
  sheetVisible: boolean;
  permissionVisible: boolean;
  showKey: boolean;
  confirmingClear: boolean;
  baseUrl: string;
  apiKey: string;
  info: ApiInfo | null;
  connecting: boolean;
  error: string;
  accountCount: number;
}

interface SettingsCustom {
  storeBindings?: StoreBindingsManager;
  onOpenSheet(): void;
  onCloseSheet(): void;
  onOpenPermissionSheet(): void;
  onClosePermissionSheet(): void;
  onNoop(): void;
  onBaseUrlInput(event: WechatMiniprogram.Input): void;
  onApiKeyInput(event: WechatMiniprogram.Input): void;
  onToggleKey(): void;
  onConnectTap(): Promise<void>;
  onClearTap(): void;
  onCancelClear(): void;
  onConfirmClear(): void;
}

Page<SettingsData, SettingsCustom>({
  data: {
    sheetVisible: false,
    permissionVisible: false,
    showKey: false,
    confirmingClear: false,
    baseUrl: "",
    apiKey: "",
    info: null,
    connecting: false,
    error: "",
    accountCount: 0,
  },

  onLoad() {
    this.storeBindings = createStoreBindings(this as unknown as WechatMiniprogram.Component.TrivialInstance, {
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
    if (this.storeBindings) this.storeBindings.destroyStoreBindings();
  },

  onOpenSheet() {
    this.setData({ sheetVisible: true, confirmingClear: false });
  },

  onCloseSheet() {
    this.setData({ sheetVisible: false, confirmingClear: false, permissionVisible: false });
  },

  onOpenPermissionSheet() {
    this.setData({ permissionVisible: true });
  },

  onClosePermissionSheet() {
    this.setData({ permissionVisible: false });
  },

  onNoop() {},

  onBaseUrlInput(event: WechatMiniprogram.Input) {
    deviceStore.updateBaseUrl(event.detail.value);
  },

  onApiKeyInput(event: WechatMiniprogram.Input) {
    deviceStore.updateApiKey(event.detail.value);
  },

  onToggleKey() {
    this.setData({ showKey: !this.data.showKey });
  },

  async onConnectTap() {
    try {
      await deviceStore.saveConnection();
      this.setData({ sheetVisible: false });
      wx.showToast({ title: "连接成功", icon: "success" });
      setTimeout(() => wx.switchTab({ url: "/pages/devices/index" }), 500);
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : "连接失败";
      wx.showToast({ title: message, icon: "none", duration: 2500 });
    }
  },

  onClearTap() {
    this.setData({ confirmingClear: true });
  },

  onCancelClear() {
    this.setData({ confirmingClear: false });
  },

  onConfirmClear() {
    deviceStore.clearConnection();
    this.setData({ confirmingClear: false });
    wx.showToast({ title: "已清除接入信息", icon: "none" });
  },
});
