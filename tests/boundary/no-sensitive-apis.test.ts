import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// vitest 的 root 已配置为仓库根；jsdom 下 import.meta.url 不是 file: 协议，不能用 fileURLToPath。
function resolveRepoRoot(): string {
  const candidate = process.cwd();
  if (!existsSync(join(candidate, 'package.json'))) {
    throw new Error(`测试的工作目录不是仓库根：${candidate}`);
  }
  return candidate;
}

const repoRoot = resolveRepoRoot();

/** sources() 只接受绝对路径，避免递归时与 repoRoot 二次拼接。 */
function sources(absolute: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(absolute)) {
    const full = join(absolute, entry);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (/\.(ts|tsx|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

const filesUnder = (dir: string): string[] => sources(join(repoRoot, dir));

const SCANNED = ['src', 'contracts', 'dev-host'];
const FORBIDDEN: ReadonlyArray<{ readonly label: string; readonly pattern: RegExp }> = [
  { label: '麦克风/摄像头采集', pattern: /getUserMedia|mediaDevices|MediaRecorder|createMediaStream/ },
  { label: '屏幕采集', pattern: /getDisplayMedia|desktopCapturer/ },
  { label: '系统命令执行', pattern: /child_process|execSync|spawnSync|\bspawn\(/ },
  { label: '浏览器本地持久化（第二记忆库风险）', pattern: /localStorage|sessionStorage|indexedDB|openDatabase|document\.cookie/ },
  { label: '直接写数据库', pattern: /sqlite|better-sqlite3|node:fs\/promises|createWriteStream|writeFileSync/ },
  { label: '疑似硬编码密钥', pattern: /sk-[A-Za-z0-9]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/ }
];

describe('默认权限与数据边界（A10/A13/A15）', () => {
  it(`扫描范围非空：${SCANNED.join(', ')}`, () => {
    const files = SCANNED.flatMap(filesUnder);
    expect(files.length).toBeGreaterThan(8);
  });

  for (const { label, pattern } of FORBIDDEN) {
    it(`${SCANNED.join('/')} 内不出现：${label}`, () => {
      const hits: string[] = [];
      for (const file of SCANNED.flatMap(filesUnder)) {
        const text = readFileSync(file, 'utf-8');
        text.split('\n').forEach((line, index) => {
          if (pattern.test(line)) hits.push(`${relative(repoRoot, file)}:${index + 1}: ${line.trim().slice(0, 90)}`);
        });
      }
      expect(hits, `发现 ${label}：\n${hits.join('\n')}`).toEqual([]);
    });
  }

  it('第三方素材目录不含任何二进制资产', () => {
    const dir = join(repoRoot, 'assets/third-party');
    const entries = readdirSync(dir).filter((name) => name !== '.gitkeep');
    expect(entries).toEqual([]);
  });

  it('原创素材目录带来源声明', () => {
    const readme = readFileSync(join(repoRoot, 'assets/original/README.md'), 'utf-8');
    expect(readme).toContain('原创');
  });
});
