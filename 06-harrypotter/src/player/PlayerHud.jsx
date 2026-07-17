// PlayerHud — 재생/건너뛰기/볼륨 조작 시 화면 중앙에 잠깐 뜨는 그래픽(HUD).
//   키보드(스페이스·←→·↑↓)나 터치 제스처로 조절할 때 '무엇이 바뀌었는지' 순간 피드백.
//   VOD(StreamPlayer)·오디오/스토리(PodcastStage) 공용 — 같은 언어로 통일.
//   hud = { node(React 아이콘), label?, bar?(0~1 볼륨바), k(재트리거용 키) } | null
export default function PlayerHud({ hud }) {
  if (!hud) return null;
  return (
    <>
      <style>{'@keyframes lshudpop{0%{opacity:0;transform:translate(-50%,-50%) scale(.8)}16%{opacity:1;transform:translate(-50%,-50%) scale(1)}100%{opacity:0;transform:translate(-50%,-50%) scale(1.06)}}'}</style>
      <div key={hud.k} aria-hidden="true"
        style={{ position: 'absolute', top: '46%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '9px', minWidth: '92px', padding: '16px 20px', borderRadius: '16px', background: 'rgba(6,10,18,0.6)', backdropFilter: 'blur(2px)', color: '#fff', pointerEvents: 'none', animation: 'lshudpop .7s ease forwards' }}>
        <div style={{ display: 'grid', placeItems: 'center', color: '#fff' }}>{hud.node}</div>
        {hud.bar != null && (
          <div style={{ width: '110px', height: '6px', borderRadius: '999px', background: 'rgba(255,255,255,0.26)', overflow: 'hidden' }}>
            <div style={{ width: `${Math.round(Math.max(0, Math.min(1, hud.bar)) * 100)}%`, height: '100%', background: 'var(--ls-gold,#f6c878)' }} />
          </div>
        )}
        {hud.label && <div style={{ fontSize: '13px', fontWeight: 800, letterSpacing: '0.02em', whiteSpace: 'nowrap' }}>{hud.label}</div>}
      </div>
    </>
  );
}
