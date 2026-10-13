import { describe, expect, it } from 'vitest';
import type { AstrynHostCapabilities, AstrynHostUnavailable } from '@astryn/contracts';
import {
  ASTRYN_PORT_MANIFEST,
  describePortAvailability,
  interpretCapabilityRegistry,
  interpretVersionPayload,
  isCompatibleHostContract,
  readingFor
} from '@astryn/core';

describe('宿主握手：版本面解析', () => {
  it('只读不猜：已知字段原样保留，缺失保持 null', () => {
    expect(interpretVersionPayload({ version: '1.4.2', api_contract: '1.3', runtime: 'archeaxis-api' })).toEqual({
      hostBuildIdentity: '1.4.2',
      observedProtocol: '1.3',
      hostRuntime: 'archeaxis-api'
    });
    // api_contract 缺失时允许读 protocol 别名；两个都没有 = 未报告。
    expect(interpretVersionPayload({ protocol: '1.1' }).observedProtocol).toBe('1.1');
    expect(interpretVersionPayload({ version: 'x' }).observedProtocol).toBeNull();
  });

  it('非对象/空串不产生读数', () => {
    for (const garbage of [null, 42, 'v1', [], { version: '', api_contract: '' }]) {
      expect(interpretVersionPayload(garbage)).toEqual({ hostBuildIdentity: null, observedProtocol: null, hostRuntime: null });
    }
  });

  it('兼容性只看主版本前导：1 / 1.x 通过，2、10、空串不通过', () => {
    expect(isCompatibleHostContract('1')).toBe(true);
    expect(isCompatibleHostContract('1.3')).toBe(true);
    expect(isCompatibleHostContract(' 1.0 ')).toBe(true);
    expect(isCompatibleHostContract('2.0')).toBe(false);
    expect(isCompatibleHostContract('10')).toBe(false);
    expect(isCompatibleHostContract('')).toBe(false);
  });
});

describe('宿主握手：能力注册表解析', () => {
  it('接受数组本体与 capabilities 包装两种形态', () => {
    const entry = { capability: 'conversation', enabled: true, health: 'protocol_ok' };
    const fromArray = interpretCapabilityRegistry([entry]);
    const fromWrapped = interpretCapabilityRegistry({ capabilities: [entry] });
    expect(fromArray).toHaveLength(1);
    expect(fromWrapped).toEqual(fromArray);
    expect(fromArray[0]?.state).toBe('AVAILABLE_UNVERIFIED');
  });

  it('enabled=false 是 DISABLED，worker_missing 是 WORKER_MISSING，其余一律 UNKNOWN', () => {
    const readings = interpretCapabilityRegistry([
      { capability: 'a', enabled: false, health: 'protocol_ok' },
      { capability: 'b', enabled: true, health: 'worker_missing' },
      { capability: 'c', enabled: true, health: 'protocol_ok' },
      { capability: 'd', enabled: 'yes' },
      { capability: 'e' }
    ]);
    const state = (name: string): string | undefined => readings.find((reading) => reading.capability === name)?.state;
    expect(state('a')).toBe('DISABLED');
    expect(state('b')).toBe('WORKER_MISSING');
    expect(state('c')).toBe('AVAILABLE_UNVERIFIED');
    // 不可识别的布尔值/缺失：未知不当可用。
    expect(state('d')).toBe('UNKNOWN');
    expect(state('e')).toBe('UNKNOWN');
  });

  it('enabled=false 优先于 health 报告：显式禁用不因 worker 健康而翻案', () => {
    const readings = interpretCapabilityRegistry([{ capability: 'x', enabled: false, health: 'worker_missing' }]);
    expect(readings[0]?.state).toBe('DISABLED');
  });

  it('别名键 name/id 与 health/state/status 均可读，detail 保留原文', () => {
    const readings = interpretCapabilityRegistry([{ name: 'memory', id: 'ignored', status: 'ready', enabled: true }]);
    expect(readings[0]?.capability).toBe('memory');
    expect(readings[0]?.detail).toBe('capability=memory enabled=true health=ready');
  });

  it('垃圾输入不产生读数：非数组、条目非对象、无名条目全部跳过', () => {
    expect(interpretCapabilityRegistry(null)).toEqual([]);
    expect(interpretCapabilityRegistry({ other: [] })).toEqual([]);
    expect(interpretCapabilityRegistry([null, 3, 'str', {}])).toEqual([]);
  });

  it('readingFor 按候选顺序命中，未命中返回 null', () => {
    const readings = interpretCapabilityRegistry([
      { capability: 'machine-answers', enabled: true },
      { capability: 'machine_answers', enabled: false }
    ]);
    expect(readingFor(readings, ['machine_answers', 'machine-answers'])?.capability).toBe('machine_answers');
    expect(readingFor(readings, ['job', 'jobs'])).toBeNull();
    expect(readingFor(readings, ['nope'])).toBeNull();
  });
});

describe('八端口清单', () => {
  it('恰好八项、端口唯一、五个宿主边 + 三个 ASTRYN 自有 seam', () => {
    expect(ASTRYN_PORT_MANIFEST).toHaveLength(8);
    const ports = ASTRYN_PORT_MANIFEST.map((entry) => entry.port);
    expect(new Set(ports).size).toBe(8);
    expect(ports).toEqual(['host', 'conversation', 'memory', 'action', 'context', 'avatarRenderer', 'presentationMode', 'characterProfile']);
    expect(ASTRYN_PORT_MANIFEST.filter((entry) => entry.owner === 'host').map((entry) => entry.port)).toEqual(['host', 'conversation', 'memory', 'action', 'context']);
    expect(ASTRYN_PORT_MANIFEST.filter((entry) => entry.owner === 'astryn').map((entry) => entry.port)).toEqual(['avatarRenderer', 'presentationMode', 'characterProfile']);
    for (const entry of ASTRYN_PORT_MANIFEST) expect(entry.label.length).toBeGreaterThan(0);
  });

  it('宿主端口必须声明能力候选键；ASTRYN 自有端口不依赖宿主能力', () => {
    for (const entry of ASTRYN_PORT_MANIFEST.filter((item) => item.port !== 'host' && item.owner === 'host')) {
      expect(entry.hostCapabilityCandidates.length).toBeGreaterThan(0);
    }
    for (const entry of ASTRYN_PORT_MANIFEST.filter((item) => item.owner === 'astryn')) {
      expect(entry.hostCapabilityCandidates).toEqual([]);
    }
  });
});

const caps = (overrides: Partial<AstrynHostCapabilities>): AstrynHostCapabilities => ({
  protocol: 'astryn-1',
  conversation: false,
  memory: false,
  context: false,
  actions: false,
  authoritativeReceipts: false,
  streamResume: false,
  hostBuildIdentity: 'build-1',
  observedProtocol: '1.0',
  protocolConfirmed: true,
  hostRuntime: 'archeaxis-api',
  capabilityRegistry: [],
  capabilityRegistryNote: null,
  ...overrides
});

describe('八端口可用性推导（未接端口必须给明确原因）', () => {
  const invariants = (entries: ReturnType<typeof describePortAvailability>): void => {
    expect(entries).toHaveLength(8);
    for (const entry of entries) {
      if (entry.available) expect(entry.reason, `${entry.port} 可用时不得带原因`).toBeNull();
      else {
        expect(entry.reason, `${entry.port} 不可用必须给明确原因`).toBeTruthy();
        expect(entry.detail.length).toBeGreaterThan(0);
      }
    }
  };

  it('未配置宿主：宿主边全部不可用且原因指向 HOST_CONTRACT_MISSING，三个自有 seam 本地可用', () => {
    const entries = describePortAvailability({ configured: false, capabilities: null });
    invariants(entries);
    const host = entries[0];
    expect(host?.available).toBe(false);
    expect(host?.reason).toContain('HOST_CONTRACT_MISSING');
    for (const entry of entries.slice(1, 5)) {
      expect(entry.available).toBe(false);
      expect(entry.reason).toContain('HOST_CONTRACT_MISSING');
    }
    for (const entry of entries.slice(5)) {
      expect(entry.available).toBe(true);
      expect(entry.reason).toBeNull();
    }
    const byPort = new Map(entries.map((entry) => [entry.port, entry]));
    expect(byPort.get('characterProfile')?.detail).toContain('BLOCKED_BY_HOST_CONTRACT');
    expect(byPort.get('avatarRenderer')?.detail).toContain('data-renderer-exact=false');
    expect(byPort.get('presentationMode')?.detail).toContain('blockedBy');
  });

  it('已配置但未探测：宿主边原因指向"未探测"，不得当成可用', () => {
    const entries = describePortAvailability({ configured: true, capabilities: null });
    invariants(entries);
    expect(entries[0]?.available).toBe(false);
    expect(entries[0]?.reason).toContain('未探测');
    expect(entries[1]?.reason).toContain('未探测');
  });

  it('宿主自报不可用（如 PROTOCOL_MISMATCH）：原因原样透传', () => {
    const unavailable: AstrynHostUnavailable = { available: false, code: 'PROTOCOL_MISMATCH', detail: '宿主报告 api_contract=2.0' };
    const entries = describePortAvailability({ configured: true, capabilities: unavailable });
    invariants(entries);
    expect(entries[0]?.reason).toContain('PROTOCOL_MISMATCH');
    expect(entries[0]?.reason).toContain('api_contract=2.0');
    for (const entry of entries.slice(1, 5)) expect(entry.available).toBe(false);
  });

  it('协议未确认：即使注册表看起来健康，宿主边一律 fail-closed', () => {
    const entries = describePortAvailability({
      configured: true,
      capabilities: caps({
        protocolConfirmed: false,
        observedProtocol: null,
        conversation: true,
        capabilityRegistry: [{ capability: 'conversation', state: 'AVAILABLE_UNVERIFIED', detail: 'capability=conversation enabled=true health=protocol_ok' }]
      })
    });
    invariants(entries);
    const conversation = entries.find((entry) => entry.port === 'conversation');
    expect(conversation?.available).toBe(false);
    expect(conversation?.reason).toContain('api_contract');
    expect(conversation?.reason).toContain('未知不当可用');
  });

  it('协议已确认 + 注册表命中 AVAILABLE_UNVERIFIED：对应端口可用，其余仍带注册表依据', () => {
    const entries = describePortAvailability({
      configured: true,
      capabilities: caps({
        conversation: true,
        capabilityRegistry: [{ capability: 'conversation', state: 'AVAILABLE_UNVERIFIED', detail: 'capability=conversation enabled=true health=protocol_ok' }]
      })
    });
    invariants(entries);
    const conversation = entries.find((entry) => entry.port === 'conversation');
    expect(conversation?.available).toBe(true);
    expect(conversation?.detail).toContain('capability=conversation');
    const memory = entries.find((entry) => entry.port === 'memory');
    expect(memory?.available).toBe(false);
    expect(memory?.reason).toContain('未知不当可用');
    expect(memory?.reason).toContain('memory');
  });

  it('注册表条目为 DISABLED 时，原因携带注册表原始状态', () => {
    const entries = describePortAvailability({
      configured: true,
      capabilities: caps({
        actions: false,
        capabilityRegistry: [{ capability: 'actions', state: 'DISABLED', detail: 'capability=actions enabled=false health=protocol_ok' }]
      })
    });
    invariants(entries);
    const action = entries.find((entry) => entry.port === 'action');
    expect(action?.available).toBe(false);
    expect(action?.reason).toContain('DISABLED');
    expect(action?.detail).toContain('enabled=false');
  });

  it('注册表整体不可读时，detail 引用 registryNote 而不虚构条目', () => {
    const entries = describePortAvailability({
      configured: true,
      capabilities: caps({ capabilityRegistryNote: '能力注册表返回 404：未知不当可用，全部按未确认处理。' })
    });
    invariants(entries);
    const memory = entries.find((entry) => entry.port === 'memory');
    expect(memory?.detail).toBe('能力注册表返回 404：未知不当可用，全部按未确认处理。');
  });

  it('端口顺序与清单一致，label 原样继承', () => {
    const entries = describePortAvailability({ configured: false, capabilities: null });
    expect(entries.map((entry) => entry.port)).toEqual(ASTRYN_PORT_MANIFEST.map((entry) => entry.port));
    expect(entries.map((entry) => entry.label)).toEqual(ASTRYN_PORT_MANIFEST.map((entry) => entry.label));
  });
});
