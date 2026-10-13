import { ASTRYN_COMPANION_PERSONAS, withOverrides } from '@astryn/contracts';
import type { AstrynCharacterProfile } from '@astryn/contracts';

export interface CompanionSettingsProps {
  readonly profile: AstrynCharacterProfile;
  /** 档案保存去向（来自 profile store），界面必须如实标注。 */
  readonly storageLabel: string;
  readonly storagePersistent: boolean;
  readonly saving: boolean;
  /** 上一次保存的结果说明（成功/冲突/宿主未接通），null 表示尚未保存过。 */
  readonly notice: string | null;
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
  const { profile, storageLabel, storagePersistent, saving, notice, onChange, onSave, onReset, onClose } = props;
  const set = (overrides: Parameters<typeof withOverrides>[1]): void => onChange(withOverrides(profile, overrides));
  const selectedPersona = ASTRYN_COMPANION_PERSONAS.find((spec) => spec.id === profile.persona);

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
        <label className="astryn-settings-inline">
          <input type="checkbox" data-testid="astryn-voice-enable" checked={false} disabled readOnly />
          启用语音（未接通）
        </label>
        <p className="astryn-disclosure" data-testid="astryn-voice-note">
          声音端口依赖宿主合同（GF09 预留）：未接通前不播放任何语音，也不播放占位音效。
        </p>
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
