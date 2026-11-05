import { createStoreBindings } from "mobx-miniprogram-bindings";
import { deviceStore } from "../../stores/deviceStore";
import type { Device, RoomSummary } from "../../types";

type StoreBindingsManager = ReturnType<typeof createStoreBindings>;

interface DevicesData {
  devices: Device[];
  filteredDevices: Device[];
  rooms: RoomSummary[];
  selectedRoom: string;
  selectedRoomScrollId: string;
  loading: boolean;
  error: string;
  warning: string;
  configured: boolean;
  onlineCount: number;
  accountCount: number;
  averageTemperatureText: string;
  averageHumidityText: string;
  comfortText: string;
  heroTone: string;
}

interface DevicesCustom {
  storeBindings?: StoreBindingsManager;
  onRoomTap(event: WechatMiniprogram.TouchEvent): void;
  onDeviceSelect(event: WechatMiniprogram.CustomEvent<{ device: Device }>): void;
  onSettingsTap(): void;
  onRetryTap(): void;
}

Page<DevicesData, DevicesCustom>({
  data: {
    devices: [],
    filteredDevices: [],
    rooms: [],
    selectedRoom: "全部",
    selectedRoomScrollId: "room-0",
    loading: false,
    error: "",
    warning: "",
    configured: false,
    onlineCount: 0,
    accountCount: 0,
    averageTemperatureText: "--",
    averageHumidityText: "",
    comfortText: "",
    heroTone: "",
  },

  onLoad() {
    this.storeBindings = createStoreBindings(this as unknown as WechatMiniprogram.Component.TrivialInstance, {
      store: deviceStore,
      fields: [
        "devices",
        "filteredDevices",
        "rooms",
        "selectedRoom",
        "selectedRoomScrollId",
        "loading",
        "error",
        "warning",
        "configured",
        "onlineCount",
        "accountCount",
        "averageTemperatureText",
        "averageHumidityText",
        "comfortText",
        "heroTone",
      ],
      actions: ["setRoom", "loadDevices"],
    });
  },

  onShow() {
    // 绑定数据在 wx.nextTick 后才写入 data，不能依赖 this.data.configured 判断。
    deviceStore.loadDevices().catch(() => {});
  },

  onUnload() {
    if (this.storeBindings) this.storeBindings.destroyStoreBindings();
  },

  onPullDownRefresh() {
    deviceStore
      .loadDevices()
      .catch(() => {})
      .finally(() => wx.stopPullDownRefresh());
  },

  onRoomTap(event: WechatMiniprogram.TouchEvent) {
    const { room, index } = event.currentTarget.dataset;
    const fallback = (this.data.rooms || [])[Number(index)];
    const name = room || (fallback && fallback.name);
    if (!name) return;
    deviceStore.setRoom(String(name));
    // 立即把 MobX 变更刷进 data，避免个别基础库 nextTick 未及时触发。
    if (this.storeBindings) this.storeBindings.updateStoreBindings();
  },

  onDeviceSelect(event: WechatMiniprogram.CustomEvent<{ device: Device }>) {
    const device = event.detail.device;
    wx.navigateTo({
      url: `/pages/device/index?accountId=${encodeURIComponent(device.accountId)}&did=${encodeURIComponent(device.did)}`,
    });
  },

  onSettingsTap() {
    wx.switchTab({ url: "/pages/settings/index" });
  },

  onRetryTap() {
    deviceStore.loadDevices().catch(() => {});
  },
});
