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

## 未执行事项（明确不做的原因）

未 `git init`/clone/commit/push（等方案定案）；未调用付费模型（无获准凭据）；未下载权重或素材（矩阵判定 M0 不需要）；未安装正式程序；未修改 AAOS、全局配置、SSH 或凭据；未访问 E:/F:；未扫描其他同级项目；未启用麦克风/摄像头/屏幕采集。
