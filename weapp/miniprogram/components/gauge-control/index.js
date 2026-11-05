const { clampPropertyValue } = require("../../utils/device");

Component({
  properties: {
    value: { type: Number, value: 0, observer() { this.draw(); } },
    displayValue: { type: String, value: "--" },
    label: { type: String, value: "数值" },
    min: { type: Number, value: 0, observer() { this.draw(); } },
    max: { type: Number, value: 100, observer() { this.draw(); } },
    step: { type: Number, value: 1 },
    disabled: { type: Boolean, value: false },
  },

  lifetimes: {
    ready() {
      this.initializeCanvas();
    },
    detached() {
      this.canvas = null;
      this.context = null;
    },
  },

  methods: {
    initializeCanvas() {
      wx.createSelectorQuery()
        .in(this)
        .select("#level-gauge")
        .fields({ node: true, size: true })
        .exec((result) => {
          if (!result || !result[0] || !result[0].node) return;
          const canvas = result[0].node;
          const system = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
          const ratio = system.pixelRatio || 2;
          canvas.width = result[0].width * ratio;
          canvas.height = result[0].height * ratio;
          this.canvas = canvas;
          this.context = canvas.getContext("2d");
          this.context.scale(ratio, ratio);
          this.width = result[0].width;
          this.height = result[0].height;
          this.draw();
        });
    },

    draw() {
      const context = this.context;
      if (!context || !this.width) return;
      const width = this.width;
      const height = this.height;
      const centerX = width / 2;
      const centerY = height / 2;
      const radius = Math.min(width, height) / 2 - 30;
      const start = Math.PI * 0.75;
      const sweep = Math.PI * 1.5;
      const range = Math.max(0.000001, this.data.max - this.data.min);
      const progress = Math.min(1, Math.max(0, (this.data.value - this.data.min) / range));

      context.clearRect(0, 0, width, height);
      context.lineCap = "round";
      context.lineWidth = 13;
      context.strokeStyle = "#edf0f6";
      context.beginPath();
      context.arc(centerX, centerY, radius, start, start + sweep);
      context.stroke();

      if (progress > 0) {
        const gradient = context.createLinearGradient(0, height, width, 0);
        gradient.addColorStop(0, "#79c9b0");
        gradient.addColorStop(0.52, "#7684e6");
        gradient.addColorStop(1, "#a99be8");
        context.strokeStyle = gradient;
        context.beginPath();
        context.arc(centerX, centerY, radius, start, start + sweep * progress);
        context.stroke();
      }

      for (let index = 0; index <= 30; index += 1) {
        const angle = start + sweep * (index / 30);
        const active = index / 30 <= progress;
        const tickRadius = radius - 25;
        context.fillStyle = active ? "#727edc" : "#e1e4ed";
        context.beginPath();
        context.arc(
          centerX + Math.cos(angle) * tickRadius,
          centerY + Math.sin(angle) * tickRadius,
          active ? 2.2 : 1.5,
          0,
          Math.PI * 2,
        );
        context.fill();
      }

      const knobAngle = start + sweep * progress;
      const knobX = centerX + Math.cos(knobAngle) * radius;
      const knobY = centerY + Math.sin(knobAngle) * radius;
      context.fillStyle = "#ffffff";
      context.shadowColor = "rgba(64, 70, 125, 0.24)";
      context.shadowBlur = 10;
      context.beginPath();
      context.arc(knobX, knobY, 12, 0, Math.PI * 2);
      context.fill();
      context.shadowBlur = 0;
      context.fillStyle = "#626dcc";
      context.beginPath();
      context.arc(knobX, knobY, 6, 0, Math.PI * 2);
      context.fill();
    },

    updateFromTouch(event, finished) {
      if (this.data.disabled) return;
      const touch = event.touches[0] || event.changedTouches[0];
      if (!touch || !this.width) return;
      const x = typeof touch.x === "number" ? touch.x : touch.clientX - (this.canvasLeft || 0);
      const y = typeof touch.y === "number" ? touch.y : touch.clientY - (this.canvasTop || 0);
      const centerX = this.width / 2;
      const centerY = this.height / 2;
      const start = Math.PI * 0.75;
      const end = Math.PI * 2.25;
      let angle = Math.atan2(y - centerY, x - centerX);
      while (angle < start) angle += Math.PI * 2;
      if (angle > end) {
        const toEnd = angle - end;
        const toStart = start + Math.PI * 2 - angle;
        angle = toEnd < toStart ? end : start;
      }
      const ratio = Math.min(1, Math.max(0, (angle - start) / (end - start)));
      const property = {
        rangeMin: this.data.min,
        rangeMax: this.data.max,
        rangeStep: this.data.step,
        hasRange: true,
      };
      const value = clampPropertyValue(property, this.data.min + ratio * (this.data.max - this.data.min));
      this.pendingValue = value;
      this.triggerEvent(finished ? "change" : "changing", { value });
    },

    onTouchStart(event) {
      wx.createSelectorQuery().in(this).select("#level-gauge").boundingClientRect((rect) => {
        if (rect) {
          this.canvasLeft = rect.left;
          this.canvasTop = rect.top;
        }
      }).exec();
      this.updateFromTouch(event, false);
    },

    onTouchMove(event) {
      this.updateFromTouch(event, false);
    },

    onTouchEnd(event) {
      this.updateFromTouch(event, true);
    },
  },
});
