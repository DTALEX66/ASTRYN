import { describe, expect, it } from 'vitest';
import {
  ASTRYN_COMPANION_PERSONAS,
  ASTRYN_PROFILE_STORAGE,
  PROMPT_TEMPLATE_VERSION,
  XIAOQI_PROFILE,
  composePromptSections,
  migrateCharacterProfile,
  personaSpec,
  withOverrides
} from '@astryn/core';

describe('人物档案 v3（GF01/GF09）', () => {
  it('人格目录：默认学习伴侣，女友语气必须由本人显式选择', () => {
    expect(ASTRYN_COMPANION_PERSONAS).toHaveLength(3);
    expect(ASTRYN_COMPANION_PERSONAS.filter((spec) => spec.optIn).map((spec) => spec.id)).toEqual(['girlfriend_style_opt_in']);
    expect(XIAOQI_PROFILE.persona).toBe('learning');
    expect(personaSpec('learning').optIn).toBe(false);
    expect(() => personaSpec('nonexistent' as never)).toThrow('unknown persona');
  });

  it('档案声明宿主保存去向，开发回退不落第二份档案库', () => {
    expect(ASTRYN_PROFILE_STORAGE.owner).toContain('宿主');
    expect(ASTRYN_PROFILE_STORAGE.operations).toEqual(['character.profile.read', 'character.profile.write']);
    expect(ASTRYN_PROFILE_STORAGE.admission).toBe('PROPOSED_REQUIRES_BE01_FORMAL_ADMISSION');
    expect(ASTRYN_PROFILE_STORAGE.devFallback).toContain('EPHEMERAL_DEV_MEMORY');
  });

  it('v1 档案迁移到 v3：proactiveNudging 搬到主动程度，声音节补全默认值', () => {
    const v1 = {
      schemaVersion: 1,
      characterId: 'xiaoqi',
      displayName: '小栖',
      displayNameLatin: 'Xiaoqi',
      aiDisclosure: '我是小栖，星栖里的 AI 角色，不是真人。',
      personaSummary: '赛博陪伴角色。',
      personaTraits: ['陪伴优先'],
      boundaries: ['不得声称自己是人类'],
      relationshipMode: 'companionship',
      continuityPolicy: { referencePastSessions: 'via-host-memory-only', fabricateSharedHistory: false },
      expressionStyle: { greetingTone: 'warm', replyLength: 'detailed', emojiUse: 'none', proactiveNudging: true },
      appearance: { rendererId: 'xiaoqi-svg-v1', theme: 'nightfall', scale: 1, reducedMotion: false }
    };
    const { profile, note } = migrateCharacterProfile(v1);
    expect(note).toBe('MIGRATED_V1_TO_V3');
    expect(profile.schemaVersion).toBe(3);
    expect(profile.initiative).toEqual({ proactiveNudging: true, nudgingCadence: 'low' });
    expect(profile.expressionStyle.replyLength).toBe('detailed');
    expect(profile.expressionStyle).not.toHaveProperty('proactiveNudging');
    expect(profile.voiceStyle.enabled).toBe(false);
    expect(profile.voiceStyle.microphone).toBe(false);
    expect(profile.voiceStyle.subtitles).toBe(true);
    expect(profile.voiceStyle.volume).toBe(1);
    expect(profile.profileRevision).toBe(0);
  });

  it('v2 档案迁移到 v3：声音偏好保持原值，前端字段补默认', () => {
    const { profile, note } = migrateCharacterProfile({
      schemaVersion: 2,
      profileRevision: 4,
      voiceStyle: { styleId: 'xiaoqi-soft-zh', speakingRate: 1.5, pitchOffset: 1, enabled: true, connectionRef: 'conn-1' }
    });
    expect(note).toBe('MIGRATED_V2_TO_V3');
    expect(profile.schemaVersion).toBe(3);
    expect(profile.profileRevision).toBe(4);
    expect(profile.voiceStyle.enabled).toBe(true);
    expect(profile.voiceStyle.speakingRate).toBe(1.5);
    expect(profile.voiceStyle.pitchOffset).toBe(1);
    expect(profile.voiceStyle.connectionRef).toBe('conn-1');
    expect(profile.voiceStyle.microphone).toBe(false);
    expect(profile.voiceStyle.subtitles).toBe(true);
    expect(profile.voiceStyle.volume).toBe(1);
  });

  it('音量越界值被夹到 0–1；v3 输入不再标注迁移', () => {
    const { profile, note } = migrateCharacterProfile({
      schemaVersion: 3,
      voiceStyle: { volume: 5, subtitles: false, microphone: true }
    });
    expect(note).toBe(null);
    expect(profile.voiceStyle.volume).toBe(1);
    expect(profile.voiceStyle.subtitles).toBe(false);
    expect(profile.voiceStyle.microphone).toBe(true);
    expect(migrateCharacterProfile({ schemaVersion: 3, voiceStyle: { volume: -2 } }).profile.voiceStyle.volume).toBe(0);
  });

  it('空档案与损坏档案回退默认并给出可区分的原因', () => {
    expect(migrateCharacterProfile(null).note).toBe('EMPTY_DEFAULT');
    expect(migrateCharacterProfile(undefined).note).toBe('EMPTY_DEFAULT');
    expect(migrateCharacterProfile('not-a-profile').note).toBe('INVALID_FALLBACK');
    expect(migrateCharacterProfile({ schemaVersion: 99 }).note).toBe('INVALID_FALLBACK');
    expect(migrateCharacterProfile(XIAOQI_PROFILE).note).toBe(null);
  });

  it('withOverrides 按节合并且不改动原档案', () => {
    const base = XIAOQI_PROFILE;
    const next = withOverrides(base, {
      persona: 'close_companion',
      expressionStyle: { replyLength: 'brief' },
      initiative: { proactiveNudging: true, nudgingCadence: 'low' },
      learning: { quizMe: true }
    });
    expect(next.persona).toBe('close_companion');
    expect(next.expressionStyle.replyLength).toBe('brief');
    expect(next.expressionStyle.greetingTone).toBe(base.expressionStyle.greetingTone);
    expect(next.initiative.proactiveNudging).toBe(true);
    expect(next.learning.quizMe).toBe(true);
    expect(next.learning.explanationDepth).toBe(base.learning.explanationDepth);
    expect(base.persona).toBe('learning');
    expect(base.expressionStyle.replyLength).toBe('balanced');
    expect(base.initiative.proactiveNudging).toBe(false);
  });

  it('提示模板 v2：边界/连续性/权威/作用域四节不随人格与设置变化', () => {
    expect(PROMPT_TEMPLATE_VERSION).toBe('xiaoqi-system-2');
    const sectionsOf = (profile: Parameters<typeof composePromptSections>[0]) =>
      new Map(composePromptSections(profile).map((section) => [section.id, section.text]));
    const baseMap = sectionsOf(XIAOQI_PROFILE);
    const girlMap = sectionsOf(withOverrides(XIAOQI_PROFILE, { persona: 'girlfriend_style_opt_in' }));
    const styledMap = sectionsOf(withOverrides(XIAOQI_PROFILE, {
      expressionStyle: { replyLength: 'brief', greetingTone: 'playful', emojiUse: 'none' },
      initiative: { proactiveNudging: true, nudgingCadence: 'medium' }
    }));
    const learnMap = sectionsOf(withOverrides(XIAOQI_PROFILE, { learning: { explanationDepth: 'deep', examplesFirst: true, quizMe: true } }));
    const allMaps = [baseMap, girlMap, styledMap, learnMap];

    const invariants = ['boundaries', 'continuity', 'authority', 'style-scope'];
    for (const id of invariants) {
      expect(baseMap.get(id)).toBeDefined();
      for (const map of allMaps) expect(map.get(id)).toBe(baseMap.get(id));
    }
    // 可变节确实会随设置变化——否则上面的不变量断言是空洞的。
    expect(girlMap.get('persona')).toBeDefined();
    expect(girlMap.get('persona')).not.toBe(baseMap.get('persona'));
    expect(styledMap.get('initiative')).toBeDefined();
    expect(styledMap.get('initiative')).not.toBe(baseMap.get('initiative'));
    expect(styledMap.get('style')).not.toBe(baseMap.get('style'));
    expect(learnMap.get('learning')).not.toBe(baseMap.get('learning'));
    // 女友语气的人格附加不得触碰授权规则。
    expect(girlMap.get('persona')).toContain('不改变事实来源');
  });

  it('档案序列化后不含采集与本地存储接口痕迹，且结构上只含纯数据', () => {
    const serialized = JSON.stringify(XIAOQI_PROFILE);
    for (const pattern of ['getUserMedia', 'getDisplayMedia', 'localStorage', 'sessionStorage', 'sqlite', 'child_process']) {
      expect(serialized).not.toContain(pattern);
    }
    // 反空洞：黑名单只拦已知字符串，函数/句柄藏在新命名下不会被看见。
    // 结构化遍历证明档案是纯数据——任何函数、类实例或非平凡对象都点名失败。
    const offenders: string[] = [];
    const walk = (value: unknown, path: string): void => {
      if (typeof value === 'function') {
        offenders.push(`${path}: function`);
        return;
      }
      if (value === null || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        value.forEach((item, i) => walk(item, `${path}[${i}]`));
        return;
      }
      const proto = Object.getPrototypeOf(value) as object | null;
      if (proto !== Object.prototype && proto !== Map.prototype && proto !== Set.prototype) {
        offenders.push(`${path}: ${(value as object).constructor?.name ?? 'unknown'}`);
        return;
      }
      if (value instanceof Map) {
        for (const [k, v] of value as Map<unknown, unknown>) walk(v, `${path}.get(${String(k)})`);
        return;
      }
      if (value instanceof Set) {
        for (const v of value as Set<unknown>) walk(v, `${path}<set-item>`);
        return;
      }
      for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`);
    };
    walk(XIAOQI_PROFILE, 'XIAOQI_PROFILE');
    expect(offenders).toEqual([]);
  });
});
