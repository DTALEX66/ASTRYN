# M0 验收台账（2026-10-13 回填）

回填人：接手 AGENT。每项给状态与**本轮实际读到的证据**，命令与退出码见 `docs/verification/M0-VALIDATION.md`。
状态词：`PASS / PARTIAL / BLOCKED / NOT_TESTED / NOT_EXECUTED / FAIL / UNVERIFIED`；证据级别：`NO_EVIDENCE / SYNTHETIC / INTEGRATED / REAL`。

| ID | 验收 | 状态 | 证据级别 | 实际证据 |
| --- | --- | --- | --- | --- |
| A00 | 原任务归档无损 | PASS | REAL | 本轮重新计算：`ASTRYN-DEVELOPMENT-START-V1.0.txt` 实测 SHA-256 `866C151DB45E0D0ADFCAFA9F059A836DF859D830420B65AB95673FDD4B08450F`（20,960 字节 / 527 行），与 `ARCHIVE-RECEIPT.md` 记录的哈希逐字符相等 ⇒ MATCH=true。本轮未改写该文件；22 个既有文件全数保留（S0 §5） |
| A01 | 本地/远端身份正确，无错误重建 | **PARTIAL** | REAL | 远端：`git ls-remote` exit 0 且 0 ref + `api.github.com/repos/DTALEX66/ASTRYN` → HTTP 200、`size=0`、`visibility=public` ⇒ 仓库存在且为空，未被重复创建。本地：`.git` 不存在（`NOT_A_GIT_REPOSITORY`），本轮未 `git init`/clone ⇒ **本地-远端关联这一半未完成**，因 Git 方案需你确认（S0 §6 列 G1/G2/G3） |
| A02 | 宿主按文档启动 | PASS | SYNTHETIC | `npm run dev` → Vite ready 236 ms，`http://127.0.0.1:5183/` HTTP 200；embedded/panel 两模式类名与宽度实测切换（408/388px）；`presentation-modes.test.ts` 断言只承认这两种，其余带阻塞原因。级别为 SYNTHETIC：页面数据源是合成夹具 |
| A03 | 原创小栖可见 | PASS | REAL（画面）/ SYNTHETIC（数据） | 截图 `m0-browser-02-idle-v2.png`、`m0-browser-03-awaiting-approval.png`；几何断言 avatar 200×233 且 `>40×40`；来源声明 `assets/original/README.md`；`no-sensitive-apis.test.ts` 强制 `assets/third-party/` 为空；SVG 不含 `<image`/`href`/外部 URL |
| A04 | 表情动作由真实交互事件驱动 | PASS | SYNTHETIC | 浏览器：聚焦输入框 `idle→listening`（环色 `#5ad1c8→#7aa2ff`）；提交后 `data-expression-frame` 由 0 增至 **4**，等于真实到达的 delta 数（帧号在 reducer 内递增，不接受外部传入、无定时器）；审批时 `awaiting_approval`+`?`+琥珀环，完成时 `completed`+`✓`+绿环。测试：`companion-shell.test.tsx`、`approval-flow.test.tsx` |
| A05 | 配置真实模型时真实回复 | **NOT_TESTED** | NO_EVIDENCE | 无获准凭据，未付费、未借用其他项目密钥。已实现并静态验证：`OpenAiCompatibleConversationPort`（SSE 流式、取消、超时、503→MODEL_UNAVAILABLE）、loopback 代理 `dev-host/server/dev-model-proxy.mjs`、`.env.example` 配置路径。15 项适配器/SSE 测试用 stub 传输，级别为 SYNTHETIC，**不构成真实模型结论** |
| A06 | 缺模型/网络/调用错误明确显示 | PASS | SYNTHETIC | 浏览器：切"无模型"后提交 → 模型芯片 `MODEL_UNAVAILABLE`、错误条 `MODEL_UNAVAILABLE：未配置获准模型接口，星栖不使用脚本回复冒充 AI。`、日志中**无任何脚本回复**、状态 `interrupted`。测试：reducer/controller/openai-compatible 三处负向用例（503、NETWORK、MALFORMED_STREAM、ABORTED） |
| A07 | 取消/切换/卸载无旧回复串台 | PASS | SYNTHETIC | `guard.test.ts` 8 项（旧会话、重复/乱序序号、已结清请求迟到、未知请求、切会话）；`controller.test.ts`（取消后文本与帧号冻结、快速切换、切会话清空、dispose 后拒收）；`companion-shell.test.tsx` 卸载后无更新。实现点：`AstrynEventGuard` 三重身份 + `AbortController` + `reader.cancel()` |
| A08 | 任务状态只由权威回执驱动 | PASS | SYNTHETIC | 三重防线（类型层无"模型可表达完成"的类型、信封层 `isTaskAuthoritative`、校验层 verifier 缺失即降级）。负向测试：模型正文"任务已完成"→ `task.status` 仍 `none`（reducer + UI 各一处）；伪造 `source=conversation/trust=authoritative` → `TASK_EVENT_NOT_AUTHORITATIVE`；无校验器回执 → 同因拒收；重放 → `REPLAYED`；缺 `taskId` → 拒收。浏览器审批链路正向跑通并显示审计 |
| A09 | Host 契约具备版本/权限/关联事件 | PASS | SYNTHETIC | `contracts/protocol.ts`（`astryn-1` 版本、信封八字段、来源×可信矩阵、`parseAstrynEventEnvelope` 逐项校验）；八类 Port 齐备：Host/Conversation/Memory/Action/Context/AvatarRenderer/PresentationMode/CharacterProfile。`AaosHostBridge` 按实测端点建模（`AAOS_ENDPOINTS` 常量 + 能力图谱文件:行号引用）。测试：`authority.test.ts` 信封契约 9 断言、`guard.test.ts` |
| A10 | 无第二正式记忆主库或直接 AAOS DB 写入 | PASS | REAL（静态） | 源码扫描门禁禁 `sqlite`/`writeFileSync`/`createWriteStream`/`localStorage`/`indexedDB`/`document.cookie`；AAOS 全程只读（S0 §4 + 能力图谱声明零写入）；`SyntheticMemoryFixture` 是进程内 Map，`dispose()` 清空并有测试断言清空后查询失败 |
| A11 | 记忆作用域/隐私/虚构/候选/删除边界 | PASS（星栖侧契约）/ BLOCKED（生产读写） | SYNTHETIC | `policy.test.ts` 6 项：私密不外溢到 task/knowledge、未获准与过期授权拒绝、虚构不可晋升为事实、模型候选需 `aaos-core` 回执才可确认、撤销/删除、dispose 后不可读。真实宿主：`AaosMemoryPort.probe()` 明确返回"Consumer 闭集不含星栖"⇒ `BLOCKED_BY_HOST_CONTRACT` |
| A12 | 授权选中文本与来源契约 | PASS（SYNTHETIC 夹具）/ BLOCKED（真实接入） | SYNTHETIC / NO_EVIDENCE | `selection.test.ts` 6 项：能力自述、不支持作用域不发授权、授权后返回 `sourceId/sourceVersion/provenance=synthetic-fixture`、无选区 `NO_SELECTION`、过期 `AUTHORIZATION_EXPIRED`、伪造授权号 `PERMISSION_DENIED`。浏览器：未选中就点"解释选中内容"→ 拒绝并提示，不伪造上下文。AAOS 无"当前选区"合同 ⇒ 真实接入 `BLOCKED_BY_HOST_CONTRACT` |
| A13 | 默认无录音/摄像头/采屏/系统命令 | PASS | REAL（静态）+ REAL（运行） | 源码扫描禁 `getUserMedia`/`mediaDevices`/`MediaRecorder`/`getDisplayMedia`/`desktopCapturer`/`child_process`；运行期控制台 0 error/0 warning，无任何权限请求提示；宿主边界声明区在页面上明示 |
| A14 | lint/typecheck/unit/build | PASS | REAL | 四道退出码全 0：lint 0、typecheck 0、test 0（**118 passed / 14 files**）、build 0（199.41 kB / gzip 65.07 kB）。首轮并非全绿，过程与修复记录在验证报告 §1；本轮结果已绑定字节锚点 `docs/verification/gates.json`（源码树 64 文件，sha256 `b529388fce9ce9c78a57…`） |
| A15 | 无秘密/无许可素材/权重/私人数据 | PASS | REAL | lockfile 320 包许可总账（无 GPL/AGPL/LGPL；唯一 CC-BY-4.0 是构建期数据集 `caniuse-lite`，见 DEPENDENCIES.md §3）；密钥样式扫描禁 `sk-…`/私钥块；`assets/third-party/` 空；`.gitignore` 排除 `.env`/`*.sqlite`/`*.safetensors`/`*.gguf`/`.project-local/`；请求体测试断言不含 `api_key`/`authorization`；未提交任何个人对话或运行数据 |
| A16 | AAOS 工作树/队列未被修改 | PASS | REAL | 对 AAOS 仅执行只读命令（`ls`/`sed -n`/`grep`/`git rev-parse`/`git log -1`/`git status --short`）与文件读取；唯一写入是 ASTRYN 内的 `docs/architecture/AAOS-HOST-CAPABILITY-MAP.md`。核验时 AAOS HEAD `0574c3ac`、分支 `codex/conversation-closure-20261013`、工作树干净。未访问 E:/F:，未扫描其他同级项目 |
| A17 | 真实 AAOS 集成 | **UNVERIFIED** | NO_EVIDENCE | 能力图谱结论：Core 无通用流式 chat completion（AAOS 自己用双方法 404 测试断言其不存在）；记忆晋升永远 human-only 且 Consumer 枚举不含星栖；无"当前选区"广播；无事件推送面（只能轮询 job）。星栖侧适配器已按这些事实实现，但**没有一次真实宿主调用** |
| A18 | 远端 CI | NOT_EXECUTED | NO_EVIDENCE | `.github/workflows/ci.yml` 存在（node 20.19/22.12 矩阵 + 五道门禁 + 两项秘密/素材自查），但本地非 Git 仓库、无远端授权 ⇒ 只是配置，不报 CI PASS |
| A19 | 已安装运行/用户验收 | NOT_EXECUTED | NO_EVIDENCE | 未安装任何正式程序；本轮浏览器验证不等于你的验收 |

## 2. 整体判定

**M0 = PARTIAL（可运行、可测试、契约完整；真实模型与真实宿主两项外部依赖未完成）。**

已达成启动任务的实质衡量标准前半段：星栖拥有了自己的可运行角色体验（A02–A04、A06–A08 全绿），建立了与 AAOS 一致的能力边界（A09–A13、A16 全绿），并留下了可直接接入 AAOS 的工程基础（类型化 Host Adapter + 按实测端点建模的桥）。

未达成的是必须依赖外部授权的两项：A05（真实模型凭据）与 A17（AAOS 集成任务），以及 A01 的 Git 关联（等你定方案）。A19 由你判定。

依据台账原有规则：**A05/A17 未通过，整体不得写成全项 COMPLETE。**

## 3. 追加：设计、无障碍与架构风险复审（2026-10-13 第二轮）

用 design-review 与 architecture-visualization 技能套件对本轮成果做了独立复审，产出：

| 产物 | 内容 |
| --- | --- |
| `DESIGN.md` | 呈现层设计契约。令牌值与对比度由 `src/presentation/astryn.css` + `src/avatar/state-visuals.ts` 程序化提取计算，非肉眼估计 |
| `docs/verification/design-a11y.md` | axe（WCAG2/2.1 A+AA）三视口×两状态扫描结论、键盘可达性实测、修复清单 |
| `docs/architecture/astryn-m0.structurizr.dsl` + `.architecture-understanding.md` + `.evidence.md` | C4 系统全景 / 容器 / 组件模型，逐节点逐边证据索引 |
| `docs/architecture/astryn-m0.risk-quality.md` | 风险登记册：**6 条被证实为真实缺口的"看起来已实现"**（R1-R6，已修 + 回归），8 条残余风险（Q1-Q8，含所需授权） |
| `docs/verification/gates.json` | 门禁回执与源码树内容哈希（无 Git 时的替代锚点） |
| `docs/research/OPEN-SOURCE-MATRIX.md` §3 | 方向 2 / 7 / 9 补研（25 个新候选），P2 渲染路线收敛为 Rive 优先 |

受影响的验收项：**A03/A04**（角色画面在复审中重画两次并重新取证）、**A13**（新增无障碍与键盘可操作性证据）、**A14**（测试 85 → 118，新增 `design-tokens` 与 `architecture-risks` 两组门禁）、**A15**（新增依赖许可总账与硬编码色归零断言）。判定不变：整体 **PARTIAL**，A05/A17 仍未通过。

其中 A04 的强化值得单列：复审发现渲染 seam 被 UI 直接绕过（R1）、乱序检测只作用于本地重编号而非宿主原始序号（R2），两者都在 108 项测试全绿的状态下存在，现已修复并各补回归测试。

## 4. 本轮新发现的缺陷（已修，附回归）

| 缺陷 | 发现途径 | 修复 | 回归 |
| --- | --- | --- | --- |
| 切换模型来源后控制器仍指向旧端口 | 浏览器实测 | `companion-shell.tsx` 在 `deps` 变化时重建控制器 | A06 场景复测通过 |
| 构造函数内订阅宿主 → StrictMode 下幽灵订阅者消耗一次性回执，审批卡永不出现 | 浏览器实测（jsdom 全绿也照样漏） | 构造改为纯的，订阅只在 `attach()`；补 `lastVerification` 审计 | `authority.test.ts`"构造控制器不得订阅宿主" |
| 手工拼装的回执缺 `payload.kind` 时绕过权威检查、静默落空 | 上述排查过程中暴露 | 守卫新增 `INVALID_EVENT_KIND`；任务权威检查前置于关联身份 | `guard.test.ts` |
| `cancel()` 先结清请求再派发 `turn.cancelled`，导致取消事件被自己丢弃 | 单元测试 | 改为先派发后结清 | `controller.test.ts` 取消用例 |
| fetch 中止后挂起的 `reader.read()` 不返回 | 单元测试 | 中止时 `reader.cancel()` | `openai-compatible.test.ts` 取消用例 |
| `companion-shell.tsx` 混导出非组件符号 → Fast Refresh 失效 | 浏览器控制台 | `availableModes` 移入 `mode-registry.ts` | 手动复测 |
