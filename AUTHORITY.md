# 权威入口

本文件是导航索引，不创造 AAOS 权威，也不授予外部操作权限。

适用顺序：平台约束 → 用户当前明确决定 → 当前项目有效合同与 AGENTS → 已归档需求 → 研究与历史资料。发生冲突先记录，不从历史推造新权威。

| 文件 | 责任 | 状态 |
| --- | --- | --- |
| AGENTS.md | 本仓库执行边界 | 当前 |
| PROJECT_CONTRACT.yaml | 当前范围、阶段与验收 | 当前 |
| docs/authority/PATH-REGISTRY.md | 本地与远端引用 | 当前登记，外部身份未核验 |
| docs/tasks/archive/ASTRYN-DEVELOPMENT-START-V1.0.txt | 用户提供的完整开发需求 | 归档；M0 已按 AGENT-START-PROMPT 授权执行 |
| docs/tasks/archive/ARCHIVE-RECEIPT.md | 原文来源与完整性 | 当前 |
| docs/current/STATUS.md | 当前事实与未执行项、最短接续队列 | 当前（2026-10-13 回填） |
| docs/authority/DECISIONS.md | 决策及替代记录（D001-D010） | 当前 |
| docs/tasks/M0-EXECUTION-HANDOFF.md | M0 任务依赖、边界与交接 | 执行依据 |
| docs/tasks/M0-ACCEPTANCE-TRACKER.md | 逐项验收台账 | 已用真实证据回填；A05/A17 未通过 ⇒ 整体 PARTIAL |
| docs/tasks/AGENT-START-PROMPT.md | 用户可转发的接手提示词 | 已转发并执行（D004） |
| docs/verification/S0-BASELINE.md | 本地/远端/工具链现场基线 | 当前实测 |
| docs/verification/M0-VALIDATION.md | 门禁退出码、测试与浏览器实测结论 | 当前实测 |
| docs/architecture/AAOS-HOST-CAPABILITY-MAP.md | AAOS 四类能力的只读核验与可用性判定 | 只读核验产物；AAOS 零写入 |
| docs/architecture/ASTRYN-CAPABILITY-OWNERSHIP.md | 能力归属、权威边界与本轮未做之事 | 当前 |
| docs/research/OPEN-SOURCE-MATRIX.md | 九仓 + 十类方向的吸收矩阵 | 当前；未深度核验项已标注 |
| docs/development/DEVELOPMENT.md | 启动方法与命令表 | 当前 |
| docs/development/DEPENDENCIES.md | 依赖版本与许可证总账 | 当前，源自 lockfile |
| DESIGN.md | 呈现层设计契约（令牌、对比度实测、Do/Don't、已知缺口） | 当前；由 `tests/boundary/design-tokens.test.ts` 钉住 |
| design.qa.yaml | design-review 技能套件的输入契约（视口、扫描范围、产物目录） | 当前 |
| docs/verification/design-a11y.md | 设计与无障碍复审记录（含工具偏离） | 当前实测 |
| docs/verification/gates.json | 门禁回执与源码树内容哈希（无 Git 时的证据锚点，D013） | 当前实测 |
| docs/architecture/astryn-m0.structurizr.dsl | C4 架构模型真相源（含权威/观测/合成/阻塞四类边） | 当前；渲染预览是派生物 |
| docs/architecture/astryn-m0.architecture-understanding.md | 模型读者、阅读顺序、假设与缺口 | 当前 |
| docs/architecture/astryn-m0.evidence.md | 逐节点逐边证据索引 | 当前 |
| docs/architecture/astryn-m0.risk-quality.md | 架构风险登记册（R1-R6 已修 / Q1-Q8 残余） | 当前 |
| scripts/record-gates.mjs | 门禁回执记录器（仓库工具，非产品运行时） | 当前 |

AAOS 的 AGENTS.md、AUTHORITY.md、PROJECT_CONTRACT.yaml、DECISION_SUPERSESSION_LEDGER.yaml 和 docs/current 中有效执行文件须在集成研究时动态核验。未读取前为 AUTHORITY_REFERENCE_MISSING；本仓库不替代它们。
