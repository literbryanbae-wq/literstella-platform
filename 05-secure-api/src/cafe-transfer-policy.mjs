export function normalizeCafeText(value) {
  return String(value || "").normalize("NFKC").trim().toLowerCase();
}

export function evaluateCafeRoster({ rows, campaign, cafeNickname, naverId }) {
  const normalizedNickname = normalizeCafeText(cafeNickname);
  const normalizedNaverId = normalizeCafeText(naverId);
  const candidates = (Array.isArray(rows) ? rows : []).map((row) => ({
    nicknameNorm: normalizeCafeText(row?.nickname_norm),
    idPrefix: normalizeCafeText(row?.id_prefix),
  })).filter((row) => row.nicknameNorm && row.idPrefix);

  const idHits = candidates.filter((row) => normalizedNaverId.startsWith(row.idPrefix));
  const exactHits = idHits.filter((row) => row.nicknameNorm === normalizedNickname);

  let rosterMatch = "none";
  if (idHits.length > 1) rosterMatch = "ambiguous";
  else if (idHits.length === 1) {
    const only = idHits[0];
    if (only.nicknameNorm === normalizedNickname) rosterMatch = "exact";
    else rosterMatch = only.idPrefix.length >= 4 ? "id_unique" : "id_short";
  } else if (candidates.some((row) => row.nicknameNorm === normalizedNickname)) {
    rosterMatch = "nickname_only";
  }

  // 자동 승인은 캠페인 안에서 ID 접두부 후보가 하나뿐이고 4자 이상일 때만 허용한다.
  const autoCandidate = idHits.length === 1 && idHits[0].idPrefix.length >= 4 ? idHits[0] : null;
  // 수동 승인도 식별 가능한 명단 행을 소진한다. 후보 중복이면 별명까지 유일하게 맞을 때만 식별한다.
  const manualCandidate = idHits.length === 1
    ? idHits[0]
    : (exactHits.length === 1 ? exactHits[0] : null);

  return {
    rosterMatch,
    autoOk: Boolean(autoCandidate),
    rosterKey: manualCandidate ? `${campaign}:${manualCandidate.nicknameNorm}` : null,
  };
}

export function cafeRosterMatchLabel(match) {
  return ({
    exact: "별명·ID 일치 ✅",
    id_unique: "ID 단일 일치 ✅",
    id_short: "ID 앞자리 짧음 · 수동 확인",
    ambiguous: "ID 후보 중복 · 수동 확인",
    nickname_only: "별명만 일치 · 수동 확인",
    none: "명단 미일치 · 수동 확인",
  })[match] || "명단 미일치 · 수동 확인";
}
