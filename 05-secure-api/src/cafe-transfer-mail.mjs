export function cafeMailResult({ providerResult, suppressed = false }) {
  if (suppressed) return { ok: false, status: "suppressed", id: null, error: "recipient_suppressed" };
  if (typeof providerResult === "string" && providerResult) {
    return { ok: true, status: "sent", id: providerResult, error: null };
  }
  if (providerResult) return { ok: true, status: "sent", id: null, error: null };
  return { ok: false, status: "failed", id: null, error: "send_failed" };
}

export function cafeDecisionEmailPatch({ kind, result, attemptedAt, previousAttempts = 0 }) {
  const patch = {
    decision_email_kind: kind,
    decision_email_status: result.status,
    decision_email_id: result.id || null,
    decision_email_error: result.error || null,
    decision_email_attempted_at: attemptedAt,
    decision_email_attempts: Math.max(0, Number(previousAttempts) || 0) + 1,
  };
  if (kind === "approved" && result.ok && result.id) patch.approved_email_id = result.id;
  return patch;
}
