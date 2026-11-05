interface AppGlobalData {
  appName: string;
}

interface AppCustom {
  globalData: AppGlobalData;
}

App<AppCustom>({
  globalData: {
    appName: "Smart Home",
  },
});
