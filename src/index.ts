export * from '../contracts/index';
export { reduceCompanionState } from './companion/reducer';
export type { ReduceResult } from './companion/reducer';
export { AstrynEventGuard, ASTRYN_REJECTION_REASONS } from './companion/session-guard';
export type { AstrynAcceptResult, AstrynRejectionReason } from './companion/session-guard';
export { composePromptSections, composeSystemPrompt, buildConversationMessages, PROMPT_TEMPLATE_VERSION } from './companion/prompt-composer';
export { createEphemeralProfileStore, createHostProfileStore } from './companion/profile-store';
export type { AstrynProfileStore, AstrynProfileLoad, AstrynProfileSave } from './companion/profile-store';
export { AstrynCompanionController } from './interaction/companion-controller';
export type {
  CompanionControllerDeps,
  ControllerAudit,
  ControllerRetryResult,
  RetryCandidate,
  RetryDisposition
} from './interaction/companion-controller';
export { CompanionSessionManager, createCompanionSessionManager } from './interaction/session-manager';
export type {
  AstrynRetryOutcome,
  AstrynSubmitOutcome,
  CompanionManagerDeps,
  CompanionSessionManagerOptions,
  CompanionSessionPorts,
  CompanionSessionSnapshot
} from './interaction/session-manager';
export { OpenAiCompatibleConversationPort } from './adapters/openai-compatible';
export { SyntheticConversationPort } from './adapters/synthetic-conversation';
export { SyntheticHostSimulator } from './adapters/synthetic-host';
export { AaosHostBridge, AAOS_ENDPOINTS, AAOS_API_PREFIX } from './adapters/aaos-bridge';
export type { AaosBridgeConfig, AaosTransport } from './adapters/aaos-bridge';
export {
  ASTRYN_PORT_MANIFEST,
  describePortAvailability,
  interpretVersionPayload,
  interpretCapabilityRegistry,
  isCompatibleHostContract,
  readingFor
} from './adapters/host-handshake';
export type { AstrynPortAvailability, AstrynPortId, AstrynPortManifestEntry, AstrynHostVersionReading } from './adapters/host-handshake';
export { resolveConversation } from './adapters/model-registry';
export type { ModelRegistryInput, ResolvedConversation } from './adapters/model-registry';
export { SseDecoder, SSE_DONE_SENTINEL } from './adapters/sse';
export { SyntheticMemoryFixture } from './memory/synthetic-fixture';
export { decideLifecycle, decideRead, decideWrite } from './memory/policy';
export type { MemoryDecision } from './memory/policy';
export { ASTRYN_MEMORY_SPACES, MemoryManager } from './memory/manager';
export type {
  AstrynMemorySpace,
  MemoryExport,
  MemoryExportResult,
  MemoryManagerOptions,
  MemoryOperationResult,
  MemoryOperationStep,
  MemoryProposeInput,
  MemoryReadBack,
  MemoryReadBackEntry,
  MemoryView
} from './memory/manager';
export {
  ASTRYN_LEARNING_INTENTS,
  ASTRYN_RECALL_OUTCOMES,
  ASTRYN_REVIEW_INTERVALS_MS,
  ASTRYN_TURN_KINDS,
  intentAllowsAuthor,
  knowledgeRouting,
  linkFromFragment,
  linkFromMaterial,
  masteryFromOutcomes,
  scheduleFromOutcome,
  UNLINKED_SOURCE
} from './learning/types';
export type {
  AstrynKnowledgeRouting,
  AstrynLearningIntent,
  AstrynLearningJourney,
  AstrynLearningMaterial,
  AstrynLearningMindset,
  AstrynLearningTurn,
  AstrynMasteryLevel,
  AstrynMasteryReading,
  AstrynMaterialInput,
  AstrynOutcomeRecord,
  AstrynRecallOutcome,
  AstrynReviewState,
  AstrynSourceLink,
  AstrynTurnKind
} from './learning/types';
export { createLearningCompanion, LearningCompanionStore } from './learning/store';
export type {
  AstrynAddMaterialResult,
  AstrynRecordOutcomeResult,
  AstrynRecordTurnReason,
  AstrynRecordTurnResult,
  AstrynReminderPlan,
  AstrynStartJourneyResult,
  AstrynTurnInput,
  LearningCompanionOptions,
  LearningSnapshot
} from './learning/store';
export { SyntheticContextFixture, SYNTHETIC_DOC } from './context/synthetic-context';
export { STATE_VISUALS, MOUTH_CYCLE, eyesFor, mouthPathFor } from './avatar/state-visuals';
export { XiaoqiAvatar, describeXiaoqiFrame } from './avatar/xiaoqi-avatar';
export { AVATAR_VIEW_PROFILES, avatarViewProfile, avatarViewForMode } from './avatar/render-profiles';
export type { AstrynAvatarViewId } from './avatar/render-profiles';
export { ASTRYN_BODY_PRESETS, RESERVED_BODY_PRESETS, STATE_ACTIONS, bodyPresetFor, unreachedBodyPresets } from './avatar/state-action-matrix';
export type { AstrynBodyPreset, AstrynStateActionSpec } from './avatar/state-action-matrix';
export { xiaoqiSvgRenderer, renderXiaoqiMarkup, AVATAR_RENDERERS, selectAvatarRenderer, resolveAvatarRenderer } from './avatar/xiaoqi-svg-renderer';
export { redactErrorText } from './adapters/openai-compatible';
export { CompanionShell } from './presentation/companion-shell';
export { AstrynCompanionEntry } from './presentation/host-entry';
export type { AstrynCompanionEntryProps } from './presentation/host-entry';
export { CompanionSettings } from './presentation/companion-settings';
export type { CompanionSettingsProps } from './presentation/companion-settings';
export { availableModes } from './presentation/mode-registry';
export type { CompanionShellProps } from './presentation/companion-shell';
export { ApprovalCard, AvatarView, ChatLog, Composer, StatusStrip } from './presentation/companion-view';
export type { AvatarViewProps, CompanionViewProps, TranscriptEntry } from './presentation/companion-view';
