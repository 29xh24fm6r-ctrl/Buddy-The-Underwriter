import { mapAnswersToSbaIntakeV1 } from "./mapFromAnswers";
import { validateSbaIntakeV1 } from "./validate";

export function buildSbaFormPayloadFromAnswers(input: { answers: Record<string, any> }) {
  const payload = mapAnswersToSbaIntakeV1(input.answers);
  const validation_errors = validateSbaIntakeV1(payload);

  const status =
    validation_errors.some((e) => e.severity === "ERROR") ? "ERROR" : "READY";

  return { payload, validation_errors, status };
}
