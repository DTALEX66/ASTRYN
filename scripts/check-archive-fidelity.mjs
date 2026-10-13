/**
 * 归档字节保真断言（风险 Q9）：`docs/tasks/archive/ARCHIVE-RECEIPT.md` 用 SHA-256 钉住归档原件
 * 的确切字节，但此前没有任何机制断言这些字节未漂移——该缺陷真发生过（行尾规范化在 add 时
 * 改写归档原件），而 CI 当时全绿。
 *
 * 本脚本对每个归档文件做双源校验：
 *  1) 工作区磁盘字节 sha256 == 收据记录（收据绑定的是“原件字节”在磁盘上的在场）；
 *  2) 暂存区字节（`git cat-file blob :<path>`，即即将提交的字节）sha256 == 收据记录——
 *     直接复现行尾/过滤器改写场景：磁盘对、索引错也必须红。
 * 另外把“文件清单”的人口从磁盘枚举（目录里除收据外的每个文件都必须在收据中有条目），
 * 防止新归档文件绕过收据静默入场。
 *
 * 退出码：0 = ARCHIVE_FIDELITY=OK；1 = FAIL（逐文件指明哪个源不匹配）或 UNREADABLE。
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const ARCHIVE_REL = 'docs/tasks/archive';
const RECEIPT_NAME = 'ARCHIVE-RECEIPT.md';
const DIR = join(ROOT, ARCHIVE_REL);
const RECEIPT = join(DIR, RECEIPT_NAME);

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const fail = (lines) => {
  process.stdout.write(`ARCHIVE_FIDELITY=FAIL\n${lines.join('\n')}\n`);
  process.exit(1);
};

// 条目解析：`文件：<name>` 与其后的 `SHA-256：<64hex>` 配对（顺序状态机，容忍条目间空行）。
const receiptText = readFileSync(RECEIPT, 'utf8');
const entries = new Map();
let pendingName = null;
for (const rawLine of receiptText.split(/\r?\n/)) {
  const fileMatch = rawLine.match(/^文件：(.*)$/);
  if (fileMatch) {
    pendingName = fileMatch[1].trim();
    continue;
  }
  const hashMatch = rawLine.match(/^SHA-256：\s*([0-9a-fA-F]{64})\s*$/);
  if (hashMatch) {
    if (!pendingName) fail([`收到 SHA-256 行但没有前置“文件：”行：${rawLine}`]);
    if (entries.has(pendingName)) fail([`收据中条目重复：${pendingName}`]);
    entries.set(pendingName, hashMatch[1].toLowerCase());
    pendingName = null;
  }
}
if (entries.size === 0) fail([`收据中没有解析到任何“文件：+ SHA-256：”条目：${RECEIPT}`]);

// 人口从磁盘枚举：目录里除收据自身外的每个文件都必须被收据钉住。
const onDisk = readdirSync(DIR).filter((name) => name !== RECEIPT_NAME);
const unpinned = onDisk.filter((name) => !entries.has(name));
const missing = [...entries.keys()].filter((name) => !onDisk.includes(name));
if (unpinned.length > 0 || missing.length > 0) {
  fail([
    unpinned.length > 0 ? `目录中存在未被收据钉住的文件（先补收据条目再归档）：${unpinned.join(', ')}` : '',
    missing.length > 0 ? `收据登记了但磁盘不存在的文件：${missing.join(', ')}` : ''
  ].filter(Boolean));
}

const problems = [];
const rows = [];
for (const [name, recorded] of entries) {
  const path = join(DIR, name);
  const disk = readFileSync(path);
  const diskHash = sha256(disk);
  let indexHash = 'UNREADABLE';
  let indexSize = -1;
  try {
    const blob = execFileSync('git', ['-C', ROOT, 'cat-file', 'blob', `:${ARCHIVE_REL}/${name}`], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    indexHash = sha256(blob);
    indexSize = blob.length;
  } catch (error) {
    problems.push(`${name}：暂存区读取失败（文件必须先经 git add 才能核对即将提交的字节）——${String(error.message ?? error).slice(0, 200)}`);
  }
  const diskOk = diskHash === recorded;
  const indexOk = indexHash === recorded;
  if (!diskOk) problems.push(`${name}：磁盘字节不匹配收据。记录 ${recorded}，磁盘 ${diskHash}`);
  if (indexHash !== 'UNREADABLE' && !indexOk) problems.push(`${name}：暂存区（即将提交）字节不匹配收据。记录 ${recorded}，索引 ${indexHash}`);
  rows.push(`  ${name}: ${disk.length}B disk=${diskOk ? 'match' : 'MISMATCH'} index=${indexHash === 'UNREADABLE' ? 'UNREADABLE' : indexOk ? 'match' : 'MISMATCH'}${indexSize >= 0 ? ` (index ${indexSize}B)` : ''}`);
}

if (problems.length > 0) fail([...rows, ...problems]);

process.stdout.write(`ARCHIVE_FIDELITY=OK\n${rows.join('\n')}\n${entries.size} 个归档文件与收据逐字节一致（磁盘与暂存区双源）。\n`);
