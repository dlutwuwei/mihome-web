import { createStoreBindings } from "mobx-miniprogram-bindings";
import { deviceStore } from "../../stores/deviceStore";
import type { DecoratedDetail, Property, Service } from "../../types";

type StoreBindingsManager = ReturnType<typeof createStoreBindings>;

interface DeviceData {
  detail: DecoratedDetail | null;
  services: Service[];
  featuredProperty: Property | null;
  detailLoading: boolean;
  detailError: string;
  busyKey: string;
  actionBusyKey: string;
  canControl: boolean;
}

interface DeviceCustom {
  accountId?: string;
  did?: string;
  storeBindings?: StoreBindingsManager;
  refreshDetail(): void;
  showControlError(error: unknown): void;
  onGaugeChanging(event: WechatMiniprogram.CustomEvent<{ value: number }>): void;
  onGaugeChange(event: WechatMiniprogram.CustomEvent<{ value: number }>): void;
  onStepTap(event: WechatMiniprogram.TouchEvent): void;
  onSwitchChange(event: WechatMiniprogram.CustomEvent<{ value: boolean }>): void;
  onOptionTap(event: WechatMiniprogram.TouchEvent): void;
  onSliderChanging(event: WechatMiniprogram.CustomEvent<{ value: number }>): void;
  onSliderChange(event: WechatMiniprogram.CustomEvent<{ value: number }>): void;
  onInputBlur(event: WechatMiniprogram.Input): void;
  onActionTap(event: WechatMiniprogram.TouchEvent): void;
  onRetryTap(): void;
}

function decode(value: unknown): string {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return String(value || "");
  }
}

Page<DeviceData, DeviceCustom>({
  data: {
    detail: null,
    services: [],
    featuredProperty: null,
    detailLoading: false,
    detailError: "",
    busyKey: "",
    actionBusyKey: "",
    canControl: false,
  },

  onLoad(options: Record<string, string | undefined>) {
    this.accountId = decode(options.accountId);
    this.did = decode(options.did);
    this.storeBindings = createStoreBindings(this as unknown as WechatMiniprogram.Component.TrivialInstance, {
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
    if (this.storeBindings) this.storeBindings.destroyStoreBindings();
  },

  onPullDownRefresh() {
    deviceStore
      .loadDeviceDetail(this.accountId || "", this.did || "")
      .catch(() => {})
      .finally(() => wx.stopPullDownRefresh());
  },

  refreshDetail() {
    deviceStore
      .loadDeviceDetail(this.accountId || "", this.did || "")
      .then(() => {
        const detail = this.data.detail;
        if (detail) wx.setNavigationBarTitle({ title: detail.device.name });
      })
      .catch(() => {});
  },

  showControlError(error: unknown) {
    const message = error instanceof Error && error.message ? error.message : "操作失败";
    wx.showToast({ title: message, icon: "none", duration: 2500 });
  },

  onGaugeChanging(event: WechatMiniprogram.CustomEvent<{ value: number }>) {
    const property = this.data.featuredProperty;
    if (property) deviceStore.previewProperty(property.key, event.detail.value);
  },

  onGaugeChange(event: WechatMiniprogram.CustomEvent<{ value: number }>) {
    const property = this.data.featuredProperty;
    if (!property) return;
    deviceStore.writeProperty(property.key, event.detail.value).catch((error) => this.showControlError(error));
  },

  onStepTap(event: WechatMiniprogram.TouchEvent) {
    const direction = Number(event.currentTarget.dataset.direction);
    deviceStore.stepFeatured(direction).catch((error) => this.showControlError(error));
  },

  onSwitchChange(event: WechatMiniprogram.CustomEvent<{ value: boolean }>) {
    const key = String(event.currentTarget.dataset.key || "");
    deviceStore.writeProperty(key, event.detail.value).catch((error) => this.showControlError(error));
  },

  onOptionTap(event: WechatMiniprogram.TouchEvent) {
    const { key, value } = event.currentTarget.dataset;
    deviceStore.writeProperty(String(key || ""), value).catch((error) => this.showControlError(error));
  },

  onSliderChanging(event: WechatMiniprogram.CustomEvent<{ value: number }>) {
    deviceStore.previewProperty(String(event.currentTarget.dataset.key || ""), event.detail.value);
  },

  onSliderChange(event: WechatMiniprogram.CustomEvent<{ value: number }>) {
    deviceStore
      .writeProperty(String(event.currentTarget.dataset.key || ""), event.detail.value)
      .catch((error) => this.showControlError(error));
  },

  onInputBlur(event: WechatMiniprogram.Input) {
    const { key, numeric } = event.currentTarget.dataset;
    const value = numeric ? Number(event.detail.value) : event.detail.value;
    if (numeric && !Number.isFinite(value)) {
      this.showControlError(new Error("请输入有效数字"));
      this.refreshDetail();
      return;
    }
    deviceStore.writeProperty(String(key || ""), value).catch((error) => this.showControlError(error));
  },

  onActionTap(event: WechatMiniprogram.TouchEvent) {
    const key = String(event.currentTarget.dataset.key || "");
    deviceStore
      .runDeviceAction(key)
      .then(() => wx.showToast({ title: "指令已执行", icon: "success" }))
      .catch((error) => this.showControlError(error));
  },

  onRetryTap() {
    this.refreshDetail();
  },
});
