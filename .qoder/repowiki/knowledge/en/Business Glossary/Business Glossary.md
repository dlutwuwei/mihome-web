---
kind: business_term
name: Business Glossary
category: business_term
scope:
    - '**'
---

### 设备信息分发
- Definition：The internal product feature that exposes a logged-in user's (hub's) device inventory to external applications through `/api/open/*`, authenticated by per-user API Keys with scoped permissions and full request auditing.
- Aliases：开放API、open API

### hub
- Definition：A logged-in user account context whose owned devices are grouped together; API Keys are bound to a single hub so distribution is scoped to that hub's devices and audit records.

### scope
- Definition：An API Key permission token (`devices:read`, `devices:live`, `devices:control`) that gates which `/api/open/*` endpoints a key may call; missing scope returns 403 and is recorded in audit.

### unattributed
- Definition：An audit record category for requests where authentication failed and the originating key could not be resolved; such records are retained server-side only and are never exposed to any hub's audit view.
