# 当前状态

日期：2026-10-13（Asia/Shanghai）

阶段：**M0 开发已执行**。开发宿主可运行、门禁全绿、契约与测试落地。真实模型 `NOT_TESTED`，AAOS 集成 `UNVERIFIED`。

## 本轮做了什么

在 `AGENT-START-PROMPT.md` 授权范围内连续推进 T00–T10：现场核验（`docs/verification/S0-BASELINE.md`）、AAOS 只读能力图谱（`docs/architecture/AAOS-HOST-CAPABILITY-MAP.md`）、九仓开源矩阵（`docs/research/OPEN-SOURCE-MATRIX.md`）、工程骨架（React 18.3.1 + TS 5.9.3 + Vite 5.4.21，对齐 AAOS 现行前端）、八类 Port 契约与事件状态机、原创小栖 SVG 角色与可复用 UI、开发宿主、仅开发环境的模型代理、记忆与授权上下文契约、85 项定向测试（第二轮复审后增至 118 项）与浏览器实测（`docs/verification/M0-VALIDATION.md`）、能力归属说明（`docs/architecture/ASTRYN-CAPABILITY-OWNERSHIP.md`）。

门禁：lint 0 / typecheck 0 / test 0（**118 passed，14 files**）/ build 0。字节锚点 `docs/verification/gates.json`。

## 第二轮：设计、无障碍与架构风险复审（同日）

用 `design-review` 与 `architecture-visualization` 技能套件独立复审第一轮成果。产出 `DESIGN.md`（设计契约，由测试钉住）、`docs/verification/design-a11y.md`、`docs/architecture/astryn-m0.structurizr.dsl` 三件套、`docs/architecture/astryn-m0.risk-quality.md`。

复审发现 **6 处在 108 项测试全绿下依然存在的真实缺口**（R1 渲染 seam 被 UI 绕过、R2 乱序检测只作用于本地重编号、R3 错误文本可带出上游凭据、R4 证据级别由配置推断为 REAL、R5 开发代理无来源校验、R6 可用性只在发消息时暴露），全部已修并各配回归测试。无障碍方面：axe 三视口×两状态 0 违规，且 `color-contrast` 的 incomplete 从 19–21 个节点降为 0（此前"0 违规"实为工具拒绝判定）；占位符与禁用态对比度、375px 横向溢出、焦点环、触控目标全部修复达标。

研究侧补齐方向 2/3/5/7/9 共 43 个候选（矩阵 §3），并纠正两处会被照抄的误解：`acceptFirstMouse` 是 macOS 专用而非鼠标穿透、`visibleOnAllWorkspaces` 在 Windows 不支持。

## 第三轮：小栖学习伴侣任务包接手（分支 `feat/astryn-learning-companion-v1`）

用户引用任务包 `03-ASTRYN-Companion-Taskpack.zip`（**6,023,444 字节**，sha256 `553db575…94f4`，58 条目；57/57 随包文件校验通过）作为 `ASTRYN-COMPANION-20261013` 的执行输入。已从 `a21495a` 建分支并执行 GF00：基线与范围见 `docs/companion/GF00-BASELINE-AND-SCOPE.md`，八类 Port readback 见 `docs/companion/source-ports-readback.json`（8/8 端口，blob sha 与包内 `SOURCE-INDEX.json` 逐项一致），进度账本 `docs/companion/PROGRESS.json`。宿主依赖 BE01/BE03/BE05/BE06/BE07/BE12 位于 `DTALEX66/ArcheAxis-Knowledge-OS`，本仓不写对方仓库；未正式化的宿主操作按 `BLOCKED_BY_HOST_CONTRACT` 记录，不以合成流补齐正式结果。main 侧 CI 最新绿 `38394262275 @ a21495a`（10 次运行 = 6 绿 4 红）。GF01（人物与关系档案）已完成：档案 schema v2、人格提示组装（`xiaoqi-system-2`）、配置视图与进程内开发回退存储，见 `docs/companion/GF01-PROFILE-AND-SETTINGS.md`；本机门禁六阶段全绿（树哈希 `6b299213…`，17 文件 136 测试），开发宿主经真实浏览器实测"选女友语气 → 保存 → 修订 1"；宿主档案持久化仍 `BLOCKED_BY_HOST_CONTRACT`（character.profile.read/write，BE06 + BE01 登记）。GF02（抽离共享会话管理器）已完成：`CompanionSessionManager` 拥有控制器与 transcript，多视图订阅同一状态、单飞提交、零视图暂停渲染推送、切呈现与改风格不丢会话、StrictMode 安全延迟终结，见 `docs/companion/GF02-SESSION-MANAGER.md`；门禁六阶段全绿（树哈希 `9a04f3a0…`，19 文件 147 测试），开发宿主浏览器实测共享会话与去重；宿主会话流（BE05）仍 `BLOCKED_BY_HOST_CONTRACT`。GF03（轻量人物资产与状态表现）工程侧已完成：三档呈现 profile（hero/avatar/sidebar）经渲染器 seam 接入、九状态-动作映射（文本事件帧驱动，明确非音素口型）、渲染失败文本回退（错误详情不入 DOM）、角色资产清单 `assets/character/STATE-ASSET-INDEX.json`（v1 原创 SVG ACTIVE，v2 升级资产 `PENDING_EXTERNAL` 交 MINIMAX DESIGN），见 `docs/companion/GF03-ASSETS-AND-STATES.md`；门禁六阶段全绿（树哈希 `59d3d7a1…`，23 文件 171 测试），开发宿主浏览器实测两档 profile（168×196 / 240×280）与零回退零溢出。GF04（八类宿主端口适配）已完成：宿主握手模块（`src/adapters/host-handshake.ts`，版本面/能力注册表解析 + 八端口 fail-closed 可用性推导，未接端口必带明确原因、未知不当可用）、launch token 头（`x-archeaxis-launch-token`，无 Origin）仅存在于适配器层、`verify()` 对 aaos-core 回执恒 `NO_VERIFIER`（非空回执/digest 不冒充签名）、轮询回执签名恒空串、渲染回退显式 `data-renderer-exact=false`、Dev Host 新增"宿主八端口核对"读数节，见 `docs/companion/GF04-HOST-ADAPTER.md`；门禁六阶段全绿（树哈希 `05661b85…`，26 文件 223 测试；首跑暴露 4 处测试夹具类型错误，修复后重跑，未豁免），开发宿主 DOM 实测 8 行端口读数（5 行未接带 HOST_CONTRACT_MISSING 原因 + 3 行 ASTRYN seam 可用）与 0 控制台错误。GF05（资料学习与陪伴融合）已完成：六类学习意图驱动的资料学习闭环（`src/learning/types.ts` + `src/learning/store.ts`：尝试/提示/解释/复述/出处反馈/复习；掌握度恒由显式自评驱动 `explicit-user-outcomes-only`，角色轮永不参与；角色轮出处仅来自真实附带过的授权片段；闲聊 `COMPANION_CHAT_EXCLUDED`、无来源 `SOURCE_UNLINKED`、知识登记 `autoCapture=false` 永不自动；提醒关闭/专注模式只抑制提示不清队列），开发宿主新增学习面板（材料库/旅程/手工练习/显式自评/复习队列/上下文标签记录），见 `docs/companion/GF05-LEARNING-JOURNEY.md`；门禁六阶段全绿（树哈希 `db462aab…`，28 文件 266 测试；tsc 首跑揪出 3 处真实类型缺陷，修复后重跑，未豁免），浏览器实测完整闭环（选区登记→解释→授权片段出处→尝试/复述/自评→掌握度与复习排程；无模型下手工闭环照常、解释禁用并标注原因；全新加载 0 控制台错误）。同时修复两处 M0 遗留开发宿主缺陷：选区提供器 `selection:null` 死路径（浏览器内恒 `NO_SELECTION`）改为实时偏移传入夹具、学习面板 `modelAvailable` 现如实反映"无模型"开关；真实选区与学习持久化仍 `BLOCKED_BY_HOST_CONTRACT`。GF06（记忆查看纠正与遗忘）已完成：星栖侧记忆治理台（`src/memory/manager.ts`——查看获准作用域与记录来源、纠正、忘记、导出、停用），治理动作全部经宿主记忆端口且每次动作后用新鲜 `query`+`listForReview` 独立读回（期望来自操作语义；谎报端口证伪测试证明读回不是回执复述），撤销保留审计痕迹、删除从账本除名，停用=先真实撤销活跃记录再拦截本机登记（宿主 grant 变更 `BLOCKED_BY_HOST_CONTRACT`），开发宿主新增记忆管理面板（四空间分开说明：聊天记录/长期记忆/当前上下文/备份保留；分离计数显示遗忘不触碰档案与学习事实），见 `docs/companion/GF06-MEMORY-GOVERNANCE.md`；门禁六阶段全绿（树哈希 `0075b9e1…`，30 文件 278 测试），浏览器 DOM 实测完整治理链（登记→纠正→撤销→删除→停用→恢复→导出，读回文字逐条在场；已删除记录不出现在导出；学习材料计数不受记忆操作影响；全新加载 0 控制台错误）；确认回执面（candidate→confirmed）属宿主治理，开发宿主不提供确认按钮，真实长期记忆库（BE06）仍 `BLOCKED_BY_HOST_CONTRACT`。GF07（真实文本流与取消恢复）已完成：正式流合同新增可选端口能力 `lookupRequest`（completed/in-progress/not-found/unknown）与未知结果失败码集合（NETWORK/TIMEOUT/MALFORMED_STREAM/ABORTED/UNKNOWN），重试保留输入与材料标签并以新 requestId 重发；未知执行结果先查询原请求再决定——completed/in-progress ⇒ `HELD_BACK` 扣留不重发（防重复执行）且输入放回输入框，端口无查询能力 ⇒ `RESENT_WITHOUT_LOOKUP` 如实标注（宿主合同缺项），已知未执行 ⇒ 不查询直接重发；停止与关视图不同：隐藏角色不取消会话（隐藏期间跑完、恢复可见），用户停止 ⇒ 候选已停止（ABORTED）且取消后晚到的增量与迟到权威任务事件被 `SETTLED_REQUEST` 静默丢弃（补证词测试）；合成夹具 `lookupRequest` 对已结束请求恒 not-found（不写正式记录）；输入框改为受控草稿（设置开关/隐藏/失败重试都不吞输入），材料标签条与重试条入 UI，见 `docs/companion/GF07-STREAM-AND-RETRY.md`；门禁六阶段全绿（树哈希 `d0a223a0…`，32 文件 293 测试），浏览器 DOM 实测停止→重试→先查询（宿主无该请求记录）→重发完成全链路与草稿连续性（全新加载 0 控制台错误）；真实模型上游本会话未配置，「真实调用可用」保持 `UNVERIFIED`（与 A17 同口径），开发代理端口未实现查询能力、AAOS 侧原请求查询面 `BLOCKED_BY_HOST_CONTRACT`。

验收：A00–A04、A06–A16 为 PASS（A01 为 PARTIAL），A05 `NOT_TESTED`、A17 `UNVERIFIED`、A18/A19 `NOT_EXECUTED`。**整体 M0 = PARTIAL**，逐项证据见 `docs/tasks/M0-ACCEPTANCE-TRACKER.md`。

## 现场事实（本轮实测，勿从历史推断）

- **本地已是 Git 仓库并已上远端**：用户指令"全部上传"构成该操作授权（D015）。`git init -b main` → 7 个正向提交 `b42eee2`（M0 全量）→ `5603f34`（归档按字节 + 测试去掉字面凭据样式）→ `6aa9785`/`ce07148`/`eb1f4b5`（文档回填与回执刷新）→ `2a671f6`（文档正文不再出现字面凭据样式）→ `9cf9a44`（如实记录 CI 过程），HEAD `9cf9a44441d24706211633f0759146872a726a0c` 与服务端 `refs/heads/main` 逐字符一致（本轮 `gh api commits/HEAD` 实测）。**未 force push、未改写已发布历史**；推送前确认远端为 0 ref，不存在覆盖他人工作。
- 仓库是 **public**：105 个文件已公开可见。文档内已参数化用户目录（`$HOME` 形式），不再含 Windows 用户名；`E:\` 仅出现在"未访问 E 盘"的声明句里。
- 行尾策略：`.gitattributes` 统一 LF，`docs/tasks/archive/**` 显式 `-text -eol` 按字节原样存储，归档 SHA-256 与收据一致（CI 首跑拦出的缺陷，已修）。
- 远端 CI：最新绿 run **38326024723** @ `9cf9a44`（Node 20.19 / 22.12 双矩阵各 10 步 success）。main 上累计 7 次运行 = 3 绿 4 红，逐次归因见台账 A18：秘密扫描那一步 4 次拦下我们自己写进测试与文档正文的字面凭据样式；另有一次本地 `test=0` 回执是误报（那次 shell 未把 node 放进 PATH，vitest 根本没跑）。**归档被行尾规范化破坏 SHA-256 那一条 CI 并没有拦到**，是推送后人工比对远端 blob 字节才发现的——已作为风险 Q9 登记，建议动作是给 CI 加一步字节保真断言。
- Git 全局配置含 `url.git@github.com:.insteadof=https://github.com/`，因此 origin 虽写作 HTTPS，实际走 SSH。未修改任何全局配置；提交身份沿用已有的 `DTALEX66`。
- AAOS 本地根存在且为 Git 仓库（核验时 HEAD `0574c3ac`，工作树干净）。本轮对 AAOS **零写入**。
- PATH 内无 node/npm；本轮绑定 `$HOME/AppData/Local/hermes/tools/node-26.7.0-win32-x64`（Node 26.7.0 / npm 11.19.0），npm 缓存限定在 `.project-local/runs/cache/npm`。

## 最短接续队列（T10）

按真实缺口排序，每项都标了所需授权；未获授权的项一律不自动推进。

| # | 任务 | 输入 | 范围 | 完成定义 | 所需授权 |
| --- | --- | --- | --- | --- | --- |
| 1 | ~~Git 关联方案定案并执行~~ **已完成** | 用户指令"全部上传"（D015） | `git init -b main` + 推送 DTALEX66/ASTRYN，未 force push | A01 PASS、A18 PASS（最新绿 run 38326024723 @ `9cf9a44`，双矩阵 success） | 后续 push/PR/release 仍需逐次确认 |
| 2 | 真实模型验证（A05） | 你提供的上游 base URL + 凭据 + 模型名；`VITE_ASTRYN_DEV_*` 与 `ASTRYN_DEV_MODEL_*` | 只跑通 `OpenAiCompatibleConversationPort` 与 dev 代理 | 一次真实流式回复 + 一次取消 + 一次上游错误，记录非敏感参数与结果，不保存私人正文 | 付费调用需明确许可；凭据只进代理进程环境 |
| 3 | AAOS 宿主契约确认（A17 前置） | `AAOS-HOST-CAPABILITY-MAP.md` §ASTRYN 侧结论 | 确认 `GenerationRequest`/`MemoryCandidateWrite`/`ConsumerIdentity`/`ActionExecution` 四项形状；确认星栖能否成为被命名 Consumer | 每个 Port 有可复核的 AAOS 端点/版本/权限依据，或明确记为合同缺失 | AAOS 侧只需读；若要 AAOS 新增消费者枚举，须**集成任务授权** |
| 4 | AAOS 原生挂载（P1） | 已实现的 `embedded`/`panel` 组件与 `AstrynHostPort` | 在 AAOS 前端内挂载星栖，接统一会话与 job 轮询 | 同一 AAOS 工作区内完成一次角色交互闭环，任务态来自真实 job 状态 | **修改 AAOS 正式源码需单独授权** |
| 5 | 记忆与选区真实接入（A11/A12 的 BLOCKED 部分） | 第 3 项结论 | 用真实端口替换合成夹具，保留夹具做回归 | 真实作用域读取 + 越权拒绝 + 用户可查看/删除，均标 INTEGRATED | 依赖第 1、3 项 |
| 6 | P2 形态与语音（floating/pet/voice-only、口型/打断） | `contracts/presentation.ts` 的阻塞声明、矩阵 §3.4/§3.5 | 需原生窗口与 AAOS ASR/TTS | 不在本轮范围，只保留接口 | 后续单独任务 |
| 7 | **收窄 `dispatch`（风险 Q1）** | `astryn-m0.risk-quality.md` §2 | 让权威事件只能经 `ingestReceipt` 进入；补"直接 dispatch 伪造权威事件在架构上不可达"的负向测试 | 该路径不可被 UI 或未来插件触达 | 可自主执行（本轮未做，列为下一步首位） |
| 8 | **AAOS 漂移检查（风险 Q2）** | `AAOS-HOST-CAPABILITY-MAP.md` | 只读脚本比对 AAOS 当前 HEAD 与图谱记录，漂移即红并纳入 `npm run verify` | 漂移可被自动发现，不靠人工记忆 | 可自主执行；写入 SHA 需 Git 授权 |
| 9 | **reduced-motion 真机验证（风险 Q7）** | `DESIGN.md` 验证节 | 用 CDP `Emulation.setEmulatedMedia` 实测动画停止，替换当前的 CSS 声明级断言 | 有一条浏览器级证据 | 可自主执行 |
| 10 | **CI 字节保真断言（风险 Q9）** | `docs/tasks/archive/ARCHIVE-RECEIPT.md` | 在 `ci.yml` 增加一步：对收据里的每个归档文件断言 `git cat-file -s` 与 `sha256sum` 等于记录值 | 植入一个字节改动即红；正常状态绿 | 可自主执行（本轮真实教训：该缺陷发生时 CI 全绿） |

P3（受控系统 Agent）、P4（多角色与生态）仍只保留接口，不纳入近期完成范围。

完整交接提示词（实测基线、环境绑定、架构不变量、AAOS 事实、坑清单、证据纪律、收尾格式）已固化为 `docs/tasks/AGENT-CONTINUATION-PROMPT.md`。

## 未执行事项（明确不做的原因）

未 `git init`/clone/commit/push（等方案定案）；未调用付费模型（无获准凭据）；未下载权重或素材（矩阵判定 M0 不需要）；未安装正式程序；未修改 AAOS、全局配置、SSH 或凭据；未访问 E:/F:；未扫描其他同级项目；未启用麦克风/摄像头/屏幕采集。
