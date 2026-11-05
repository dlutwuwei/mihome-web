# mihome-web

## 控制面板的通用数据结构

面板不再由各个厂商适配器各自拼 UI，而是分三层，都在 `src/controls/`：

1. `VendorField` —— 适配器唯一要产出的东西：字段名 + 设备原始值 + 厂商规范已知的约束
   （`label` / `kind` / `unit` / `range` / `options` / `siid` / `piid` / `meta`）。
   适配器里不再留任何展示逻辑。
2. `DeviceProfile` + `FieldRule` —— 可配置的转换器档案，按
   `did`（单台设备）> `model`（型号）> `specType`（能力）> `vendor`（厂商默认）四层层级叠加，
   每层内部再按特异度排序：精确字段名 > 字面最长的通配 > 只写 `"*"` 的兜底。
   整份档案是纯 JSON，可以直接落盘。
3. `DeviceDetail` —— 由 `buildPanel(device, fields, actions)` 合成后下发给前端，
   每个属性带稳定的 `id`（字段名）、明确的 `kind`（控件类型）和归一化后的 `value`。
   前端按 `kind` 渲染，写回时把 `id` 带回来，由 `encodeFieldValue` 反查同一个档案做反向转换。

### 一份档案长这样

```json
{
  "id": "midea-ac-mode",
  "vendor": "midea",
  "match": { "model": ["KFR-*"] },
  "groups": { "控制": { "order": 1 }, "读数": { "order": 2 } },
  "order": ["power", "mode", "temperature"],
  "omit": ["*door_status*"],
  "fields": {
    "mode": {
      "label": "模式",
      "kind": "segmented",
      "writable": true,
      "group": "控制",
      "codec": "map",
      "codecArgs": { "table": { "0": "自动", "1": "制冷", "2": "除湿" } }
    },
    "*temperature*": { "codec": "shapenum", "kind": "slider", "min": 16, "max": 30, "unit": "°C" }
  },
  "actions": { "print": { "label": "上传打印" } }
}
```

- `codec` 只写名字，参数放 `codecArgs`，所以档案可以存成 JSON。内置转换器见 `GET /api/profiles/options`：
  `identity / bool / shape / shapebool / shapenum / auto / onoff / zeroone / numbool / number / scale / offset / map / duration`。
  `codec: "auto"` 表示由控件类型决定：开关读布尔、滑块读数字，写回时 `shape` 一类转换器按设备当前形态还原
  （同一字段在不同机型上可能是 `"on"` / `"1"` / `1` / `true`）。
- `kind` 缺省时按 `options` / `range` / 值类型推断；只读字段一律降级成文本，不会给出拖得动的控件。
- `omit` 在同一份档案里是硬排除；要救回被宽泛通配误伤的字段，用更高级别的档案（型号或 `did`）重声明 `hidden: false`。

### 配置落在哪里

- 内置档案：`src/controls/profiles/{xiaomi,midea,pantum}.ts`，启动时由 `bootstrapProfiles()` 注册。
- 运行时覆盖：`data/profiles/<vendor>/<id>.json`（可用 `MIHOME_PROFILE_DIR` 改目录），
  按文件 mtime 热生效，不用重启。
- HTTP：`GET /api/profiles`、`GET /api/profiles/options`、`GET /api/profiles/devices`、
  `GET /api/profiles/resolve?accountId=&did=`（看这台设备最终命中的档案链和每个字段的合并规则）、
  `PUT /api/profiles`（保存一份档案）。

## 设备信息分发（开放 API + API Key）

把当前登录账号（hub）下的设备信息分发给别的应用，鉴权走 API Key，服务端只存摘要不存明文。

### 链路

1. 站内登录（hub Cookie）后在侧栏「设备信息分发」里生成 Key，明文只在创建时展示一次。
2. 外部应用带 `Authorization: Bearer <key>` 调 `/api/open/*`。
3. Key 自身绑定所属 hub，`verifyApiKey` 通过 SHA-256 摘要索引定位，再以 `timingSafeEqual` 确认，
   再把该 hub 下所有厂商账号的设备分发出去；调用记录逐条落 `data/api-keys.json`。

### 权限范围

| scope | 覆盖接口 |
| --- | --- |
| `devices:read` | `/api/open/info`、`/accounts`、`/devices`、`/devices/:accountId/:did`、`/devices/:accountId/:did/props` |
| `devices:live` | `/api/open/live`、`/api/open/live/:did` |
| `devices:control` | `POST /devices/:accountId/:did/props`、`POST /devices/:accountId/:did/actions` |

缺 scope 返回 403，同样写进审计。控制类接口默认不勾选，按需再开。

### 管理接口（走站内登录态，不是 API Key）

- `GET /api/keys`、`GET /api/keys/scopes`：列出 Key（只有前缀，无明文）和可选范围。
- `POST /api/keys`：`{ name, scopes, expiresInDays }`，`expiresInDays: 0` 表示永久。
- `POST /api/keys/:id/enabled`：`{ enabled }` 临时停用，不删数据。
- `DELETE /api/keys/:id`：撤销并删除。
- `GET /api/keys/audit/requests?keyId=&limit=`：读调用记录；`POST /api/keys/audit/clear` 清空。

### 审计与防护

- 每个 `/api/open` 请求（含鉴权失败的）都记一条：时间、Key、方法、完整路径含 query、
  状态码、耗时、来源 IP、失败原因；query 中的 `apiKey` 会脱敏，上限 5000 条滚动，落盘合并到微任务批量写。
- 鉴权失败且无法定位归属的记录标 `unattributed`，只保留在服务端，不分发给任何 hub；
  按 `keyId` 筛选也始终限定当前 hub，避免跨账号读取审计。
- 同一 IP 连续无效 Key 请求会被限流（30 秒），有效请求不会计入失败次数，避免明文 Key 被暴力探测。
- 开放接口响应带 `Cache-Control: no-store`，避免设备数据和鉴权结果被缓存。
- Key 格式 `mihome_<id>_<48hex>`，界面只展示前缀；撤销 / 停用 / 过期立即生效。
