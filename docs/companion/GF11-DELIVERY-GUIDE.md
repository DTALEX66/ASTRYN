# GF11 小栖交接与交付指南

- 任务：GF11「小栖交接与宣传资产」（P1，依赖 GF10）。交付物 = 本指南 + 宣传采集（§7）+ 剩余工作台账（`docs/companion/REMAINING-WORK.md`）。
- 分支：`feat/astryn-learning-companion-v1`。封存源码树 sha256 `367b15793cfb7a2b88c3d486674916b869e89b37699dc9a6d05373a57b0d037f`（100 文件：contracts/src/dev-host/tests + 7 根文件），逐文件字节与 sha256 见收据 `docs/verification/gates.json` 的 `files[]`。
- 收据 generatedAt 2026-10-13T16:14:12.457Z；封存时分支头 `5b6bdef4d55abcb86e3f509b3018b6560db942e9`。
- 门禁：`.project-local/runs/gate-20261014-001359.log`，六阶段 lint / typecheck / test / build / record / anchors 全 `EXIT=0`；vitest 36 文件 / 319 通过。
- 声明纪律（验收条款 2：「交接只声称实测阶段」）：本指南只写实测基线；凡未实测项一律进台账，不以概念人物或未来服务冒充实测。
- 本轮改动：`PROJECT_CONTRACT.yaml`（补 GF10/GF11 记录与 execution_state）+ 文档三件（本指南、台账、STATUS 摘要）+ 收据重封存；**源码零改动**——除合同文件外，`contracts/src/dev-host/tests` 与 GF10 封存树逐字节一致（updater 以 `git diff HEAD` 断言）。

## 1 正式名称与角色来源（验收条款 1 前半）

| 字段 | 值 | 来源（可核验） |
|---|---|---|
| 项目正式名 | ASTRYN｜星栖 | `package.json` name/description；`PROJECT_CONTRACT.yaml` project.name/chinese_name |
| 默认角色 | 小栖 | `PROJECT_CONTRACT.yaml` project.default_character；`assets/character/STATE-ASSET-INDEX.json` character.displayName |
| 角色来源 | 原创（original），内联 SVG 手写生成 | `assets/original/README.md`；`STATE-ASSET-INDEX.json` provenance.origin=original |
| 第三方素材 | 无 | `assets/third-party/` 为空（仅 .gitkeep）；CI 有「第三方目录必须为空」扫描 |
| 真人素材红线 | 禁止（不得把真人照片/截图裁作产品人物资产） | `STATE-ASSET-INDEX.json` provenance.note；`assets/character/README.md` 规则 2 |
| 产品内自述 | 「小栖 · 星栖」「我是小栖，星栖里的 AI 角色，不是真人。」+ 合成徽标 `scripted-synthetic / SYNTHETIC` | 采集 11（§7）浏览器实测 |
| 外观升级位 | v2 = PENDING_EXTERNAL（MINIMAX DESIGN；简报 `docs/companion/GF03-VISUAL-ASSET-BRIEF.md`） | `STATE-ASSET-INDEX.json` versions v2；未回传前画面 100% 为 v1 内联 SVG，不得宣称已升级 |

## 2 用户如何关闭或调整陪伴（验收条款 1 后半）

| 能力 | 控件（data-testid） | 行为 | 门禁锚点 |
|---|---|---|---|
| 关闭/恢复角色 | `astryn-hide` | 隐藏角色；隐藏期间会话不取消，恢复后记录完整 | tests/presentation/companion-shell.test.tsx:101；composer-continuity.test.tsx:123、162；host-slots.test.tsx:138 |
| 减少动效 | `astryn-toggle-motion` | 一键切换减少动效（文案 减少动效/启用动效） | companion-settings.test.tsx:123、126；companion-shell.test.tsx:99 |
| 设置面板 | `astryn-settings-toggle` | 打开身份/人设/风格/主动性/学习/外观/声音七节 | companion-settings.test.tsx:33 |
| 人设切换 | `astryn-persona-{learning,close_companion,girlfriend_style_opt_in}` | 单选；亲密语气须本人显式选择才有说明条 | companion-settings.test.tsx:36-38、66-67、76、87 |
| 回复长度 | `astryn-reply-length` | balanced/brief 切换；共享会话三槽同步 | companion-settings.test.tsx:144；shared-session.test.tsx:106-109 |
| 声音偏好 | 声音节开关（朗读/麦克风/字幕） | 可编辑、可保存；未接通时运行按钮（试听一段/停止朗读/按住说话）禁用并显示原因 | voice-settings.test.tsx:76-100、132-134 |
| 关闭陪伴的语义 | — | 隐藏 ≠ 取消会话；停止 = 取消请求（GF07 原子复位） | GF07 文档 §语义表 |

保存落点：档案 revision 递增（本轮实测 0→1），开发宿主为进程内存储（EPHEMERAL_DEV_MEMORY）；正式宿主持久化归 BE06（台账 A 表）。

## 3 导出入口

源码级入口（包名 `@astryn/core`，private，UNLICENSED）：

| 入口 | 别名 | 定义处 |
|---|---|---|
| `src/index.ts` | `@astryn/core` | vite.config.ts:38-39（构建与 vitest 同源解析） |
| `contracts/index.ts` | `@astryn/contracts` | vite.config.ts:38 |

入口覆盖分组（全量导出清单见 `src/index.ts`，本表为分组索引）：

| 分组 | 代表导出 |
|---|---|
| 八类 Port 与协议契约 | contracts 全量：AstrynHostPort / AstrynConversationPort / AstrynMemoryPort / AstrynActionPort / AstrynContextPort / AstrynAvatarRenderer / AstrynPresentationMode / AstrynCharacterProfile、事件、状态、speech 提案 |
| 会话与编排 | reduceCompanionState、AstrynEventGuard、CompanionSessionManager、createCompanionSessionManager、AstrynCompanionController、prompt-composer、profile-store |
| 适配器 | AaosHostBridge（真实宿主，fail-closed）、OpenAiCompatibleConversationPort、SyntheticConversationPort、SyntheticHostSimulator、host-handshake（ASTRYN_PORT_MANIFEST / describePortAvailability / isCompatibleHostContract）、model-registry、sse |
| 记忆 | MemoryManager、decideLifecycle / decideRead / decideWrite、SyntheticMemoryFixture |
| 学习 | learning/types（intent/outcome/mastery/复习排程）、learning/store（LearningCompanionStore） |
| 语音外壳 | speech/playback（GF09 未接通禁用态外壳；不含任何真实语音） |
| 形象渲染 | avatar/*：state-visuals、xiaoqi-avatar、render-profiles、state-action-matrix、xiaoqi-svg-renderer |
| 呈现组件 | CompanionShell、AstrynCompanionEntry（正式宿主槽位入口）、CompanionSettings、CompanionView 原子、availableModes |

- 运行环境：node >= 20.19、npm >= 10（package.json engines）；react 18.3。
- 安装与发布：NOT_EXECUTED —— 本仓库未发布包、未做安装交付；融入主项目的方式是源码级引入 + 上述别名（或按需复制子集），见台账 D 表。

## 4 端口兼容矩阵（八端口）

`ASTRYN_PORT_MANIFEST`（src/adapters/host-handshake.ts:41-50）逐端口登记；fail-closed 三铁律：未接端口必须有明确原因、非空回执不充当签名（verify() 恒 NO_VERIFIER）、握手不推断只原样读。

| 端口 | 契约文件 | 归属 | 当前实现 | 本轮可用性 |
|---|---|---|---|---|
| host 宿主入口 | contracts/host.ts | 宿主 | AaosHostBridge（loopback 传输、fail-closed 握手）；SyntheticHostSimulator（合成） | 真实宿主不可用（BE12）；合成可用且界面标 SYNTHETIC |
| conversation 会话 | contracts/conversation.ts | 宿主 | OpenAiCompatibleConversationPort（经 dev 代理）、SyntheticConversationPort | 合成可用；真实模型 UNVERIFIED（A05） |
| memory 记忆 | contracts/memory.ts | 宿主 | MemoryManager 经端口；SyntheticMemoryFixture（进程内） | 合成可用；持久化归 BE06 |
| action 动作 | contracts/action.ts | 宿主 | 仅契约 + 任务状态机消费面 | 未接通（BE12） |
| context 上下文 | contracts/context.ts | 宿主 | SyntheticContextFixture + 选区授权提供器 | 合成可用；AAOS 知识通道未接通 |
| avatarRenderer 角色渲染 | contracts/avatar.ts | ASTRYN | xiaoqiSvgRenderer（原创内联 SVG，rendererId=xiaoqi-svg-v1） | 可用（v1） |
| presentationMode 呈现形态 | contracts/presentation.ts | ASTRYN | mode-registry + host-entry 三槽位（home/reading/sidebar） | 可用 |
| characterProfile 人物档案 | contracts/character.ts | ASTRYN | profile-store（v3，含 v1/v2 迁移） | 可用（开发内存） |

真实宿主接通所需：宿主注册表键名回填（各端口的 hostCapabilityCandidates 现为别名候选，命中前一律 fail-closed）+ 逐端口合同登记（BE01/BE05/BE06/BE12/FE18，见台账 A 表）。

## 5 人物源文件与资源清单

人物源文件（全部原创手写，无位图文件）：

| 文件 | 作用 |
|---|---|
| src/avatar/xiaoqi-avatar.ts | 「小栖」初始视觉（SVG 形状与配色） |
| src/avatar/state-visuals.ts | 状态→视觉令牌映射（九态） |
| src/avatar/state-action-matrix.ts | 状态→动作矩阵（含保留动作位） |
| src/avatar/render-profiles.ts | 呈现档（hero/avatar/sidebar） |
| src/avatar/xiaoqi-svg-renderer.ts | 渲染器登记（rendererId=xiaoqi-svg-v1） |
| contracts/character.ts | 档案契约、三套人设（learning / close_companion / girlfriend_style_opt_in） |
| src/presentation/* | 可复用呈现（壳/入口/设置/原子视图）与 astryn.css 令牌 |

资源清单（登记处 = `assets/character/STATE-ASSET-INDEX.json`，schema astryn.character-assets/v1）：

- v1 = 原创内联 SVG 基线，ACTIVE，永远保留（渲染失败或权利争议的回退下限）。
- v2 = 升级位图位，PENDING_EXTERNAL（MINIMAX DESIGN）；回传后落 `assets/character/upgraded/v1/` 并逐张登记文件名/用途/生成参数或种子/权利条款，激活前后均不删除旧版本。
- 目录规则：`assets/original/`（原创声明）、`assets/third-party/`（为空；引入第三方须先落许可证全文）。
- 红线：不得把真人照片/截图裁作产品人物资产；未登记文件不得被运行时引用；音素口型未实现不得宣称。
- 清单门禁：tests/boundary/character-assets.test.ts（清单↔契约九态/渲染档/rendererId/来源红线逐项钉住）。

## 6 使用说明（开发宿主与门禁）

命令表（package.json scripts）：

| 命令 | 作用 |
|---|---|
| `npm run dev` | Vite 开发宿主（默认 127.0.0.1:5183，可用 ASTRYN_DEV_HOST_PORT 覆盖） |
| `npm run dev:proxy` | 开发模型代理（loopback，默认 8791；密钥只存在于代理进程，绝不进浏览器） |
| `npm run typecheck` / `npm run lint` / `npm run test` / `npm run build` | 门禁四阶段（build 产物在 .project-local/artifacts，属开发工具输出） |
| `npm run verify` | 四阶段顺序跑 |
| `npm run record-gates` | 按日志重生成收据 docs/verification/gates.json |
| `bash .project-local/runs/gate-chain.sh` | 完整门禁链：四阶段 + record + verify-doc-anchors，写 `gate-*.log` 与 `anchors.json` |

浏览器验证：两个合成旗标分别放行「合成传输」（VITE_ASTRYN_ALLOW_SYNTHETIC=1）与「合成宿主模拟器」（VITE_ASTRYN_SYNTHETIC_HOST=1，审批/推进演示）；合成数据在界面必须显示 SYNTHETIC 标记，不得当作真实集成。示例：`ASTRYN_DEV_HOST_PORT=5289 VITE_ASTRYN_ALLOW_SYNTHETIC=1 VITE_ASTRYN_SYNTHETIC_HOST=1 npm run dev`。

CI：`.github/workflows/ci.yml`（m0-gates）只在 main push / PR 触发，node 20.19 与 22.12 双矩阵，跑 lint/typecheck/test/build + 凭据样式扫描 + 第三方资产目录扫描；功能分支推送不触发 CI，分支上的权威闸门是本地门禁链（本轮日志与收据见文首）。

## 7 宣传采集（本轮实测，五张）

全部为**开发宿主 · 合成阶段**实测截图（浏览器 127.0.0.1:5289，console 无 error；服务器已关停、端口已释放）。文件存 `.project-local/artifacts/`（本地产物按仓库规则不提交），哈希如下：

| 文件 | 字节 | sha256 | 场景 |
|---|---|---|---|
| m0-browser-11-gf11-welcome.png | 61570 | b93ffcdbe6e2aac250c5f75183e312649f8d168c7f9485ae6f8824f67c5b75a7 | 欢迎/初始界面：小栖·星栖 + 自述 + SYNTHETIC 徽标 + hero 形象 + 状态条 + 工具栏 |
| m0-browser-12-gf11-reading.png | 61354 | b9918c2c7848207f4800caef08e344ce1f0cb77a1542d38100854b82323bc583 | 阅读陪学：真实选区授权片段登记为材料 + 旅程进行中 + 解释按钮可用 |
| m0-browser-13-gf11-recall.png | 63336 | b06f8bb2d0785f997aded8608116102db5899f65fd47f8d707976b61f7a00d16 | 复述反馈：复述轮（带出处）→ 显式自评「想起来了」→ 出处对照原文 + 掌握度更新 |
| m0-browser-14-gf11-memory.png | 54261 | 48cf4c2096c3c590d1db067084cd20bba1775cb5a6df572de8d19b0874b3f89d | 记忆管理：候选登记（用户偏好）+ 独立读回 + 分离计数（记忆/材料/档案） |
| m0-browser-15-gf11-voice-reserved.png | 40719 | f9af5343b09fe4b5ade3686db295f9059b5223ac0e677cf6fce6314072409e06 | 待接声音保留状态：四能力芯片全「未接」+ BLOCKED 原因 + 运行按钮禁用 + 口型模式=文本帧 |

标注纪律：真实宿主采集（欢迎/阅读陪学/复述反馈/记忆管理四场景在正式宿主上的版本）BLOCKED_BY_HOST_CONTRACT（BE12/FE18），未完成；本组截图只证明开发宿主合成阶段，不得用作真实宿主或真实模型的宣传材料。采集时各场景的操作序列与断言见 §2/§6 引用的测试锚点与 `docs/companion/GF10-JOINT-ACCEPTANCE.md` §4 原始读数；复采按 §6 命令起服务后重放 GF10 剧本即可。

## 8 回退

| 层面 | 回退方式 |
|---|---|
| 本轮（文档轮） | `git revert` 本轮提交即可（改动 = 合同 + 文档 + 收据重封存；源码零改动） |
| 工程轮（GF01–GF09） | 每任务在 `docs/companion/PROGRESS.json` 记录 rollback_handle（文件级、行为替换与迁移说明） |
| 形象 | v1 内联 SVG 永远 ACTIVE；v2 只有在登记哈希与权利条款后才可激活；升级不删除旧版本 |
| 档案 | v1/v2 档案文件仍可解析（MIGRATED_V1_TO_V3 / MIGRATED_V2_TO_V3），回退不丢数据 |
| 收据 | 重跑门禁链即重新封存；`gate-chain.sh` 的收据来自日志字节而非手写 |

## 9 声明分级（本交接只承诺到此）

| 面 | 状态 | 依据 |
|---|---|---|
| 开发宿主端（合成阶段） | EXECUTED | 门禁 6×0、36 文件/319 测试；GF10 联合验收 + 本轮五张采集 |
| 真实宿主集成 | BLOCKED_BY_HOST_CONTRACT（BE12/FE18/BE05/BE06） | AAOS 侧宿主合同未登记；本仓库从不写宿主仓库 |
| 真实模型 | UNVERIFIED（A05） | 仅合成传输与 loopback 代理两条路径有测试证据；本轮回复全部来自零时延合成夹具 |
| 语音运行时 | BLOCKED_BY_HOST_CONTRACT（BE01） | 提案逐字冻结，前端字段先行；无 audio 元素、无占位语音（有门禁钉住） |
| 音素口型 | RESERVED（保留状态） | 口型模式=文本帧口型；音素选帧属未来口型驱动器 |
| 写实人物（v2 位图） | PENDING_EXTERNAL | MINIMAX DESIGN 未回传；不得宣称已升级 |
| 桌宠 / 3D / 跨窗音频 | deferred_scope | 任务包明列不在一期 |
| 安装与发布 | NOT_EXECUTED | 未发布、未安装 |

逐项剩余工作与建议顺序见 `docs/companion/REMAINING-WORK.md`。
