import { describe, expect, it } from 'vitest';
import { XIAOQI_PROFILE, withOverrides } from '@astryn/contracts';
import { createEphemeralProfileStore, createHostProfileStore } from '@astryn/core';

describe('档案存储端口（GF01）', () => {
  it('进程内回退：保存自增修订，未保存前是默认档案', async () => {
    const store = createEphemeralProfileStore();
    expect(store.kind).toBe('ephemeral-dev');
    expect(store.persistent).toBe(false);

    const empty = await store.load();
    expect(empty.note).toBe('EMPTY_DEFAULT');
    expect(empty.profile.profileRevision).toBe(0);

    const edited = withOverrides(XIAOQI_PROFILE, { persona: 'girlfriend_style_opt_in', expressionStyle: { replyLength: 'brief' } });
    const saved = await store.save(edited, 0);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.profile.profileRevision).toBe(1);

    const reloaded = await store.load();
    expect(reloaded.note).toBe('LOADED');
    expect(reloaded.profile.persona).toBe('girlfriend_style_opt_in');
    expect(reloaded.profile.profileRevision).toBe(1);
  });

  it('乐观并发：陈旧修订的保存被拒，且不写坏已存档案', async () => {
    const store = createEphemeralProfileStore();
    const first = withOverrides(XIAOQI_PROFILE, { expressionStyle: { replyLength: 'brief' } });
    await store.save(first, 0);

    const stale = withOverrides(XIAOQI_PROFILE, { expressionStyle: { replyLength: 'detailed' } });
    const conflict = await store.save(stale, 0);
    if (conflict.ok || conflict.reason !== 'REVISION_CONFLICT') throw new Error(`expected revision conflict, got ${JSON.stringify(conflict)}`);
    expect(conflict.currentRevision).toBe(1);

    const still = await store.load();
    expect(still.profile.expressionStyle.replyLength).toBe('brief');
    expect(still.profile.profileRevision).toBe(1);

    const retry = await store.save(stale, 1);
    expect(retry.ok).toBe(true);
    if (retry.ok) expect(retry.profile.profileRevision).toBe(2);
  });

  it('进程内回退给出种子档案时如实标注迁移结果', async () => {
    const seeded = createEphemeralProfileStore({
      schemaVersion: 1,
      expressionStyle: { proactiveNudging: true, replyLength: 'detailed' }
    });
    const loaded = await seeded.load();
    expect(loaded.note).toBe('MIGRATED_V1_TO_V2');
    expect(loaded.profile.initiative.proactiveNudging).toBe(true);
  });

  it('宿主存储未接通：读取回退默认并标注原因，写入显式失败且指认依赖', async () => {
    const store = createHostProfileStore();
    expect(store.kind).toBe('host-blocked');
    expect(store.persistent).toBe(true);

    const loaded = await store.load();
    expect(loaded.note).toBe('HOST_UNAVAILABLE_DEFAULT');
    expect(loaded.profile).toEqual(XIAOQI_PROFILE);

    const saved = await store.save(XIAOQI_PROFILE, 0);
    if (saved.ok || saved.reason !== 'UNAVAILABLE') throw new Error(`expected unavailable save, got ${JSON.stringify(saved)}`);
    expect(saved.message).toContain('BLOCKED_BY_HOST_CONTRACT');
    expect(saved.message).toContain('BE06');
  });
});
