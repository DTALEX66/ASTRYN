# ASTRYN M0 架构风险与质量审查

日期：2026-10-13。审查目标：**这套基础是否足以安全地接入 AAOS，以及哪里会在接入时伤人**。
证据基线：`astryn-m0.structurizr.dsl` + `astryn-m0.evidence.md` + `AAOS-HOST-CAPABILITY-MAP.md` + `M0-ACCEPTANCE-TRACKER.md` + `DESIGN.md`。
本轮所有结论都经过代码复核；**5 条风险经探针验证为真实缺口并已修复**，其余为已确认的残余风险。

严重度 = 影响 × 可能性；`P1` 需立即处理，`P2` 接入前处理，`P3` 监控。

## 1. 本轮验证并修复的缺口（原先被当成"已实现"）

| # | 缺口 | 证据（修复前） | 严重度 | 修复 | 回归 |
| --- | --- | --- | --- | --- | --- |
| R1 | **渲染 seam 是装饰**：`AvatarView` 直接 `import { renderXiaoqiMarkup }`，从不经过 `AstrynAvatarRenderer` 对象。换 Live2D/VRM 驱动时必须改 UI，违背"一套 UI 多种呈现"的核心承诺 | `grep` 显示 `companion-view.tsx:4` 导入具体函数，`xiaoqiSvgRenderer` 仅被 `index.ts` 导出、无任何调用方 | P1 影响：架构承诺失效 | 契约新增 `renderMarkup?` / `mount?` 双落地方式；建立 `AVATAR_RENDERERS` 注册表与 `selectAvatarRenderer()`；UI 只认注册表，并在 DOM 上落 `data-renderer` | `tests/boundary/architecture-risks.test.tsx` R1 三项（含未知 id 回退、每个驱动必须能落地） |
| R2 | **乱序检测名不副实**：`rebase()` 把宿主原始序号丢弃并换成本地重编号，守卫只对本地序号判单调 → 宿主真乱序时检测不到，而测试全绿 | `companion-controller.ts` rebase 只设 `seq`；守卫键 `${session}\|${request}` 与控制器键 `req:${request}` 各自独立 | P1 影响：迟到/乱序回复串台（正是 A07 要防的） | 信封新增 `originSeq`；守卫对原始序号独立判序，回退即 `OUT_OF_ORDER_ORIGIN_SEQ` | R2 两项：`seq` 递增但 `originSeq` 回退必须丢弃；无原始序号时行为不变 |
| R3 | **错误文本原样透传到界面**：`error.message` 直接进入 `stream.failed`。若用户把凭据写进 base URL（`https://user:tok@host`），undici 的错误信息会带出主机与凭据，并渲染进 DOM | `openai-compatible.ts` 四处 `error instanceof Error ? error.message : String(error)` 无过滤 | P2 影响：凭据泄漏面 | 新增 `redactErrorText()`：剥 URL / Bearer / key 样式并截断 240 字符，四处全部套用上 | R3 一项（URL、Bearer、超长、普通文本不误伤） |
| R4 | **证据级别由配置推断**：`OpenAiCompatibleConversationPort.evidenceLevel` 是类常量 `'REAL'`，只要配了模型名就自称 REAL，即使代理根本没起来 | `openai-compatible.ts:48` 常量；`model-registry.ts:71` 直接沿用 | P2 影响：违反"不得把配置宣称为集成" | 配置态降为 `NO_EVIDENCE`；只有真正收到非合成端口的 `stream.delta` 内容，reducer 才升级为 `REAL` | R4 两项（配置态 NO_EVIDENCE；无活动请求时不升级） |
| R5 | **开发代理无访问控制**：只绑 `127.0.0.1` 挡不住本机任意网页拿它当免费模型代理（混淆代理 / 配额盗用） | `dev-model-proxy.mjs` 全文无 origin/allow/token 判定 | P2 影响：真实凭据被本地第三方页面消耗 | POST 强制 `ALLOWED_ORIGINS` 白名单（默认只放行开发宿主端口），非白名单 403 `PERMISSION_DENIED`；无 Origin 视为本地 CLI 调用 | R5 一项（源码级断言白名单与拒绝码存在）+ 手工 curl 复验 |
| R6 | **可用性只在发消息时才暴露**：代理未启动时界面平静，用户必须发一条消息才知道没模型 | 无启动探测 | P3 影响：状态可见性 | `controller.attach()` 内调用 `refreshModelAvailability()`，不可用即派发 `model.unavailable` | R6 一项（attach 后无需发消息即出现 `MODEL_UNAVAILABLE`） |

> 这六条都不是"测试没写"造成的：R1/R2/R4 在 108 项全绿的情况下依然存在。**能骗过单元测试的，是结构性的自我引用**——测试断言的是我实现的那个通道，而不是承诺的那个通道。

## 2. 残余风险（本轮无法在授权范围内消除）

| # | 风险 | 证据 | 影响 / 可能性 | 现有缓解 | 建议动作 | 所需授权 |
| --- | --- | --- | --- | --- | --- | --- |
| Q1 | **`trust=authoritative` 不是安全边界**。星栖运行在浏览器同一 JS  realm 内，任何代码都能构造 `source:'host-task', trust:'authoritative'` 的事件；守卫只能保证"经过校验器的才权威"，不能阻止有人绕过校验器直接 `dispatch` | `companion-controller.dispatch()` 是公开方法；`AstrynReceiptVerifier` 只在 `ingestReceipt` 路径上被调用 | 高 / 中（P1 接入后若引入插件或远程内容即成真问题） | 事件构造集中在 controller；`rebase()` 强制降级传输层事件 | 把 `dispatch` 收窄为仅 controller 内部可达（或引入只有 bridge 能拿到的 capability token）；在 AAOS 侧对 job 结果做二次确认 | 需要 AAOS 侧接口设计参与 |
| Q2 | **AAOS 端点假设会过期**。模型与适配器按 2026-10-13 的 HEAD `0574c3ac` 建模，AAOS 一变即失真 | `AAOS-HOST-CAPABILITY-MAP.md`；`S0-BASELINE.md` §1 | 中 / 高（AAOS 活跃开发中） | 端点集中在 `AAOS_ENDPOINTS` 常量；证据索引逐条标 `medium` 置信度 | **仍开放**：增加只读漂移检查脚本，比对 AAOS 当前 HEAD 与文档记录，漂移即红并纳入 `npm run verify` | 脚本可自主加 |
| Q3 | ~~无版本锚点~~ **已关闭（D015）** | 本地已 `git init -b main` 并推送；`gates.json` 现同时记录 git HEAD 与源码树哈希 | — | 原为内容哈希替代方案 | 已升级为真锚点：`head 5603f3430d862410b852705dd55213e95eda2d52`，与服务端 ref 逐字符一致；后续 CI 结果可绑 exact SHA | 已闭环 |
| Q4 | **合成与真实只靠标签区分**。`SYNTHETIC` 徽标是渲染约定，若未来某个端口忘记声明 `evidenceLevel`，界面无法分辨 | `AstrynConversationPort.evidenceLevel` 为必填字段，但类型系统不校验其诚实性 | 中 / 中 | 三个端口都显式声明；UI 强制显示；`presentation-modes` 与 `architecture-risks` 测试覆盖 | 让宿主适配器成为 `evidenceLevel` 的唯一签发点（端口构造时由宿主注入，不由实现自填） | 可自主执行 |
| Q5 | **记忆/上下文真实接入完全缺位**（A11/A12 的宿主侧） | AAOS Consumer 闭集不含星栖；无"当前选区"合同 | 高 / 确定 | 契约显式返回 `BLOCKED_BY_HOST_CONTRACT`，未用夹具冒充 | 集成任务：与 AAOS 确认 Consumer 枚举与选区投影 | AAOS 集成授权 |
| Q6 | **真实模型从未跑过**（A05）。流式解析、取消、超时只有 stub 证据 | 无获准凭据 | 中 / 确定 | 合成与真实路径物理分离；`MODEL_UNAVAILABLE` 明确 | 用户提供凭据后跑一次真实三段验证（成功 / 取消 / 上游错误） | 用户授权 + 可能付费 |
| Q7 | **无障碍证据依赖单一工具**。axe 现在能判定全部节点（`incomplete=[]`），但 `reduced-motion` 的真实生效只做了 CSS 声明级断言 | `DESIGN.md` 验证节；`a11y-final.log` | 低 / 中 | 令牌与焦点环有门禁；`data-motion` 有 UI 测试 | 加一条 CDP `Emulation.setEmulatedMedia` 场景，实测动画确实停止 | 可自主执行 |
| Q8 | ~~CI 配置从未运行~~ **已关闭（D015）** | run 38324785775 @ `5603f34`：Node 20.19 与 22.12 两矩阵各 10 步 success | — | 首跑为红（run 38324323712），拦出测试内嵌字面凭据样式与归档被行尾规范化两个真实缺陷，均已在 `5603f34` 修复 | 已闭环；`engines >=20.19` 经两版本实测成立 | 已闭环 |

## 3. 质量属性判断

| 属性 | 判定 | 依据 |
| --- | --- | --- |
| 可测试性 | **强** | 14 文件 118 项，逻辑层无 React 依赖；契约层纯类型可独立断言 |
| 可维护性 | **中上** | 分层清晰、令牌集中；但 R1 说明"接口存在"与"接口被用"需要门禁来保证，现已补 |
| 可靠性（状态正确性） | **强** | 三重权威防线 + 显式拒收原因 + 审计可见；R2 修复后原始序号也受判序 |
| 安全性 / 隐私 | **中** | 密钥不进浏览器、代理 loopback + Origin 白名单、错误脱敏；残余在 Q1 |
| 可访问性 | **中上** | axe WCAG2/2.1 A+AA 0 违规且全部节点可判定；焦点环、触控目标、窄视口实测达标 |
| 性能 | **未评估** | 未做帧率与内存测量；构建产物 gzip 65 kB，无逐帧 filter/blend |
| 可移植性（接入 AAOS） | **弱，且是外部原因** | Q5/Q6 全部取决于宿主合同与凭据，不取决于星栖代码 |

## 4. 优先级修复顺序（下一步）

1. **P1｜Q3 无锚点** → 生成 `docs/verification/gates.json`（源码内容哈希 + 各门禁退出码 + 测试计数）。这是唯一能立刻做的证据加固，且不需要任何新授权。
2. **P1｜Q1 收窄 `dispatch`** → 让权威事件只能经 `ingestReceipt` 进入；补一条"直接 dispatch 伪造权威事件"的负向测试，断言其在架构上不可达。
3. **P2｜Q2 AAOS 漂移检查** → 只读脚本比对 AAOS HEAD 与能力图谱记录，纳入 `npm run verify`。
4. **P2｜Q7 reduced-motion 真机验证** → CDP 模拟媒体特性，断言动画停止。
5. **P3｜Q4 证据级别由宿主签发** → 与 P1 挂载设计一并决定，避免现在猜接口。

## 5. 本次审查的方法学结论

- **"0 违规"必须连同"未判定数"一起读**。axe 初次扫描报 0 违规，但同一次输出里 `color-contrast` 对 19–21 个节点是 incomplete——那是"没判"，不是"通过"。把渐变从文字层移开之后 incomplete 才归零。
- **单元测试全绿不等于浏览器正确，浏览器正确不等于架构承诺兑现**。R1/R2/R4 三条都在 jsdom 与 Chromium 双双通过的状态下被静态审查发现。
- **接缝要用门禁钉住，不是用注释钉住**。`contracts/avatar.ts` 早就写着"可替换渲染驱动"，但直到本轮才有测试要求 UI 必须经注册表取驱动。
