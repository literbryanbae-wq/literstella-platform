// 라이프사이클 메일 발송 멱등 — 순수 헬퍼 (2026-09-08, 운영자 승인 "메일 중복 방지 워커 배포").
//   왜: 발송 근거가 브라우저 localStorage 플래그(mailOnce)라 폰·PC 두 대면 두 번 가고, 발송 실패도 '보냈다'로 굳었다.
//       서버 설정 다리(mail_flags)도 발송자가 근거를 읽지 않는 dual-write 라 폐기(관리자 콘솔 검토 A절).
//   원칙: **발송자(워커)가 원장(lifecycle_mail_sends)을 읽고 쓴다.** 클라이언트 플래그는 호출 절약용일 뿐 근거가 아니다.
//   컷오프: 배포 시점에 '이미 조건이 충족된' 회원×키는 sealed 행으로 봉인돼 다시 나가지 않는다(private.lifecycle_mail_seal_v1).

// 같은 템플릿 키라도 대상이 다르면 다른 메일 — 완독(책)·마일스톤(30/66/100)·라일라 단계(toStage).
export const LIFECYCLE_DISCRIMINATOR = { finish: "book", milestoneReport: "milestone", tellaUpgrade: "toStage" };

// (email, mail_key) 가 원장의 유일 키. 한글 책 제목도 키가 되므로 가-힣 허용, 길이 상한.
export function lifecycleMailKey(key, data) {
  const k = String(key || "").trim();
  const field = LIFECYCLE_DISCRIMINATOR[k];
  if (!field) return k;
  const raw = String((data && data[field]) ?? "").normalize("NFKC").toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return raw ? `${k}:${raw}` : k;
}

export const LIFECYCLE_STALE_MS = 10 * 60 * 1000;   // 'sending' 이 10분 넘게 남으면 죽은 시도로 보고 다시 claim

// 원장 행을 보고 다음 행동을 정한다. 순수 함수라 테스트로 고정한다.
//   send      = 새로 claim 해서 보낸다(행 없음)
//   reclaim   = failed/suppressed/오래된 sending → 조건부 PATCH 로 다시 claim
//   skip      = sent/sealed/진행 중 → 보내지 않는다(reason 반환)
export function lifecycleClaimDecision(row, nowMs) {
  if (!row) return { action: "send" };
  const st = String(row.status || "");
  if (st === "sent" || st === "sealed") return { action: "skip", reason: st };
  if (st === "failed" || st === "suppressed") return { action: "reclaim", from: st };
  if (st === "sending") {
    const t = Date.parse(row.claimed_at || row.updated_at || "");
    if (Number.isFinite(t) && nowMs - t > LIFECYCLE_STALE_MS) return { action: "reclaim", from: "sending" };
    return { action: "skip", reason: "in_progress" };
  }
  return { action: "skip", reason: "unknown_status" };
}
