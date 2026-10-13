import type {
  AstrynCharacterProfile,
  AstrynChatMessage,
  AstrynCompanionState
} from '@astryn/contracts';
import { AstrynCompanionController } from './companion-controller';
import type { CompanionControllerDeps, ControllerAudit } from './companion-controller';
import type { AstrynProfileLoad, AstrynProfileStore } from '../companion/profile-store';

/** 会话运行所需的宿主端口集合：变化即视为运行环境变化。 */
export interface CompanionSessionPorts {
  readonly sessionId: string;
  readonly conversation: CompanionControllerDeps['conversation'];
  readonly actions: CompanionControllerDeps['actions'];
  readonly verifier: CompanionControllerDeps['verifier'];
}

export type CompanionManagerDeps = CompanionSessionPorts & Pick<CompanionControllerDeps, 'profile' | 'host' | 'nextId'>;

/** 视图渲染所需的会话快照：业务状态单一来源，多视图共享同一份。 */
export interface CompanionSessionSnapshot {
  readonly sessionId: string;
  readonly state: AstrynCompanionState;
  readonly profile: AstrynCharacterProfile;
  readonly transcript: readonly AstrynChatMessage[];
  readonly audit: ControllerAudit;
  readonly viewsAttached: number;
  /** 无视图时渲染暂停（不推送快照），业务与宿主订阅照常运行。 */
  readonly renderingPaused: boolean;
}

export type AstrynSubmitOutcome =
  | { readonly accepted: true; readonly requestId: string }
  | { readonly accepted: false; readonly reason: 'EMPTY_INPUT' | 'SESSION_BUSY' | 'DISPOSED' };

export interface CompanionSessionManagerOptions {
  /**
   * 最后一个视图释放后延迟销毁（0ms）：同一同步批次内重新 retain 会取消销毁。
   * 这是 React StrictMode 下"清理→重建"双调用场景的安全前提；由管理器自建的实例应开启。
   */
  readonly disposeWhenUnobserved?: boolean;
}

/**
 * 会话管理服务：controller、transcript、请求与取消状态的唯一所有者。
 * 视图只 retain + 订阅快照，不各自持有运行时；同一次请求只会执行一遍。
 * 单飞提交：一轮未结束前不接受新提交（与 UI 上"流式时发送按钮禁用、提供停止生成"一致），
 * 需要打断时先 cancel('superseded') 再提交下一轮。
 */
export class CompanionSessionManager {
  private deps: CompanionManagerDeps;
  private controller: AstrynCompanionController;
  private controllerUnsubscribe: (() => void) | null = null;
  private detachController: (() => void) | null = null;
  private readonly viewHandles = new Set<{ readonly kind: string }>();
  private readonly listeners = new Set<(snapshot: CompanionSessionSnapshot) => void>();
  private readonly profileLoads = new Map<AstrynProfileStore, Promise<AstrynProfileLoad>>();
  private readonly disposeWhenUnobserved: boolean;
  private started = false;
  private finalized = false;
  private disposeTimer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;
  private snapshotCache: CompanionSessionSnapshot | null = null;

  constructor(deps: CompanionManagerDeps, options: CompanionSessionManagerOptions = {}) {
    this.deps = deps;
    this.disposeWhenUnobserved = options.disposeWhenUnobserved ?? false;
    this.controller = new AstrynCompanionController(deps);
    this.controllerUnsubscribe = this.controller.subscribe(() => this.invalidate());
  }

  get disposed(): boolean {
    return this.finalized;
  }

  get viewCount(): number {
    return this.viewHandles.size;
  }

  get snapshot(): CompanionSessionSnapshot {
    if (!this.snapshotCache) {
      this.snapshotCache = {
        sessionId: this.deps.sessionId,
        state: this.controller.currentState,
        profile: this.deps.profile,
        transcript: this.controller.transcript,
        audit: this.controller.audit,
        viewsAttached: this.viewHandles.size,
        renderingPaused: this.viewHandles.size === 0
      };
    }
    return this.snapshotCache;
  }

  /**
   * 视图挂载时调用；返回的释放函数必须且只需调用一次。
   * 首个视图触发 start()：构造保持纯净，被 React 丢弃的实例不会订阅宿主端口。
   */
  retainView(kind: string): () => void {
    if (this.finalized) return () => undefined;
    this.cancelPendingDispose();
    const handle = { kind };
    this.viewHandles.add(handle);
    this.start();
    this.invalidate();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.viewHandles.delete(handle);
      if (this.viewHandles.size === 0 && this.disposeWhenUnobserved) this.scheduleDispose();
      this.invalidate();
    };
  }

  subscribe(listener: (snapshot: CompanionSessionSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async submit(text: string): Promise<AstrynSubmitOutcome> {
    if (this.finalized) return { accepted: false, reason: 'DISPOSED' };
    if (this.inFlight) return { accepted: false, reason: 'SESSION_BUSY' };
    if (text.trim().length === 0) return { accepted: false, reason: 'EMPTY_INPUT' };
    this.inFlight = true;
    try {
      const { requestId } = await this.controller.submit(text);
      return { accepted: true, requestId };
    } finally {
      this.inFlight = false;
    }
  }

  cancel(reason: 'user' | 'superseded' | 'unmount' = 'user'): void {
    if (this.finalized) return;
    this.controller.cancel(reason);
  }

  attachContext(fragments: Parameters<AstrynCompanionController['attachContext']>[0]): void {
    if (this.finalized) return;
    this.controller.attachContext(fragments);
  }

  notifyFocus(surface: 'composer' | 'chat-log' = 'composer'): void {
    if (this.finalized) return;
    this.controller.notifyFocus(surface);
  }

  notifyBlur(surface: 'composer' | 'chat-log' = 'composer'): void {
    if (this.finalized) return;
    this.controller.notifyBlur(surface);
  }

  /** 档案更新：在原实例上生效，不打断在途请求与会话连续性（下一轮提示采用新档案）。 */
  setProfile(profile: AstrynCharacterProfile): void {
    if (this.finalized) return;
    if (this.deps.profile === profile) return;
    this.deps = { ...this.deps, profile };
    this.controller.setProfile(profile);
    this.invalidate();
  }

  /** 档案存储读取：按存储实例去重（多个视图、StrictMode 双效果只读一次），结果写回管理器。 */
  ensureProfileLoaded(store: AstrynProfileStore): Promise<AstrynProfileLoad> {
    const cached = this.profileLoads.get(store);
    if (cached) return cached;
    const loading = store.load().then((result) => {
      if (!this.finalized) this.setProfile(result.profile);
      return result;
    });
    loading.catch(() => {
      this.profileLoads.delete(store);
    });
    this.profileLoads.set(store, loading);
    return loading;
  }

  /**
   * 端口身份变化时替换运行时。界面同一性不受影响：
   * 视图拿到的管理器对象不变，会话内记录会重置（与"换端口=换运行环境"语义一致）。
   */
  configurePorts(next: CompanionSessionPorts): void {
    if (this.finalized) return;
    const unchanged =
      next.sessionId === this.deps.sessionId &&
      next.conversation === this.deps.conversation &&
      next.actions === this.deps.actions &&
      next.verifier === this.deps.verifier;
    if (unchanged) return;
    this.deps = { ...this.deps, ...next };
    this.disposeController();
    this.controller = new AstrynCompanionController(this.deps);
    this.controllerUnsubscribe = this.controller.subscribe(() => this.invalidate());
    if (this.started) this.detachController = this.controller.attach();
    this.invalidate();
  }

  /** 显式销毁：同步终结。disposeWhenUnobserved 场景请用 retainView 的释放函数，勿直接调用。 */
  dispose(): void {
    if (this.finalized) return;
    this.cancelPendingDispose();
    this.finalize();
  }

  private start(): void {
    if (this.started || this.finalized) return;
    this.started = true;
    this.detachController = this.controller.attach();
  }

  private disposeController(): void {
    this.controllerUnsubscribe?.();
    this.controllerUnsubscribe = null;
    this.detachController?.();
    this.detachController = null;
    this.controller.dispose();
  }

  private finalize(): void {
    if (this.finalized) return;
    this.finalized = true;
    this.disposeController();
    this.listeners.clear();
    this.viewHandles.clear();
    this.snapshotCache = null;
  }

  private scheduleDispose(): void {
    if (this.disposeTimer !== null || this.finalized) return;
    this.disposeTimer = setTimeout(() => {
      this.disposeTimer = null;
      this.finalize();
    }, 0);
  }

  private cancelPendingDispose(): void {
    if (this.disposeTimer !== null) {
      clearTimeout(this.disposeTimer);
      this.disposeTimer = null;
    }
  }

  private invalidate(): void {
    this.snapshotCache = null;
    if (this.finalized || this.viewHandles.size === 0) return;
    const snapshot = this.snapshot;
    for (const listener of this.listeners) listener(snapshot);
  }
}

export function createCompanionSessionManager(
  deps: CompanionManagerDeps,
  options: CompanionSessionManagerOptions = {}
): CompanionSessionManager {
  return new CompanionSessionManager(deps, options);
}
