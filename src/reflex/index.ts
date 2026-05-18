/**
 * repo-arch reflex — runtime guardrails for coding agent sessions.
 *
 * Build order (from reflex PRD):
 *  1. classify-command  — Allow / ask / block shell commands
 *  2. classify-edit    — Detect risky file edits
 *  3. test-plan         — Recommend tests/checks
 *  4. install-pi        — Pi auto-mode pre-action hook
 *  5. events            — Append-only event log
 *  6. dataset           — Export training data
 *  7. train             — Teacher → student classifier
 *  8. session ingest    — Learn from Pi session failures
 */

export { classifyCommand, type CommandDecision, type RiskLevel, RISK_ALLOW, RISK_ASK, RISK_BLOCK } from './classify-command.js';
export { classifyEdit, type EditDecision, type FragileSignal } from './classify-edit.js';
export { generateTestPlan, type TestPlan, type RecommendedTest } from './test-plan.js';
export { installPiHook, type PiHookResult, type PiHookDecision } from './install-pi.js';
export { logEvent, loadEvents, type ReflexEvent, type EventKind, type EventMeta } from './events.js';
export { buildDataset, type DatasetEntry, type DatasetConfig } from './dataset.js';
export { trainReflex, type TrainConfig, type TrainResult } from './train.js';
export { ingestSession, type IngestResult } from './session-ingest.js';