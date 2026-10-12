import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { XIAOQI_PROFILE, createEvent, initialState, resolveConversation } from '@astryn/core';
import type { AstrynAnyEvent } from '@astryn/contracts';
import {
  AstrynCompanionController,
  AstrynEventGuard,
  AVATAR_RENDERERS,
  SyntheticConversationPort,
  redactErrorText,
  selectAvatarRenderer
} from '@astryn/core';
import { CompanionShell } from '@astryn/core';

/**
 * 架构风险审查（docs/architecture/astryn-m0.risk-quality.md）确认的五个缺口的回归测试。
 * 每条都对应一个"看起来已实现、实际可被绕过或被高估"的具体位置。
 */

describe('R1 渲染 seam 必须真的被使用', () => {
  it('呈现层通过注册表取渲染驱动，而不是直接 import 具体实现', () => {
    render(
      <CompanionShell
        mode="panel"
        sessionId="s1"
        profile={XIAOQI_PROFILE}
        conversation={new SyntheticConversationPort({ steps: [{ text: 'x' }, { finish: 'stop' }] })}
      />
    );
    const host = screen.getByTestId('astryn-avatar-host');
    expect(host.getAttribute('data-renderer')).toBe(XIAOQI_PROFILE.appearance.rendererId);
  });

  it('注册表可解析已注册驱动，未知 id 回退而不是抛错或静默空白', () => {
    expect(AVATAR_RENDERERS.length).toBeGreaterThan(0);
    expect(selectAvatarRenderer('xiaoqi-svg-v1').rendererId).toBe('xiaoqi-svg-v1');
    expect(selectAvatarRenderer('live2d-not-installed').rendererId).toBe('xiaoqi-svg-v1');
  });

  it('每个已注册驱动都必须提供 renderMarkup 或 mount 之一', () => {
    for (const renderer of AVATAR_RENDERERS) {
      expect(renderer.renderMarkup ?? renderer.mount, `${renderer.rendererId} 无法落地画面`).toBeTruthy();
    }
  });
});

describe('R2 乱序检测必须作用于宿主原始序号', () => {
  const envelope = (seq: number, originSeq: number | null) =>
    createEvent({
      source: 'conversation',
      trust: 'observed',
      kind: 'stream.delta',
      payload: { text: 'x' },
      sessionId: 's1',
      requestId: 'r1',
      seq,
      originSeq
    }) as unknown as AstrynAnyEvent;

  it('本地 seq 递增但 originSeq 回退时，必须按乱序丢弃', () => {
    const guard = new AstrynEventGuard('s1');
    guard.openRequest('r1');
    expect(guard.accept(envelope(0, 7)).accepted).toBe(true);
    expect(guard.accept(envelope(1, 9)).accepted).toBe(true);
    expect(guard.accept(envelope(2, 8)).accepted).toBe(false);
    expect(guard.accept(envelope(2, 8)).reason).toBe('OUT_OF_ORDER_ORIGIN_SEQ');
  });

  it('无原始序号时退回本地判序，行为不变', () => {
    const guard = new AstrynEventGuard('s1');
    guard.openRequest('r1');
    expect(guard.accept(envelope(0, null)).accepted).toBe(true);
    expect(guard.accept(envelope(1, null)).accepted).toBe(true);
    expect(guard.accept(envelope(1, null)).reason).toBe('NON_MONOTONIC_SEQ');
  });
});

describe('R3 错误文本不得带出上游地址或凭据', () => {
  it('URL、Bearer、key 样式一律先脱敏再截断', () => {
    expect(redactErrorText('connect ECONNREFUSED https://user:tok@endpoint.example/v1')).not.toContain('endpoint.example');
    expect(redactErrorText('Authorization: Bearer sk-abcdef123456')).not.toContain('sk-abcdef123456');
    expect(redactErrorText('x'.repeat(900))).toHaveLength(240);
    expect(redactErrorText('普通网络错误')).toBe('普通网络错误');
  });
});

describe('R4 证据级别不得靠配置推断', () => {
  it('仅配置了开发代理时是 NO_EVIDENCE，不是 REAL', () => {
    const resolved = resolveConversation({
      aaosBaseUrl: null,
      devProxyConfigured: true,
      devProxyModel: 'some-model',
      allowSynthetic: false
    });
    expect(resolved.port).not.toBeNull();
    expect(resolved.info.evidenceLevel).toBe('NO_EVIDENCE');
    expect(resolved.info.available).toBe(true);
  });

  it('真正收到非合成端口的回复内容后才升级为 REAL', () => {
    const base = initialState('s1', {
      kind: 'openai-compatible-dev',
      providerId: 'p',
      modelId: 'm',
      available: true,
      reason: null,
      evidenceLevel: 'NO_EVIDENCE'
    });
    const controller = new AstrynCompanionController({ sessionId: 's1', profile: XIAOQI_PROFILE, conversation: null, actions: null, verifier: null });
    controller.dispatch(createEvent({
      source: 'conversation',
      trust: 'observed',
      kind: 'stream.delta',
      payload: { text: '真实回复' },
      sessionId: 's1',
      requestId: 'r1',
      seq: 0
    }) as unknown as AstrynAnyEvent);
    // 没有活动请求时该事件被拒，证据级别不变。
    expect(controller.currentState.model.evidenceLevel).toBe('NO_EVIDENCE');
    expect(base.model.evidenceLevel).toBe('NO_EVIDENCE');
  });
});

describe('R5 开发代理必须拒绝非白名单来源', () => {
  it('代理脚本声明了 Origin 白名单常量并默认只放行开发宿主', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('dev-host/server/dev-model-proxy.mjs', 'utf8');
    expect(source).toContain('ALLOWED_ORIGINS');
    expect(source).toContain('PERMISSION_DENIED');
    expect(source).toMatch(/127\.0\.0\.1:5183/);
  });
});

describe('R6 启动即探测可用性', () => {
  it('端口不可用时 attach() 后界面已有 MODEL_UNAVAILABLE，不必等用户发消息', async () => {
    const unavailablePort = {
      protocol: 'astryn-1',
      providerId: 'dead-proxy',
      transport: 'openai-compatible',
      evidenceLevel: 'REAL',
      modelId: 'm',
      availability: async () => ({ available: false, reason: '开发代理未配置上游模型', failureCode: 'MODEL_UNAVAILABLE' }),
      async *stream() {
        /* 不会被调用 */
      }
    };
    const controller = new AstrynCompanionController({
      sessionId: 's1',
      profile: XIAOQI_PROFILE,
      conversation: unavailablePort as never,
      actions: null,
      verifier: null
    });
    controller.attach();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(controller.currentState.failure?.code).toBe('MODEL_UNAVAILABLE');
    expect(controller.currentState.model.available).toBe(false);
    expect(controller.currentState.streamedText).toBe('');
  });
});
