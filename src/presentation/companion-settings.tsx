import { ASTRYN_COMPANION_PERSONAS, ASTRYN_MOUTH_MODE_LABELS, withOverrides } from '@astryn/contracts';
import type { AstrynCharacterProfile, AstrynSpeechAvailability, AstrynSpeechFeature } from '@astryn/contracts';
import type { SpeechPlaybackSnapshot } from '../speech/playback';

const SPEECH_FEATURES: readonly AstrynSpeechFeature[] = ['microphone', 'asr', 'tts', 'playback'];
const SPEECH_FEATURE_LABELS: Readonly<Record<AstrynSpeechFeature, string>> = {
  microphone: '麦克风',
  asr: '语音识别',
  tts: '朗读',
  playback: '音频播放'
};
const SPEECH_STATUS_LABELS: Readonly<Record<SpeechPlaybackSnapshot['status'], string>> = {
  idle: '空闲',
  speaking: '朗读中',
  finished: '本段结束'
};

export interface CompanionSettingsProps {
  readonly profile: AstrynCharacterProfile;
  /** 档案保存去向（来自 profile store），界面必须如实标注。 */
  readonly storageLabel: string;
  readonly storagePersistent: boolean;
  readonly saving: boolean;
  /** 上一次保存的结果说明（成功/冲突/宿主未接通），null 表示尚未保存过。 */
  readonly notice: string | null;
  /** 语音能力可用性读数（GF09）：未接通的原因必须原样显示。 */
  readonly speechAvailability: AstrynSpeechAvailability;
  readonly speechState: SpeechPlaybackSnapshot;
  readonly onSpeechSample: (text: string) => void;
  readonly onSpeechStop: () => void;
  readonly onChange: (profile: AstrynCharacterProfile) => void;
  readonly onSave: () => void;
  readonly onReset: () => void;
  readonly onClose: () => void;
}

/**
 * 配置视图：结构化档案的可视编辑器。
 * 只改表达层（人格语气、主动性、学习偏好、外观）；边界与授权规则不可在此修改。
 */
export function CompanionSettings(props: CompanionSettingsProps): JSX.Element {
  const {
    profile,
    storageLabel,
    storagePersistent,
    saving,
    notice,
    speechAvailability,
    speechState,
    onSpeechSample,
    onSpeechStop,
    onChange,
    onSave,
    onReset,
    onClose
  } = props;
  const set = (overrides: Parameters<typeof withOverrides>[1]): void => onChange(withOverrides(profile, overrides));
  const selectedPersona = ASTRYN_COMPANION_PERSONAS.find((spec) => spec.id === profile.persona);
  const speechUnavailableReason =
    SPEECH_FEATURES.map((feature) => speechAvailability[feature]).find((entry) => !entry.available)?.reason ?? null;

  return (
    <section className="astryn-settings" data-testid="astryn-settings" aria-label="小栖设置">
      <div className="astryn-settings-head">
        <span className="astryn-title">小栖设置</span>
        <button type="button" className="astryn-btn" data-testid="astryn-settings-close" onClick={onClose}>关闭设置</button>
      </div>

      <fieldset className="astryn-settings-group" data-testid="astryn-settings-identity">
        <legend>身份</legend>
        <p className="astryn-disclosure">{profile.aiDisclosure}</p>
        <label className="astryn-settings-row">
          <span>名字</span>
          <input
            type="text"
            data-testid="astryn-settings-display-name"
            value={profile.displayName}
            onChange={(event) => {
              const next = event.target.value;
              if (next.trim().length > 0) onChange({ ...profile, displayName: next });
            }}
          />
        </label>
        <p className="astryn-disclosure" data-testid="astryn-settings-storage">
          档案保存去向：{storageLabel}{storagePersistent ? '（持久）' : '（刷新即失）'}
        </p>
        <p className="astryn-disclosure" data-testid="astryn-settings-revision">
          档案版本 v{profile.schemaVersion} · 修订 {profile.profileRevision}
        </p>
      </fieldset>

      <fieldset className="astryn-settings-group" data-testid="astryn-settings-persona">
        <legend>关系风格</legend>
        {ASTRYN_COMPANION_PERSONAS.map((spec) => (
          <label key={spec.id} className="astryn-settings-option">
            <input
              type="radio"
              name="astryn-persona"
              data-testid={`astryn-persona-${spec.id}`}
              checked={profile.persona === spec.id}
              onChange={() => set({ persona: spec.id })}
            />
            <span>
              <strong>{spec.label}{spec.optIn ? '（需本人选择）' : ''}</strong>
              <br />
              <span className="astryn-disclosure">{spec.summary}</span>
            </span>
          </label>
        ))}
        {selectedPersona?.optIn ? (
          <p className="astryn-disclosure" data-testid="astryn-persona-optin-note">
            女友语气正在启用：这是你本人的选择，可以随时切回其他风格；它只影响表达方式，不改变事实来源与授权规则。
          </p>
        ) : null}
      </fieldset>

      <fieldset className="astryn-settings-group" data-testid="astryn-settings-style">
        <legend>表达</legend>
        <div className="astryn-settings-row-group" role="group" aria-label="语气">
          {(['warm', 'calm', 'playful'] as const).map((tone) => (
            <label key={tone} className="astryn-settings-inline">
              <input
                type="radio"
                name="astryn-tone"
                data-testid={`astryn-style-tone-${tone}`}
                checked={profile.expressionStyle.greetingTone === tone}
                onChange={() => set({ expressionStyle: { greetingTone: tone } })}
              />
              {{ warm: '温暖', calm: '平静', playful: '俏皮' }[tone]}
            </label>
          ))}
        </div>
        <div className="astryn-settings-row-group" role="group" aria-label="回复长度">
          {(['brief', 'balanced', 'detailed'] as const).map((length) => (
            <label key={length} className="astryn-settings-inline">
              <input
                type="radio"
                name="astryn-length"
                data-testid={`astryn-style-length-${length}`}
                checked={profile.expressionStyle.replyLength === length}
                onChange={() => set({ expressionStyle: { replyLength: length } })}
              />
              {{ brief: '简短', balanced: '适中', detailed: '展开' }[length]}
            </label>
          ))}
        </div>
        <div className="astryn-settings-row-group" role="group" aria-label="表情符号">
          {(['none', 'sparse'] as const).map((emoji) => (
            <label key={emoji} className="astryn-settings-inline">
              <input
                type="radio"
                name="astryn-emoji"
                data-testid={`astryn-style-emoji-${emoji}`}
                checked={profile.expressionStyle.emojiUse === emoji}
                onChange={() => set({ expressionStyle: { emojiUse: emoji } })}
              />
              {{ none: '不使用', sparse: '少量' }[emoji]}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="astryn-settings-group" data-testid="astryn-settings-initiative">
        <legend>主动程度</legend>
        <label className="astryn-settings-inline">
          <input
            type="checkbox"
            data-testid="astryn-nudging-toggle"
            checked={profile.initiative.proactiveNudging}
            onChange={(event) =>
              set({
                initiative: event.target.checked
                  ? { proactiveNudging: true, nudgingCadence: profile.initiative.nudgingCadence === 'off' ? 'low' : profile.initiative.nudgingCadence }
                  : { proactiveNudging: false, nudgingCadence: 'off' }
              })
            }
          />
          允许在获准情境下主动提示
        </label>
        <label className="astryn-settings-row">
          <span>频率</span>
          <select
            data-testid="astryn-nudging-cadence"
            value={profile.initiative.nudgingCadence}
            disabled={!profile.initiative.proactiveNudging}
            onChange={(event) => set({ initiative: { nudgingCadence: event.target.value as 'off' | 'low' | 'medium' } })}
          >
            <option value="off">关闭</option>
            <option value="low">低</option>
            <option value="medium">中</option>
          </select>
        </label>
        <p className="astryn-disclosure">主动提示永远不会打断专注中的学习，也不会用于催促。</p>
      </fieldset>

      <fieldset className="astryn-settings-group" data-testid="astryn-settings-learning">
        <legend>学习偏好</legend>
        <div className="astryn-settings-row-group" role="group" aria-label="讲解深度">
          {(['brief', 'standard', 'deep'] as const).map((depth) => (
            <label key={depth} className="astryn-settings-inline">
              <input
                type="radio"
                name="astryn-depth"
                data-testid={`astryn-learning-depth-${depth}`}
                checked={profile.learning.explanationDepth === depth}
                onChange={() => set({ learning: { explanationDepth: depth } })}
              />
              {{ brief: '先给结论', standard: '适中', deep: '展开推理' }[depth]}
            </label>
          ))}
        </div>
        <label className="astryn-settings-inline">
          <input
            type="checkbox"
            data-testid="astryn-learning-examples"
            checked={profile.learning.examplesFirst}
            onChange={(event) => set({ learning: { examplesFirst: event.target.checked } })}
          />
          先给例子
        </label>
        <label className="astryn-settings-inline">
          <input
            type="checkbox"
            data-testid="astryn-learning-quiz"
            checked={profile.learning.quizMe}
            onChange={(event) => set({ learning: { quizMe: event.target.checked } })}
          />
          讲完后出小题帮我自查
        </label>
      </fieldset>

      <fieldset className="astryn-settings-group" data-testid="astryn-settings-appearance">
        <legend>外观</legend>
        <p className="astryn-disclosure">渲染器：{profile.appearance.rendererId}（装置原创 SVG 角色，不捆绑第三方素材）</p>
        <label className="astryn-settings-inline">
          <input
            type="checkbox"
            data-testid="astryn-settings-reduced-motion"
            checked={profile.appearance.reducedMotion}
            onChange={(event) => set({ appearance: { reducedMotion: event.target.checked } })}
          />
          减少动效
        </label>
      </fieldset>

      <fieldset className="astryn-settings-group" data-testid="astryn-settings-voice">
        <legend>声音</legend>
        <div className="astryn-settings-row-group" role="group" aria-label="语音能力可用性">
          {SPEECH_FEATURES.map((feature) => {
            const entry = speechAvailability[feature];
            return (
              <span
                key={feature}
                className="astryn-chip"
                data-testid={`astryn-speech-avail-${feature}`}
                data-available={entry.available ? 'true' : 'false'}
              >
                {SPEECH_FEATURE_LABELS[feature]}：{entry.available ? '可用' : '未接'}
              </span>
            );
          })}
        </div>
        <p className="astryn-disclosure" data-testid="astryn-voice-note">
          {speechUnavailableReason ?? '语音端口已接通：朗读、字幕与口型按音频主时钟（audio playback clock）同步。'}
        </p>
        <label className="astryn-settings-row">
          <span>音色</span>
          <select data-testid="astryn-voice-style" value={profile.voiceStyle.styleId} disabled>
            <option value={profile.voiceStyle.styleId}>{profile.voiceStyle.styleId}</option>
          </select>
        </label>
        <p className="astryn-disclosure">音色目录归宿主（语音端口未接通）：当前仅登记默认音色，接通后再开放选择。</p>
        <label className="astryn-settings-row">
          <span>语速 {profile.voiceStyle.speakingRate.toFixed(2)}</span>
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.05}
            data-testid="astryn-voice-rate"
            value={profile.voiceStyle.speakingRate}
            onChange={(event) => set({ voiceStyle: { speakingRate: Number(event.target.value) } })}
          />
        </label>
        <label className="astryn-settings-row">
          <span>音高 {profile.voiceStyle.pitchOffset > 0 ? `+${profile.voiceStyle.pitchOffset}` : profile.voiceStyle.pitchOffset}</span>
          <input
            type="range"
            min={-6}
            max={6}
            step={1}
            data-testid="astryn-voice-pitch"
            value={profile.voiceStyle.pitchOffset}
            onChange={(event) => set({ voiceStyle: { pitchOffset: Number(event.target.value) } })}
          />
        </label>
        <label className="astryn-settings-row">
          <span>音量 {Math.round(profile.voiceStyle.volume * 100)}%</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            data-testid="astryn-voice-volume"
            value={profile.voiceStyle.volume}
            onChange={(event) => set({ voiceStyle: { volume: Number(event.target.value) } })}
          />
        </label>
        <label className="astryn-settings-inline">
          <input
            type="checkbox"
            data-testid="astryn-voice-enabled"
            checked={profile.voiceStyle.enabled}
            onChange={(event) => set({ voiceStyle: { enabled: event.target.checked } })}
          />
          朗读（偏好；语音端口接通后生效）
        </label>
        <label className="astryn-settings-inline">
          <input
            type="checkbox"
            data-testid="astryn-voice-microphone"
            checked={profile.voiceStyle.microphone}
            onChange={(event) => set({ voiceStyle: { microphone: event.target.checked } })}
          />
          允许语音输入（麦克风偏好）
        </label>
        <label className="astryn-settings-inline">
          <input
            type="checkbox"
            data-testid="astryn-voice-subtitles"
            checked={profile.voiceStyle.subtitles}
            onChange={(event) => set({ voiceStyle: { subtitles: event.target.checked } })}
          />
          朗读时显示字幕
        </label>
        <div className="astryn-toolbar astryn-toolbar--spaced">
          <button
            type="button"
            className="astryn-btn"
            data-testid="astryn-voice-sample"
            disabled={!speechAvailability.tts.available || speechState.status === 'speaking'}
            title={speechAvailability.tts.reason ?? undefined}
            onClick={() => onSpeechSample(`你好，我是${profile.displayName}。`)}
          >
            试听一段
          </button>
          <button
            type="button"
            className="astryn-btn"
            data-testid="astryn-voice-stop"
            disabled={speechState.status !== 'speaking'}
            title={
              speechState.status !== 'speaking'
                ? speechAvailability.playback.reason ?? '当前没有正在朗读的段。'
                : undefined
            }
            onClick={onSpeechStop}
          >
            停止朗读
          </button>
          <button
            type="button"
            className="astryn-btn"
            data-testid="astryn-voice-mic-hold"
            disabled={!speechAvailability.microphone.available}
            title={speechAvailability.microphone.reason ?? undefined}
            onClick={() => undefined}
          >
            按住说话
          </button>
        </div>
        <p className="astryn-disclosure" data-testid="astryn-voice-mouth-mode">
          口型模式：{ASTRYN_MOUTH_MODE_LABELS[speechState.mouthMode]}；M0 呈现层仍为文本帧口型，音素选帧属未来口型驱动器。
        </p>
        <p className="astryn-disclosure" data-testid="astryn-voice-runtime">
          朗读状态：{SPEECH_STATUS_LABELS[speechState.status]}
          {speechState.status !== 'idle' && speechState.provenance ? ` · 来源 ${speechState.provenance}` : ''}
        </p>
        {speechState.subtitle !== null ? (
          <p className="astryn-disclosure" data-testid="astryn-voice-subtitle">字幕：{speechState.subtitle}</p>
        ) : null}
        {speechState.lastNotice ? (
          <p className="astryn-disclosure" data-testid="astryn-voice-last-notice">{speechState.lastNotice}</p>
        ) : null}
        <p className="astryn-disclosure">麦克风采集归宿主权限面：星栖前端不直接采集；未接通前此偏好不启用任何采集。</p>
        {profile.voiceStyle.enabled && !speechAvailability.tts.available ? (
          <p className="astryn-disclosure" data-testid="astryn-voice-preference-note">
            朗读偏好已开启，但语音端口未接通（BE01）：当前保持文本模式，不播放任何语音。
          </p>
        ) : null}
      </fieldset>

      <div className="astryn-toolbar astryn-settings-actions">
        <button type="button" className="astryn-btn" data-testid="astryn-settings-save" disabled={saving} onClick={onSave}>
          {saving ? '保存中…' : '保存到宿主记录'}
        </button>
        <button type="button" className="astryn-btn" data-testid="astryn-settings-reset" onClick={onReset}>恢复默认</button>
      </div>
      {notice ? <p className="astryn-disclosure" data-testid="astryn-settings-notice">{notice}</p> : null}
    </section>
  );
}
