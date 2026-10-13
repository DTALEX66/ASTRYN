# GF03 轻量人物资产与状态表现（小栖学习伴侣 v1）

分支 `feat/astryn-learning-companion-v1` · 任务包 ASTRYN-COMPANION-20261013 · 日期 2026-10-13

任务卡要求"先复用当前原创 SVG 和九状态，改进符合宇宙主题的清晰度与尺寸表现；输出首页、半身或头像、阅读侧边三种呈现资源和 profile；外观升级保留原始源与版本；区分文本事件驱动表情与真实音频口型"。写实 / Live2D / VRM 升级资产由 MINIMAX DESIGN 生产（简报见 `docs/companion/GF03-VISUAL-ASSET-BRIEF.md`，含 §9 装载与调用约定）；本任务完成 ASTRYN 工程侧全部可独立部分。

## 交付内容

| 交付物 | 位置 | 说明 |
| --- | --- | --- |
| 呈现档定义（三种） | `src/avatar/render-profiles.ts`（新增） | `AVATAR_VIEW_PROFILES`：`hero`（首页腰上半身 240×280）、`avatar`（对话头肩近景 96×99.84，viewBox `10 16 100 104` 保证完整状态环+光环入画）、`sidebar`（阅读侧边 168×196）；`avatarViewForMode('embedded'\|'panel')` 供壳层直接选档；全部 viewBox 在 120×140 源画布内以数值断言 |
| 渲染器 seam 扩展 | `contracts/avatar.ts`、`src/avatar/xiaoqi-svg-renderer.ts`、`src/avatar/xiaoqi-avatar.ts` | `AstrynAvatarRenderer.renderMarkup(frame, size?, view?)` 追加可选第三参数 `AstrynAvatarViewProfile`（加法变更：现有自定义渲染器与调用不受影响）；`XiaoqiAvatar` 按 viewBox 计算宽高比（120:140），SVG 根增加 `shape-rendering="geometricPrecision"` |
| 状态-动作映射 | `src/avatar/state-action-matrix.ts`（新增） | 九状态 → 六种身体预设之一 + `expressionDriver:'text-event-frame'`（文本事件帧驱动，非音素口型）+ `audioDriver:null` + 昂贵资源占位 `{activeAudio:1, expensiveRenderer:1}`；`interrupted/awaiting_approval/executing/failed → idle`（预设由状态环承载），`completed → nod`；`point` 明确列入 `RESERVED_BODY_PRESETS`（"解释选中内容"手势待 GF05/GF07 接线，避免静默死枚举） |
| 渲染失败回退 | `src/presentation/companion-view.tsx`、`src/presentation/astryn.css` | `AvatarView` 的 renderMarkup 抛错与 mount 抛错均捕获 → 渲染 `data-testid="astryn-avatar-fallback"` 的纯文本状态卡（`role="img"`，aria-label 注明"渲染失败，已回退文本"）；错误详情不入 DOM（测试断言 `boom-secret-detail` 不在文档中）；mount 成功路径卸载时 dispose 恰一次 |
| 壳层接线 | `src/presentation/companion-shell.tsx` | 按 `mode` 选档：`embedded→hero`、`panel→sidebar`（嵌入页与侧栏共用同一会话管理器，档位随呈现切换） |
| 角色资产清单 | `assets/character/STATE-ASSET-INDEX.json`（新增）+ `README.md` | schema `astryn.character-assets/v1`：九状态、`provenance.origin='original'`、`realPersonReference=false`（真人红线显式记录）、runtime（rendererId/三档 profile/表情驱动声明）、版本策略：`v1 original-svg-baseline ACTIVE` 与 `v2 upgraded-raster-2d PENDING_EXTERNAL`（producer MINIMAX DESIGN，targetDir `assets/character/upgraded/v1/`，deliveryRule 要求交付权属条款）；`assets/character/upgraded/v1/.gitkeep` 预留 |
| 测试 | `tests/avatar/render-profiles.test.ts`、`tests/avatar/state-action-matrix.test.ts`、`tests/presentation/avatar-fallback.test.tsx`、`tests/boundary/character-assets.test.ts`（均新增） | 7 + 6 + 5 + 6 = 24 项（详见下方对照表） |

## 验收对照

| 验收条目 | 证据 |
| --- | --- |
| 每种状态可辨 | 既有 `companion-shell.test.tsx` 九态两两可辨（环色+眼型+嘴型+字形四元组唯一，且 `renderXiaoqiMarkup` 产物两两不同）；新增 `state-action-matrix.test.ts`：九状态全覆盖校验、同帧确定性（同帧两次渲染 markup 相同）、帧序列 0–3 逐帧互异（离散帧可辨且不随机） |
| 隐藏暂停无用渲染 | 既有壳层测试：点击 `astryn-hide` 后 `astryn-avatar-host` 从 DOM 消失、`astryn-show` 恢复；GF02 的 `session-manager.test.ts`：零视图 `renderingPaused=true` 快照推送暂停、在途流照常入账（本任务未改动该链路，回退路径也不引入常驻渲染——失败态是纯文本节点） |
| 渲染失败可回退 | `avatar-fallback.test.tsx`：renderMarkup 抛错 → 回退文本卡出现且含当前状态名；mount 抛错 → `waitFor` 出现回退卡；错误详情不出现在 DOM；正常渲染器不误触回退；view profile 透传至 DOM（`viewBox="10 16 100 104"`、`width="96"`）；确认挂载成功路径卸载 dispose 恰一次 |
| 不把文本帧推进宣称成中文音素口型 | `state-action-matrix.test.ts`：九态 `expressionDriver==='text-event-frame'`、`audioDriver===null`，且 STATE_ACTIONS JSON 中无 `/viseme|音素/` 字样；`character-assets.test.ts`：清单 runtime.expressionDriver 与代码同源值为"text-event-frame（…非音素口型，不得宣称音素口型）"；`describeXiaoqiFrame` 输出同步携带 `expressionDriver` |
| 不把参考真人作为已获权利人物资产 | `character-assets.test.ts`：`provenance.origin==='original'`、`realPersonReference===false`、note 含"真人"红线句；v2 升级版本 `PENDING_EXTERNAL` 且 `deliveryRule` 含"权利"（交付前必须给出权属条款，未回传不解锁） |

## 证据（本机实测）

### 门禁

- 命令：`bash .project-local/runs/gate-chain.sh`，日志 `.project-local/runs/gate-20261013-224417.log`（首跑 224036 为代码定稿；本份为合同档更新后的终版重封，两级树哈希均可复算）
- 阶段：`STAGE=lint EXIT=0`、`typecheck EXIT=0`、`test EXIT=0`、`build EXIT=0`、`record EXIT=0`、`anchors EXIT=0`
- 回执：`docs/verification/gates.json`，78 个源文件（scopes: contracts/src/dev-host/tests + 7 个根文件），终版树哈希 `59d3d7a1b2f3c2e696fc8f5f30f82fbd5fd1a5b07a26f4f21bb2bef35cadc4b4`（PROJECT_CONTRACT.yaml 在扫描范围，合同档更新后按终版重封），全绿=true；封存时 `git.head` 为 `7e9c2d62cb7c`（GF03 简报提交，本任务代码提交落在其上）
- 锚点：`.project-local/runs/anchors.json` head `7e9c2d62cb7c5f36d27ac4223726f7b1109b3735`，trackedFiles 130，problems `[]`
- 测试：23 个文件 171 通过（GF02 基线为 19 文件 147 通过；+4 文件 +24 项）
- 构建产物：`index-h1SbPDct.css` 8.58 kB（gzip 2.04 kB）、`index-0m_KqSw4.js` 222.42 kB（gzip 73.28 kB；GF02 为 221.05 kB，增量来自映射表与回退分支）

### 开发宿主浏览器实测（DOM 结构化读数）

- `npm run dev` → `http://127.0.0.1:5183/`（日志 `.project-local/runs/dev-gf03.log`、`dev-gf03b.log`）
- 面板档（默认 `mode=panel`，即 sidebar profile）：`astryn-avatar-host > svg[data-testid=astryn-avatar]` 实测 `width="168"` `height="196"` `viewBox="0 0 120 140"` `data-visible-state="idle"`；无 `astryn-avatar-fallback` 节点；`.astryn-root` scrollWidth 358 = clientWidth 358，`documentElement` scrollWidth 396 = clientWidth 396（无横向溢出）
- 嵌入档（点击 `devhost-mode-embedded` 后重读）：svg `width="240"` `height="280"` `viewBox="0 0 120 140"`（hero profile）；无回退节点；396/396 无溢出
- 控制台（服务器存活时新开导航后读数）：3 条消息 = vite connecting/connected（debug）+ React DevTools 提示（info），0 错误 0 警告
- 进程卫生：两次 dev server 均按 PID 终止（34956、38604），终止后 `netstat` 无 LISTENING 残留
- 如实说明：该表面无截图能力，以上为结构化 DOM 读数（与 GF02 同口径）；服务器终止后曾出现 13 条 `ERR_CONNECTION_REFUSED`（HMR/资源对已终止端口的重连），非页面缺陷，fresh 导航读数已隔离该噪声

### 边界核对

- `tests/boundary/character-assets.test.ts` 校验清单与代码同源（states 集合 = 会话态 + 任务态去 `none`；renderProfiles 键 = `AVATAR_VIEW_PROFILES` 键；rendererId = `xiaoqiSvgRenderer.rendererId`；targetDir 在磁盘存在）
- 既有 `no-third-party-assets` 断言保持：SVG 不引用外链素材（`<image|href=|xlink:href=` 均无），`assets/character/upgraded/v1/` 只有 `.gitkeep`

## 如实记录的设计决定

1. **回退卡只显示状态名，不显示底层错误**：错误文本可能携带宿主/模型细节，进入 DOM 等于把内部信息暴露给页面；测试以"抛错消息不在文档中"作为显式断言。
2. **`point` 预设保留但声明为未接线**：九状态里没有"指向"态，若静默舍弃该预设则枚举死亡无告警；改为 `RESERVED_BODY_PRESETS` 带原因说明，并由测试锁死"保留集与已达集无交集且 point 在其中"。
3. **契约扩展只加可选第三参数**：`renderMarkup(frame, size?, view?)` 是加法变更，第三方/宿主自定义渲染器无需改动；`hero/sidebar` 共用全画布，"清晰度"增量来自 viewBox 精确比例与 `geometricPrecision`，不新造素材（等 MINIMAX v2 回传后在清单上换 ACTIVE 版本）。

## 阻塞与残余

- **MINIMAX v2 升级资产 PENDING_EXTERNAL**：写实/2D 升级图集未回传，清单如实标注 `PENDING_EXTERNAL` 与 `targetDir`；回传前 `v1 original-svg-baseline` 保持 ACTIVE，不假装已有新资产。
- **浏览器证据为结构化读数**（该表面无截图），与 GF02 同一口径；像素级走查待有截图能力的表面（GF10 联合验收时统一补）。
- 三档 profile 的"宇宙主题清晰度"工程侧只保证几何（viewBox/比例/无外链/性能属性）；审美升级依赖 v2 资产，不在本任务宣称。

## 回滚

本任务线性提交于 `feat/astryn-learning-companion-v1`；回滚 = `git revert` 本提交。契约变更（renderMarkup 可选参数、`AstrynAvatarViewProfile`）为加法，回滚不破坏 GF00–GF02。未改写已推送历史。
