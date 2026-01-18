export interface OutcomeSnapshot {
  ts: number;
  readinessPct?: number;
  received?: number;
  missing?: number;
}

export interface OutcomeResult {
  deltaReadiness?: number;
  deltaReceived?: number;
  deltaMissing?: number;
  message: string;
}
