import { describe, expect, it } from 'vitest';
import { SYNTHETIC_DOC, SyntheticContextFixture } from '@astryn/core';

const supported = ['active-document-selection', 'task-context'] as const;

function fixture(clockValue = 1_700_000_000_000): SyntheticContextFixture {
  return new SyntheticContextFixture({
    document: { ...SYNTHETIC_DOC, selection: { start: 0, end: 20 } },
    supportedScopes: supported,
    authorizationTtlMs: 1000,
    clock: () => clockValue
  });
}

describe('授权选中文本契约（A12）', () => {
  it('宿主明确声明自己是合成夹具，不假装接入知识库', async () => {
    const probe = await fixture().probe();
    expect(probe.available).toBe(false);
    expect(probe.supportedScopes).toContain('active-document-selection');
  });

  it('不支持的作用域拿不到授权', async () => {
    const memory = fixture();
    expect(await memory.requestAuthorization('knowledge-citation', 's1')).toBeNull();
  });

  it('授权后读取选区：返回真实来源标识并标 SYNTHETIC', async () => {
    const context = fixture();
    const authorization = await context.requestAuthorization('active-document-selection', 's1');
    expect(authorization).not.toBeNull();
    if (!authorization) return;
    const result = await context.readSelection(authorization, 'r1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fragment.provenance).toBe('synthetic-fixture');
    expect(result.fragment.evidenceLevel).toBe('SYNTHETIC');
    expect(result.fragment.sourceId).toBe(SYNTHETIC_DOC.sourceId);
    expect(result.fragment.sourceVersion).toBe(SYNTHETIC_DOC.sourceVersion);
    expect(result.fragment.excerpt.length).toBeGreaterThan(0);
    expect(result.fragment.authorizationId).toBe(authorization.authorizationId);
  });

  it('无选区返回 NO_SELECTION，而不是空回复', async () => {
    const context = new SyntheticContextFixture({
      document: { ...SYNTHETIC_DOC, selection: null },
      supportedScopes: supported
    });
    const authorization = await context.requestAuthorization('active-document-selection', 's1');
    if (!authorization) throw new Error('expected authorization');
    const result = await context.readSelection(authorization, 'r1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('NO_SELECTION');
  });

  it('授权过期后拒绝读取', async () => {
    let now = 1_000;
    const context = new SyntheticContextFixture({
      document: { ...SYNTHETIC_DOC, selection: { start: 0, end: 20 } },
      supportedScopes: supported,
      authorizationTtlMs: 500,
      clock: () => now
    });
    const authorization = await context.requestAuthorization('active-document-selection', 's1');
    if (!authorization) throw new Error('expected authorization');
    now += 1000;
    const result = await context.readSelection(authorization, 'r1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('AUTHORIZATION_EXPIRED');
  });

  it('伪造的授权标识被拒绝', async () => {
    const context = fixture();
    const forged = {
      authorizationId: 'synauth-forged',
      scope: 'active-document-selection' as const,
      grantedBy: 'user' as const,
      grantedAt: new Date(0).toISOString(),
      expiresAt: null
    };
    const result = await context.readSelection(forged, 'r1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('PERMISSION_DENIED');
  });
});
