/**
 * 门禁回执记录器。
 *
 * 为什么需要它：本地不是 Git 仓库，`docs/verification/*.md` 里"退出码 0 / 118 passed"
 * 这类结论无法绑定到确切字节，重跑或改代码后报告就可能与现场脱节（风险登记册 Q3）。
 * 这里在没有 Git 的前提下给出可复核锚点：源码树内容哈希 + 工具链绑定 + 各阶段退出码。
 *
 * 用法（由 shell 负责真正执行门禁，本脚本不使用 child_process）：
 *   node scripts/record-gates.mjs --stage lint=0 --stage typecheck=0 --stage test=0 --stage build=0
 *     --stage drift=0 --stage archive=0 （六个必选阶段，缺一即红）
 *   --info aaosDrift=VERIFIED   可重复；承载日志里"非退出码"的结论，写入回执 info 字段。
 *
 * 失败即红：必选阶段缺失或任一阶段非 0 时，回执照写（证据不丢）但进程以 1 退出——
 * "写了回执"不等于"门禁通过"，调用方不得只看退出码为 0 就宣称全绿。
 * 输出：docs/verification/gates.json（提交物，供台账与后续 diff 引用）
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SCOPES = ['contracts', 'src', 'dev-host', 'tests', 'scripts'];
const ROOT_FILES = [
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'vite.config.ts',
  'eslint.config.js',
  'design.qa.yaml',
  'PROJECT_CONTRACT.yaml',
  // 资产清单进树哈希：PNG 字节由测试逐张核对，但清单本身（状态映射/来源/缺口）必须在回执内自证。
  'assets/character/STATE-ASSET-INDEX.json'
];

/** 只接受绝对目录：递归时若再与 ROOT 拼接，Windows 下会得到 D:\...\D:\... 而静默返回空。 */
function filesIn(absolute) {
  if (!existsSync(absolute)) return [];
  const out = [];
  for (const entry of readdirSync(absolute)) {
    const full = join(absolute, entry);
    if (statSync(full).isDirectory()) out.push(...filesIn(full));
    else if (/\.(ts|tsx|mjs|css|html)$/.test(entry)) out.push(full);
  }
  return out;
}

const files = [];
for (const scope of SCOPES) files.push(...filesIn(join(ROOT, scope)));
for (const name of ROOT_FILES) {
  const full = join(ROOT, name);
  if (existsSync(full)) files.push(full);
}

const entries = files
  .map((full) => {
    const bytes = readFileSync(full);
    return {
      path: relative(ROOT, full).replace(/\\/g, '/'),
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex')
    };
  })
  .sort((a, b) => a.path.localeCompare(b.path));

const treeHash = createHash('sha256')
  .update(entries.map((entry) => `${entry.path}:${entry.sha256}`).join('\n'))
  .digest('hex');

const REQUIRED_STAGES = ['lint', 'typecheck', 'test', 'build', 'drift', 'archive'];
const stages = {};
const info = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--stage') {
    const pair = argv[i + 1] ?? '';
    const [name, code] = pair.split('=');
    if (name) stages[name] = Number.isNaN(Number(code)) ? null : Number(code);
  } else if (argv[i] === '--info') {
    const pair = argv[i + 1] ?? '';
    const [key, value] = pair.split('=');
    if (key) info[key] = value ?? '';
  }
}

const missingStages = REQUIRED_STAGES.filter((name) => !(name in stages));
const failedStages = Object.entries(stages).filter(([, code]) => code !== 0).map(([name]) => name);

/** 空阶段块会写出一份"看起来像回执、实际什么都没判"的文件，静默通过比失败更危险。 */
if (Object.keys(stages).length === 0) {
  process.stderr.write('record-gates: 未收到任何 --stage name=EXIT 参数，拒绝写入空回执。用法见文件头注释。\n');
  process.exit(2);
}

/** 不用 child_process：直接读 .git 里的 HEAD 与 ref 文件解析当前提交。 */
function readGitAnchor() {
  const gitDir = join(ROOT, '.git');
  if (!existsSync(gitDir)) {
    return { repository: false, reason: '无 .git 目录', substitute: 'sourceTree.sha256 为内容锚点' };
  }
  const head = readFileSync(join(gitDir, 'HEAD'), 'utf8').trim();
  const refMatch = head.match(/^ref:\s+(.+)$/);
  let sha = head;
  let branch = '(detached)';
  if (refMatch?.[1]) {
    branch = refMatch[1].replace(/^refs\/heads\//, '');
    const refPath = join(gitDir, refMatch[1]);
    if (existsSync(refPath)) {
      sha = readFileSync(refPath, 'utf8').trim();
    } else {
      const packed = existsSync(join(gitDir, 'packed-refs')) ? readFileSync(join(gitDir, 'packed-refs'), 'utf8') : '';
      sha = (packed.match(new RegExp(`^([0-9a-f]{40}) ${refMatch[1]}$`, 'm'))?.[1]) ?? 'UNRESOLVED';
    }
  }
  const worktreeClean = (() => {
    const index = join(gitDir, 'index');
    return existsSync(index) ? '需 git status 判定，见台账' : 'no index';
  })();
  return { repository: true, branch, head: sha, worktreeNote: worktreeClean };
}

const receipt = {
  schemaVersion: 3,
  generatedAt: new Date().toISOString(),
  toolchain: {
    node: process.version,
    platform: process.platform,
    note: 'npm 由项目外已装运行时经 npm-cli.js 调用；缓存限定 .project-local/runs/cache/npm'
  },
  git: readGitAnchor(),
  sourceTree: {
    files: entries.length,
    sha256: treeHash,
    scopes: SCOPES,
    rootFiles: ROOT_FILES.filter((name) => existsSync(join(ROOT, name)))
  },
  stages,
  info,
  missingStages,
  failedStages,
  allGreen: missingStages.length === 0 && failedStages.length === 0,
  files: entries
};

mkdirSync(join(ROOT, 'docs', 'verification'), { recursive: true });
const outPath = join(ROOT, 'docs', 'verification', 'gates.json');
writeFileSync(outPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');

process.stdout.write(
  `gates.json 已写入：${entries.length} 个源文件，树哈希 ${treeHash.slice(0, 16)}…，阶段 ${JSON.stringify(stages)}，全绿=${receipt.allGreen}\n`
);

if (!receipt.allGreen) {
  process.stderr.write(
    `record-gates: 门禁未全绿——缺失阶段 ${JSON.stringify(missingStages)}，失败阶段 ${JSON.stringify(failedStages)}；回执已写入但进程以 1 退出。\n`
  );
  process.exit(1);
}
