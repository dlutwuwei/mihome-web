Component({
  properties: {
    device: {
      type: Object,
      value: {},
    },
  },
  methods: {
    onTap() {
      this.triggerEvent("select", { device: this.data.device });
    },
  },
});
