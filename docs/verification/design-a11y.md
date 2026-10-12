# 设计与无障碍复审记录

日期：2026-10-13（第二轮）。工具：Qoder `design-review` 技能套件（design-system-capture 流程 + axe-core）、`architecture-visualization` 技能套件。契约文件：`DESIGN.md`、`design.qa.yaml`。

## 1. 工具链与偏离声明

| 项 | 实际情况 |
| --- | --- |
| 技能自带证据收集器 `collect-design-system-evidence.mjs` | **跑通**（exit 0），产出 `.project-local/runs/design-qa/reports/design-system-capture.json`（sourceCount=2，含 css-theme-source）。它缺 `fast-glob`/`yaml` 依赖，且 `--import` 只导入不注册钩子 —— 需在项目内补依赖并用 `module.register()` 注册解析钩子（`.project-local/runs/resolve-hook.mjs`、`register-hooks.mjs`），**未修改插件缓存目录** |
| 技能自带 `audit-a11y.mjs` | **未直接运行**：其 `chromium.launch()` 硬编码无 `executablePath`，而它要求的浏览器修订号（1248 / 1178 / 1187 随版本而异）本机均不存在（本机有 1208、1228）。下载运行时超出授权范围 |
| 实际采用的替代 | 同一 `@axe-core/playwright@4.13.0` 规则集 + `playwright-core@1.64.0`，显式 `executablePath` 指向 `ms-playwright/chromium-1228/chrome-win64/chrome.exe`；脚本 `.project-local/runs/node-libs/a11y-scan.mjs`，产物 `design-qa-out/a11y-scan.json` |

偏离原因记录在案，不声称"技能脚本已运行"。

## 2. axe 扫描结果（WCAG 2.1 A + AA 标签集）

三视口 × 两状态（idle、awaiting_approval），共 6 次扫描：

```
### desktop-1280 / idle                 违规 0 节点 0 | incomplete=[] | inapplicable=41 | 通过规则组=21
### desktop-1280 / awaiting_approval    违规 0 节点 0 | incomplete=[] | inapplicable=41 | 通过规则组=21
### phone-375    / idle                 违规 0 节点 0 | incomplete=[] | inapplicable=41 | 通过规则组=21
### phone-375    / awaiting_approval    违规 0 节点 0 | incomplete=[] | inapplicable=41 | 通过规则组=21
### 640(≈200%缩放) / idle               违规 0 节点 0 | incomplete=[] | inapplicable=41 | 通过规则组=21
### 640(≈200%缩放) / awaiting_approval  违规 0 节点 0 | incomplete=[] | inapplicable=41 | 通过规则组=21
```

**关键读法**：修复前同一扫描是 `incomplete=[{"id":"color-contrast","nodes":19~21}]` —— axe 因文字坐在径向渐变上而**拒绝判定**这些节点。当时的"0 违规"是"没判"，不是"通过"。把渐变移出承载文字的容器后，incomplete 归零，对比度才真正被机器判定过一遍。

## 3. 键盘可达性与几何（真实 Tab 走查，非程序化 focus）

| 屏 | DOM 可聚焦 | Tab 落点 | 去重后 | 焦点环 <2px 或缺失 | 触控目标 <24px | 聚焦时横向裁切 |
| --- | --- | --- | --- | --- | --- | --- |
| desktop idle | 13 | 34 | 12 | 0 | 0 | 0 |
| desktop awaiting | 15 | 28 | 13 | 0 | 0 | 0 |
| phone-375 两态 | 13 / 15 | — | 12 / 13 | 0 | 0 | 0 |
| 640 两态 | 13 / 15 | — | 12 / 13 | 0 | 0 | 0 |

- 未达 13 的差额是 `disabled` 的"发送"按钮（空输入时不可聚焦），属预期。
- 探针自纠两处：① 程序化 `el.focus()` 不触发 `:focus-visible`，测出的"13 个无焦点环"是**探针缺陷**，改用真实 `keyboard.press('Tab')` 后归零；② 纵向"超出视口"不是缺陷（浏览器自动滚动），改为只判横向裁切。
- 审批流**可全程键盘完成**：Tab 到"请求动作"→ Enter → 审批卡出现 → Tab 到"允许/拒绝"→ Enter 生效。

## 4. 对比度实测（WCAG 2.1 相对亮度公式，`.project-local/runs/contrast-recheck.mjs`）

修复前 2 项不达标，修复后 14/14 达标：

| 组合 | 修复前 | 修复后 |
| --- | --- | --- |
| 占位符 / surface | **FAIL 3.73:1**（未声明 `::placeholder`，落到浏览器默认灰） | **PASS 8.25:1**（`--astryn-placeholder: #a8b1d6`） |
| 禁用按钮文字 / surface-2 | **FAIL 3.82:1**（opacity 0.45） | **PASS 5.91:1**（opacity 0.62；注：禁用控件本按 SC 1.4.3 豁免） |
| 正文/次要/任务/错误/警告/成功/强调 其余 12 组 | 已 PASS | 7.14 ~ 16.45:1，全部 PASS |
| 九态环色 vs 两种底面 | 6.42 ~ 13.40:1（≥3:1 图形判据） | 不变，全部 PASS |

## 5. 本轮实际修复清单

| # | 问题 | 证据 | 修复 |
| --- | --- | --- | --- |
| D1 | 375px 视口横向溢出 `scrollWidth=414 > 375` | 浏览器实测 | 面板 `min(360px,100%)`、宿主侧栏 `min(380px,100%)`、`@media (max-width:420px)` 全宽堆叠、`overflow-wrap: anywhere` |
| D2 | 文字坐在径向渐变上 → axe 无法判定对比度 | `incomplete` 19-21 节点 | `.astryn-root` 改纯色令牌，渐变只留在不含 HTML 文字的 SVG 装饰层；并写入 DESIGN.md 的 Don't 规则 |
| D3 | 按钮焦点环依赖 UA 默认 | CSS 无 `:focus-visible` 规则 | 显式 `outline: 2px solid var(--astryn-accent); outline-offset: 2px` |
| D4 | 12 个硬编码色未令牌化 | 源码扫描 | 全部收进 `:root` 语义令牌；组件规则内硬编码色归零，并有门禁断言 |
| D5 | panel 模式下 200px 头像挤掉文字列（仅剩 ~120px，处处断词） | 截图 + `getBoundingClientRect` | panel 改纵向堆叠：角色居中在上、状态与操作在下（meta 宽 120 → 330） |
| D6 | 状态环脱离头部悬浮成"独立铁圈" | 截图 | 环半径贴合头部 + 增加完整底轨（低透明度），弧段读作环绕进度 |
| D7 | 面板与页面底色几乎无分界 | 截图 | 面板加 `1px solid var(--astryn-line)` 描边 |
| D8 | 审计芯片文案在窄列断词竖排 | 截图 | 文案压缩为"审计：应用 N · 丢弃 M"，仅在有时追加原因 |

## 6. 遗留（写入 DESIGN.md 的 Known Gaps）

亮色主题未定义（`theme: 'dawn'` 只是占位）；<340px 宽度未实测；长英文串截断未专项走查；voice-only 无视觉语言（P2 前不凭空设计）；`speaking` 与 `awaiting_approval` 色相偏近，靠字形与卡片区分。

## 7. 防漂移门禁

新增两组，纳入 `npm run test`：

- `tests/boundary/design-tokens.test.ts`（23 项）：从 CSS 解析令牌重算对比度、断言文字容器无渐变、占位符显式声明、焦点环 ≥2px、关键帧只含 transform/opacity、reduced-motion 覆盖三个动画类、组件规则零硬编码色、面板宽度非死像素。
- `tests/boundary/architecture-risks.test.tsx`（10 项）：见 `docs/architecture/astryn-m0.risk-quality.md` R1-R6。
