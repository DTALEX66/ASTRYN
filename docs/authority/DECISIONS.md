# 当前决策与替代记录

| ID | 日期 | 决策 | 来源 | 状态 |
| --- | --- | --- | --- | --- |
| D001 | 2026-10-13 | ASTRYN 本地根目录为 D:\All projects\ASTRYN，预期远端 DTALEX66/ASTRYN | 用户明确指定 | 有效 |
| D002 | 2026-10-13 | 本轮归档任务并建立规范目录与权威索引，不执行归档中的 S0-S5 开发 | 当前请求 | 有效 |
| D003 | 2026-10-13 | 不自动初始化 Git；仓库关联继续标为 UNVERIFIED | 启动任务约束与当前事实 | 有效 |
| D004 | 2026-10-13 | 启动 M0 开发：授权范围为 AGENT-START-PROMPT.md 所列（ASTRYN 内实施 M0、项目内依赖与测试、Dev Host、交付文档） | 用户当前明确指令 | 有效；D002 的"本轮不执行 S0-S5"已被本条替代 |
| D005 | 2026-10-13 | 技术栈版本对齐 AAOS 现行前端（React 18.3.1 / TS 5.9.3 / Vite 5.4.21 / Vitest 2.1.9 / RTL 16.3.3 / jsdom 25.0.1），而非取最新 | P1 需作为 AAOS React 原生组件挂载，跨大版本无法互相挂载；实测依据 `AAOS/frontend/package.json` | 有效 |
| D006 | 2026-10-13 | 新增 ESLint 9 + typescript-eslint 8（AAOS 前端无 ESLint） | T03 要求 lint 门禁；属有意偏离，已记录 | 有效 |
| D007 | 2026-10-13 | M0 渲染路线：原创 SVG + renderer seam（`AstrynAvatarRenderer`），不同时引入 Live2D/VRM/3D 底座 | 九仓矩阵结论：可整体使用者要么形态冲突、要么素材/权重许可不完整；见 `docs/research/OPEN-SOURCE-MATRIX.md` | 有效 |
| D008 | 2026-10-13 | 任务状态权威三重防线：类型层无模型可表达"完成"的类型、信封层要求 `trust=authoritative` + `source∈{host-action,host-task}`、校验层无校验器即降级拒收 | 启动任务"所有任务状态必须来自真实系统事件"；A08 负向测试驱动 | 有效 |
| D009 | 2026-10-13 | 控制器构造保持无副作用，宿主订阅只在 `attach()` 建立 | 浏览器实测发现 StrictMode 重复调用初始化器会使被丢弃实例消耗一次性回执，导致审批卡永不出现（jsdom 测试全绿仍漏） | 有效 |
| D010 | 2026-10-13 | 记忆与选区在宿主合同缺失时保留 `BLOCKED_BY_HOST_CONTRACT`，不用合成夹具冒充已集成 | AAOS 实测：Consumer 闭集不含星栖、无"当前选区"合同、无事件推送面 | 有效 |

| D011 | 2026-10-13 | 呈现层设计契约固化为 `DESIGN.md`，并把对比度、焦点可见性、合成动效属性、令牌化与窄视口无溢出钉进 `tests/boundary/design-tokens.test.ts` | design-review 技能复审：axe 曾因文字坐在渐变上而**拒绝判定** 19–21 个节点（"0 违规"实为"没判"）；占位符 3.73:1、禁用态 3.82:1、375px 溢出 414>375 均为实测 | 有效 |
| D012 | 2026-10-13 | 渲染驱动必须经 `AVATAR_RENDERERS` 注册表与 `selectAvatarRenderer()` 获取，UI 不得直接 import 具体渲染实现；同时新增 `originSeq` 使乱序检测作用于宿主原始序号 | 架构风险复审 R1/R2：两者在 108 项测试全绿下依然存在，seam 当时是装饰而非约束 | 有效 |
| D013 | 2026-10-13 | 无 Git 期间以 `docs/verification/gates.json`（源码树内容哈希 + 门禁退出码 + 工具链绑定）作为证据锚点；Git 定案后改为记录 exact commit | 风险登记册 Q3：报告与现场可能脱节且无法自证 | 有效 |
| D014 | 2026-10-13 | 技能插件缺依赖时在 `.project-local/runs/node-libs` 项目内补齐并用 `module.register()` 解析钩子接入；不修改插件缓存、不装全局包。浏览器修订号不匹配时显式 `executablePath` 指向本机已有构建，不下载运行时 | 实测偏离已记录于 `docs/verification/design-a11y.md` §1 | 有效 |

新增替代决策需明确旧 ID、新决定、理由及授权来源，不静默改写历史。
