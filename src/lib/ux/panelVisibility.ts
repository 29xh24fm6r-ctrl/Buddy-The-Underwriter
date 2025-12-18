/**
 * Progressive Disclosure - Panel Visibility Rules
 * Automatically collapse "done" panels to reduce cognitive load
 */

export type PanelState = {
  showJobs: boolean;
  showOcrControls: boolean;
  showConditions: boolean;
  showMessages: boolean;
  showForms: boolean;
};

export function computePanelVisibility(signals: any): PanelState {
  const jobsActive =
    (signals.queuedJobs ?? 0) > 0 ||
    (signals.runningJobs ?? 0) > 0 ||
    (signals.failedJobs ?? 0) > 0;
  const needsOcr =
    (signals.eligibleUploads ?? 0) > 0 &&
    (signals.ocrCompletedCount ?? 0) < (signals.eligibleUploads ?? 0);
  const hasConditions = (signals.conditionsOutstanding ?? 0) > 0;
  const hasDraftMessages = (signals.draftMessages ?? 0) > 0;
  const hasForms = (signals.formsReadyToGenerate ?? 0) > 0;

  return {
    showJobs: jobsActive,
    showOcrControls: needsOcr,
    showConditions: true, // always visible; just collapsible
    showMessages: hasDraftMessages,
    showForms: hasForms,
  };
}
