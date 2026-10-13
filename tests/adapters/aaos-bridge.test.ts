import { describe, expect, it } from 'vitest';
import type { AstrynActionReceipt, AstrynActionRequest, AstrynAnyEvent } from '@astryn/contracts';
import { AAOS_ENDPOINTS, AaosHostBridge } from '@astryn/core';
import type { AaosTransport } from '@astryn/core';

type Route = { status?: number; body?: unknown } | 'throw';

function makeTransport(routes: Record<string, Route>): { calls: { path: string; method: string; headers: Record<string, string>; body: string | undefined }[]; transport: AaosTransport } {
  const calls: { path: string; method: string; headers: Record<string, string>; body: string | undefined }[] = [];
  const transport: AaosTransport = {
    async request(path, init) {
      calls.push({ path, method: init?.method ?? 'GET', headers: init?.headers ?? {}, body: init?.body });
      const route = routes[path];
      if (route === undefined) throw new Error(`测试未注册路由：${path}`);
      if (route === 'throw') throw new Error('网络不可达');
      const status = route.status ?? 200;
      return { ok: status >= 200 && status < 300, status, json: async () => route.body } as unknown as Response;
    }
  };
  return { calls, transport };
}

const versionOk = { status: 200, body: { version: 'build-1.4.2', api_contract: '1.3', runtime: 'archeaxis-api' } };
const registryOk = {
  status: 200,
  body: [
    { capability: 'conversation', enabled: true, health: 'protocol_ok' },
    { capability: 'jobs', enabled: true, health: 'protocol_ok' },
    { capability: 'knowledge_items', enabled: false, health: 'protocol_ok' }
  ]
};

const receipt = (overrides: Partial<AstrynActionReceipt>): AstrynActionReceipt => ({
  receiptId: 'r1',
  taskId: 't1',
  actionRequestId: 'req-1',
  outcome: 'completed',
  issuedBy: 'aaos-core',
  issuedAt: '2026-10-13T00:00:00.000Z',
  summary: '完成',
  failureCode: null,
  riskTier: null,
  authority: 'aaos-core',
  signature: 'deadbeef00112233445566778899aabbccddeeff',
  ...overrides
});

describe('AaosHostBridge：未配置即未连接，不猜测宿主现场', () => {
  it('baseUrl 为空：探测给 HOST_CONTRACT_MISSING，五个宿主端口构造函数全返回 null', async () => {
    const bridge = new AaosHostBridge({ baseUrl: null });
    const probe = await bridge.probeCapabilities();
    expect('available' in probe && probe.available === false).toBe(true);
    if ('available' in probe) {
      expect(probe.code).toBe('HOST_CONTRACT_MISSING');
      expect(probe.detail.length).toBeGreaterThan(0);
    }
    expect(bridge.conversation()).toBeNull();
    expect(bridge.memory()).toBeNull();
    expect(bridge.context()).toBeNull();
    expect(bridge.actions()).toBeNull();
    expect(bridge.connected).toBe(false);
  });

  it('requestGrant：AAOS Consumer 闭集不含星栖，绝不自许授权', async () => {
    const bridge = new AaosHostBridge({ baseUrl: null });
    const grant = await bridge.requestGrant({ sessionId: 's1', scopes: ['task-context', 'user_preference'], purpose: '测试授权拒绝' });
    expect(grant.granted).toEqual([]);
    expect(grant.denied).toEqual(['task-context', 'user_preference']);
  });

  it('onAuthoritativeEvent：宿主无推送面，订阅只能是空实现', () => {
    const bridge = new AaosHostBridge({ baseUrl: null });
    const dispose = bridge.onAuthoritativeEvent();
    expect(typeof dispose).toBe('function');
    expect(dispose()).toBeUndefined();
  });
});

describe('AaosHostBridge：握手核对版本、能力、身份', () => {
  it('版本 + 注册表均可读：布尔读数只认 AVAILABLE_UNVERIFIED，身份原样保留', async () => {
    const { calls, transport } = makeTransport({ [AAOS_ENDPOINTS.version]: versionOk, [AAOS_ENDPOINTS.capabilities]: registryOk });
    const bridge = new AaosHostBridge({ baseUrl: 'http://127.0.0.1:1', transport });
    const probe = await bridge.probeCapabilities();
    expect('available' in probe).toBe(false);
    if ('available' in probe) return;
    expect(probe.conversation).toBe(true);
    expect(probe.actions).toBe(true);
    expect(probe.memory).toBe(false);
    expect(probe.context).toBe(false);
    expect(probe.protocolConfirmed).toBe(true);
    expect(probe.observedProtocol).toBe('1.3');
    expect(probe.hostBuildIdentity).toBe('build-1.4.2');
    expect(probe.hostRuntime).toBe('archeaxis-api');
    // 宿主无签名面：回执权威性无法确认，永远不是 true。
    expect(probe.authoritativeReceipts).toBe(false);
    expect(probe.capabilityRegistry).toHaveLength(3);
    expect(probe.capabilityRegistryNote).toBeNull();
    expect(calls.map((call) => call.path)).toEqual([AAOS_ENDPOINTS.version, AAOS_ENDPOINTS.capabilities]);
  });

  it('请求头：只带 launch token 与 content-type，绝不出现 authorization / origin', async () => {
    const { calls, transport } = makeTransport({ [AAOS_ENDPOINTS.version]: versionOk, [AAOS_ENDPOINTS.capabilities]: registryOk });
    const bridge = new AaosHostBridge({ baseUrl: 'http://127.0.0.1:1', transport, launchTokenProvider: () => 'tok-fixture-42' });
    await bridge.probeCapabilities();
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.headers['x-archeaxis-launch-token']).toBe('tok-fixture-42');
      expect(call.headers['content-type']).toBe('application/json');
      expect(call.headers['authorization']).toBeUndefined();
      expect(call.headers['origin']).toBeUndefined();
    }
  });

  it('launch token 缺省时：不编造头，其余头保持最小集', async () => {
    const { calls, transport } = makeTransport({ [AAOS_ENDPOINTS.version]: versionOk, [AAOS_ENDPOINTS.capabilities]: registryOk });
    const bridge = new AaosHostBridge({ baseUrl: 'http://127.0.0.1:1', transport });
    await bridge.probeCapabilities();
    expect(calls[0]?.headers['x-archeaxis-launch-token']).toBeUndefined();
  });

  it('宿主报告主版本不兼容：PROTOCOL_MISMATCH，且不再读取注册表', async () => {
    const { calls, transport } = makeTransport({ [AAOS_ENDPOINTS.version]: { status: 200, body: { version: 'b', api_contract: '2.0', runtime: 'archeaxis-api' } } });
    const bridge = new AaosHostBridge({ baseUrl: 'http://127.0.0.1:1', transport });
    const probe = await bridge.probeCapabilities();
    expect('available' in probe && probe.available === false).toBe(true);
    if ('available' in probe) {
      expect(probe.code).toBe('PROTOCOL_MISMATCH');
      expect(probe.detail).toContain('2.0');
    }
    expect(calls.map((call) => call.path)).toEqual([AAOS_ENDPOINTS.version]);
  });

  it('宿主未报告 api_contract：协议未确认，注册表再健康也全部 false', async () => {
    const { transport } = makeTransport({ [AAOS_ENDPOINTS.version]: { status: 200, body: { version: 'b', runtime: 'archeaxis-api' } }, [AAOS_ENDPOINTS.capabilities]: registryOk });
    const bridge = new AaosHostBridge({ baseUrl: 'http://127.0.0.1:1', transport });
    const probe = await bridge.probeCapabilities();
    expect('available' in probe).toBe(false);
    if ('available' in probe) return;
    expect(probe.protocolConfirmed).toBe(false);
    expect(probe.observedProtocol).toBeNull();
    expect(probe.conversation).toBe(false);
    expect(probe.actions).toBe(false);
    expect(probe.memory).toBe(false);
  });

  it('注册表 404：全部 false 并留下 registryNote，不虚构条目', async () => {
    const { transport } = makeTransport({ [AAOS_ENDPOINTS.version]: versionOk, [AAOS_ENDPOINTS.capabilities]: { status: 404 } });
    const bridge = new AaosHostBridge({ baseUrl: 'http://127.0.0.1:1', transport });
    const probe = await bridge.probeCapabilities();
    expect('available' in probe).toBe(false);
    if ('available' in probe) return;
    expect(probe.conversation).toBe(false);
    expect(probe.actions).toBe(false);
    expect(probe.capabilityRegistry).toEqual([]);
    expect(probe.capabilityRegistryNote).toContain('404');
  });

  it('版本面 500：AUTHORITY_REFERENCE_MISSING', async () => {
    const { transport } = makeTransport({ [AAOS_ENDPOINTS.version]: { status: 500 } });
    const bridge = new AaosHostBridge({ baseUrl: 'http://127.0.0.1:1', transport });
    const probe = await bridge.probeCapabilities();
    expect('available' in probe && probe.available === false).toBe(true);
    if ('available' in probe) expect(probe.code).toBe('AUTHORITY_REFERENCE_MISSING');
  });

  it('传输抛错（含未注入传输的默认拒绝实现）：AUTHORITY_REFERENCE_MISSING 且原因可读', async () => {
    const { transport } = makeTransport({ [AAOS_ENDPOINTS.version]: 'throw' });
    const throwing = new AaosHostBridge({ baseUrl: 'http://127.0.0.1:1', transport });
    const probe1 = await throwing.probeCapabilities();
    expect('available' in probe1 && probe1.available === false).toBe(true);

    const bare = new AaosHostBridge({ baseUrl: 'http://127.0.0.1:1' });
    const probe2 = await bare.probeCapabilities();
    expect('available' in probe2 && probe2.available === false).toBe(true);
    if ('available' in probe2) expect(probe2.detail).toContain('未配置');
  });
});

describe('AaosHostBridge：回执校验诚实化（GF04 逐字条款）', () => {
  it('aaos-core 回执即使带非空"签名"也一律 NO_VERIFIER：宿主无签名面，不冒充验证', async () => {
    const bridge = new AaosHostBridge({ baseUrl: 'http://127.0.0.1:1', transport: makeTransport({}).transport });
    const forged = receipt({ signature: 'a'.repeat(64) });
    const result = await bridge.verify(forged);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('NO_VERIFIER');
    expect(result.issuer).toBe('aaos-core');
  });

  it('未配置的桥同样 NO_VERIFIER：没有校验器是可读事实，不是可选项', async () => {
    const bridge = new AaosHostBridge({ baseUrl: null });
    const result = await bridge.verify(receipt({}));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('NO_VERIFIER');
  });

  it('synthetic-fixture 回执在真实适配器上是 UNKNOWN_ISSUER：合成不冒充宿主', async () => {
    const bridge = new AaosHostBridge({ baseUrl: null });
    const result = await bridge.verify(receipt({ authority: 'synthetic-fixture', issuedBy: 'synthetic-host-simulator' }));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('UNKNOWN_ISSUER');
    expect(result.issuer).toBe('synthetic-host-simulator');
  });
});

describe('AaosHostBridge：端口实现只消费真实宿主回执/响应', () => {
  it('会话端口一次性问答映射为 started → delta → completed，不伪造流式', async () => {
    const { transport } = makeTransport({ [AAOS_ENDPOINTS.machineAnswers]: { status: 200, body: { answer: '合成的答案' } } });
    const bridge = new AaosHostBridge({ baseUrl: 'http://127.0.0.1:1', transport });
    const port = bridge.conversation();
    expect(port).not.toBeNull();
    if (!port) return;
    const events: AstrynAnyEvent[] = [];
    for await (const event of port.stream({ protocol: 'astryn-1', sessionId: 's1', requestId: 'r1', characterId: 'xiaoqi', messages: [{ role: 'user', content: '你好', sessionId: 's1', requestId: 'r1' }], contextFragments: [] }, new AbortController().signal)) {
      events.push(event);
    }
    expect(events.map((event) => event.payload.kind)).toEqual(['stream.started', 'stream.delta', 'stream.completed']);
    expect((events[1]?.payload as { text: string }).text).toBe('合成的答案');
  });

  it('会话端口 availability 如实报告宿主无通用流式面', async () => {
    const bridge = new AaosHostBridge({ baseUrl: 'http://127.0.0.1:1', transport: makeTransport({}).transport });
    const availability = await bridge.conversation()?.availability();
    expect(availability?.available).toBe(false);
    expect(availability?.failureCode).toBe('HOST_CONTRACT_MISSING');
  });

  it('会话端口上游 500：stream.failed 且带 retryable，不产出 completed', async () => {
    const { transport } = makeTransport({ [AAOS_ENDPOINTS.machineAnswers]: { status: 500 } });
    const bridge = new AaosHostBridge({ baseUrl: 'http://127.0.0.1:1', transport });
    const port = bridge.conversation();
    if (!port) throw new Error('conversation 端口应已构造');
    const events: AstrynAnyEvent[] = [];
    for await (const event of port.stream({ protocol: 'astryn-1', sessionId: 's1', requestId: 'r1', characterId: 'xiaoqi', messages: [], contextFragments: [] }, new AbortController().signal)) {
      events.push(event);
    }
    expect(events.map((event) => event.payload.kind)).toEqual(['stream.started', 'stream.failed']);
    expect((events[1]?.payload as { code: string }).code).toBe('UPSTREAM_REJECTED');
  });

  it('动作端口 probe：宿主可达不等于动作可用，注册表未命中即不可用', async () => {
    const { transport } = makeTransport({ [AAOS_ENDPOINTS.version]: versionOk, [AAOS_ENDPOINTS.capabilities]: { status: 200, body: [{ capability: 'conversation', enabled: true }] } });
    const bridge = new AaosHostBridge({ baseUrl: 'http://127.0.0.1:1', transport });
    const probe = await bridge.actions()?.probe();
    expect(probe?.available).toBe(false);
    expect(probe?.reason).toContain('未知不当可用');
  });

  it('动作端口 probe：协议确认 + jobs 可用时才算可用', async () => {
    const { transport } = makeTransport({ [AAOS_ENDPOINTS.version]: versionOk, [AAOS_ENDPOINTS.capabilities]: registryOk });
    const bridge = new AaosHostBridge({ baseUrl: 'http://127.0.0.1:1', transport });
    const probe = await bridge.actions()?.probe();
    expect(probe).toEqual({ available: true, reason: null });
  });

  it('动作端口 submit：202 只代表声明持久化；权威进展来自轮询回执，且签名恒为空串（不拼串冒充）', async () => {
    const request: AstrynActionRequest = { protocol: 'astryn-1', requestId: 'req-9', sessionId: 's1', actionKind: 'demo', summary: '演示动作', riskTier: 'medium', argumentsDigest: 'sha256:fixture-req-9' };
    const jobStatus = { status: 'running', detail: '执行中' };
    const { transport } = makeTransport({
      [AAOS_ENDPOINTS.jobs]: { status: 201, body: { job_id: 'j-9' } },
      [AAOS_ENDPOINTS.jobExecutions('j-9')]: { status: 202, body: {} },
      [AAOS_ENDPOINTS.jobStatus('j-9')]: { status: 200, body: jobStatus }
    });
    const bridge = new AaosHostBridge({ baseUrl: 'http://127.0.0.1:1', transport, pollIntervalMs: 1 });
    const port = bridge.actions();
    if (!port) throw new Error('actions 端口应已构造');
    const receipts: AstrynActionReceipt[] = [];
    port.subscribe((item) => receipts.push(item));
    const submit = await port.submit(request);
    expect(submit).toEqual({ ok: true, taskId: 'j-9' });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(receipts.length).toBeGreaterThan(0);
    expect(receipts.every((item) => item.outcome === 'started')).toBe(true);
    jobStatus.status = 'completed';
    jobStatus.detail = '完成';
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(receipts.some((item) => item.outcome === 'completed')).toBe(true);
    for (const item of receipts) {
      expect(item.authority).toBe('aaos-core');
      expect(item.signature).toBe('');
      expect(item.taskId).toBe('j-9');
      expect(item.actionRequestId).toBe('req-9');
    }
  });

  it('动作端口 cancel：未知任务 UNKNOWN_TASK；在途任务走宿主取消端点的响应', async () => {
    const request: AstrynActionRequest = { protocol: 'astryn-1', requestId: 'req-10', sessionId: 's1', actionKind: 'demo', summary: '演示', riskTier: 'medium', argumentsDigest: 'sha256:fixture-req-10' };
    const { calls, transport } = makeTransport({
      [AAOS_ENDPOINTS.jobs]: { status: 201, body: { job_id: 'j-10' } },
      [AAOS_ENDPOINTS.jobExecutions('j-10')]: { status: 202, body: {} },
      [AAOS_ENDPOINTS.jobStatus('j-10')]: { status: 200, body: { status: 'running' } },
      [AAOS_ENDPOINTS.jobCancel('j-10', 'req-10')]: { status: 200, body: {} }
    });
    const bridge = new AaosHostBridge({ baseUrl: 'http://127.0.0.1:1', transport, pollIntervalMs: 50 });
    const port = bridge.actions();
    if (!port) throw new Error('actions 端口应已构造');
    expect(await port.cancel('nope')).toEqual({ ok: false, reason: 'UNKNOWN_TASK' });
    await port.submit(request);
    expect(await port.cancel('j-10')).toEqual({ ok: true });
    expect(calls.some((call) => call.path === AAOS_ENDPOINTS.jobCancel('j-10', 'req-10'))).toBe(true);
  });

  it('记忆端口：Consumer 闭集不含星栖，probe 明确 BLOCKED 语义拒绝', async () => {
    const bridge = new AaosHostBridge({ baseUrl: 'http://127.0.0.1:1', transport: makeTransport({}).transport });
    const port = bridge.memory();
    expect(port).not.toBeNull();
    if (!port) return;
    const probe = await port.probe();
    expect(probe.available).toBe(false);
    expect(probe.reason).toContain('Consumer');
    expect(await port.grantsFor('companion')).toEqual([]);
  });

  it('记忆端口：模型自述永远只可 candidate，不产生宿主写入调用', async () => {
    const { calls, transport } = makeTransport({});
    const bridge = new AaosHostBridge({ baseUrl: 'http://127.0.0.1:1', transport });
    const port = bridge.memory();
    if (!port) throw new Error('memory 端口应已构造');
    const result = await port.propose({ scope: 'user_preference', origin: 'model-generated', summary: '模型自述', sessionId: 's1' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('ORIGIN_NOT_PROPOSABLE');
    expect(calls).toHaveLength(0);
  });

  it('记忆端口：用户陈述经宿主写入后仍是 candidate 生命周期，确认/撤销/删除拒绝自任', async () => {
    const { transport } = makeTransport({ [AAOS_ENDPOINTS.knowledgeItems]: { status: 201, body: { id: 'k1' } } });
    const bridge = new AaosHostBridge({ baseUrl: 'http://127.0.0.1:1', transport });
    const port = bridge.memory();
    if (!port) throw new Error('memory 端口应已构造');
    const result = await port.propose({ scope: 'user_preference', origin: 'user-stated', summary: '喜欢安静', sessionId: 's1' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.candidate.lifecycle).toBe('candidate');
      expect(result.candidate.confirmedByReceiptId).toBeNull();
      expect(result.candidate.consentRecordId).toBeNull();
    }
    const mutation = { receiptId: 'mr-1', candidateId: 'c1', to: 'confirmed' as const, issuedBy: 'aaos-core', issuedAt: '2026-10-13T00:00:00.000Z', signature: 'x' };
    expect(await port.confirm(mutation)).toEqual({ ok: false, reason: 'HOST_CONTRACT_MISSING' });
    expect(await port.revoke(mutation)).toEqual({ ok: false, reason: 'HOST_CONTRACT_MISSING' });
    expect(await port.delete(mutation)).toEqual({ ok: false, reason: 'HOST_CONTRACT_MISSING' });
    expect(await port.listForReview('s1')).toEqual([]);
  });

  it('上下文端口：无"当前选区"广播合同，显式拒绝而不猜测', async () => {
    const bridge = new AaosHostBridge({ baseUrl: 'http://127.0.0.1:1', transport: makeTransport({}).transport });
    const port = bridge.context();
    if (!port) throw new Error('context 端口应已构造');
    const probe = await port.probe();
    expect(probe.available).toBe(false);
    expect(probe.reason).toContain('选区');
    expect(await port.requestAuthorization('active-document-selection', 's1')).toBeNull();
    const fakeAuthorization = { authorizationId: 'auth-fixture', scope: 'active-document-selection' as const, grantedBy: 'user' as const, grantedAt: '2026-10-13T00:00:00.000Z', expiresAt: null };
    expect(await port.readSelection(fakeAuthorization, 'r1')).toEqual({ ok: false, reason: 'SCOPE_NOT_SUPPORTED' });
  });
});
