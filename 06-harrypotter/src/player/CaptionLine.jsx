// CaptionLine — 자막 '고정 크기 + 줄바꿈' 공용 렌더러 (강독 VOD·팟캐스트·스토리 통일).
//   ⚠️ 폰트 크기는 사용자가 고른 값으로 '고정'한다(자동 축소 폐기, 운영자 2026-07-13).
//      이전엔 '무조건 한 줄'로 폰트를 개별 축소 → 자막 길이·언어(한/영/동시)마다 크기가 제멋대로
//      출렁였다. 크기 일관성과 '한 줄 강제'는 원천적으로 상충 → 크기를 고정하고, 길면 줄바꿈한다
//      (유튜브·넷플릭스 방식). 한국어=어절 유지, 영어=단어 단위. 가로 넘침 없음(부모 폭에서 래핑).
//   runs = [{lang, t}] (langRuns 결과). chip=true → 어두운 배경 칩(영상 위, 줄마다 pill), false → 그림자(무대 위).
export default function CaptionLine({ runs, fontSize, chip = false }) {
  return (
    <span style={{
      // inline = 부모(가운데정렬) 폭 안에서 자연 줄바꿈 + 줄마다 배경(box-decoration-break)
      display: 'inline', whiteSpace: 'normal', wordBreak: 'keep-all', overflowWrap: 'break-word',
      fontSize, lineHeight: 1.5,
      ...(chip
        ? { background: 'rgba(8,10,16,.86)', color: '#fff', padding: '2px 9px', borderRadius: '6px', boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone' }
        : { color: '#f4efe6', fontWeight: 600, textShadow: '0 1px 8px rgba(0,0,0,0.75)' }),
    }}>
      {(runs || []).map((r, i) => (
        <span key={i} lang={r.lang} style={r.lang === 'en' ? { fontFamily: 'Georgia, "Times New Roman", serif', fontStyle: 'italic' } : undefined}>{r.t}</span>
      ))}
    </span>
  );
}
