/**
 * AAOS 漂移检查（风险 Q2）：只读比对 AAOS 当前 HEAD 与能力图谱记录的 HEAD。
 *
 * 记录侧唯一真源：docs/architecture/AAOS-HOST-CAPABILITY-MAP.md 中 `HEAD \`<40hex>\``。
 * 本脚本对 AAOS 仓库只执行 git rev-parse（只读；不 fetch、不写任何引用）。
 *
 * 退出码契约（必须能说“测不了”，不许把不可测当成通过）：
 *   0  VERIFIED     HEAD 与记录一致
 *   0  UNVERIFIABLE AAOS 根不存在（如 CI 环境）——如实标注，不冒充核对
 *   1  DRIFT        HEAD 已移动——能力图谱的端点假设可能过期
 *   1  UNREADABLE   根存在但 git 不可读 / 记录无法解析——环境与声明矛盾
 *
 * 环境变量：ASTRYN_AAOS_ROOT 覆盖 AAOS 根路径（默认 D:/All projects/ArcheAxis-Knowledge-OS）。
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const AAOS_ROOT = process.env.ASTRYN_AAOS_ROOT ?? 'D:/All projects/ArcheAxis-Knowledge-OS';
const MAP = join(ROOT, 'docs', 'architecture', 'AAOS-HOST-CAPABILITY-MAP.md');

function report(status, detail) {
  process.stdout.write(`AAOS_DRIFT=${status}\n${detail}\n`);
  process.exit(status === 'DRIFT' || status === 'UNREADABLE' ? 1 : 0);
}

if (!existsSync(MAP)) report('UNREADABLE', `记录文件不存在：${MAP}`);
const mapText = readFileSync(MAP, 'utf8');
const heads = [...mapText.matchAll(/HEAD\s+`([0-9a-f]{40})`/g)].map((m) => m[1]);
if (heads.length !== 1) {
  report('UNREADABLE', `记录侧 HEAD 模式命中 ${heads.length} 处（要求恰好 1 处）：${MAP}`);
}
const recorded = heads[0];
const recordedBranch = mapText.match(/分支\s+`([^`]+)`/)?.[1] ?? '（记录未标注）';

if (!existsSync(AAOS_ROOT)) {
  report('UNVERIFIABLE', `AAOS 根不存在：${AAOS_ROOT}\n本环境无法核对（ASTRYN_AAOS_ROOT 可指定实际根）；记录侧 HEAD ${recorded} 未获独立确认。`);
}

const git = (args) => execFileSync('git', ['-C', AAOS_ROOT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
let head;
let branch;
try {
  head = git(['rev-parse', 'HEAD']);
  branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
} catch (error) {
  report('UNREADABLE', `根存在但 git 只读探测失败：${AAOS_ROOT}\n${String(error.message ?? error).slice(0, 300)}`);
}

if (head === recorded) {
  const branchNote = branch === recordedBranch ? `分支一致：${branch}` : `注意：检出分支为 ${branch}（记录为 ${recordedBranch}）——分支名不参与判定，HEAD 才是；内容未漂移。`;
  report('VERIFIED', `AAOS HEAD 与记录一致：${recorded}\n${branchNote}`);
}
report('DRIFT', `AAOS HEAD 已移动：记录 ${recorded} → 当前 ${head}（分支 ${branch}）\n能力图谱（${MAP}）的端点假设需复核；更新记录 SHA 属文档变更，需按授权流程提交。`);
