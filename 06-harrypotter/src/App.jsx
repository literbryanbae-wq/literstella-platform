// 해리포터 완독 클럽 — 독립 React 공간(챌린지앱과 완전 분리).
//   진단앱 HP 루트에서 진입. 무료 교육 콘텐츠(강독 유튜브·한 문장·워크북·오디오·삽화).
//   저작권: 본문0%. 영어=one_sentence 1문장 + 워크북 단어(헤드워드)만. noindex(저노출).
//   디자인=SentenceArchive 패턴을 HP 완독클럽 테마로 재구현(홈 서재 → Day 회차).
import { useEffect, useState } from 'react'
import { BookOpen, GraduationCap, ChevronRight, ArrowLeft, Headphones, Sparkles, Play } from 'lucide-react'
import PodcastStage from './player/PodcastStage'
import { audio, useAudio } from './player/audioPlayer'
import { loadCaptions } from './player/captions'
import A11yGuideChip, { SrIntro, a11ySrText } from './components/A11yGuideChip'

// 접근 안내 칩 — HP 버건디 양피지 테마 오버라이드(이 앱엔 --ls-* 토큰이 없어 colors로 넘긴다)
const A11Y_COLORS = { text: '#f3e6c9', muted: '#c4ab80', surface: 'rgba(0,0,0,0.22)', line: 'rgba(243,230,201,0.22)' }

const CLASS_URL = 'https://class.literstella.co.kr/p/new-9'
const CLUB_URL = 'https://cafe.naver.com/literenglish'
const cleanPages = (p) => String(p || '').replace(/^p\.?/i, 'p.').replace(/^p\.p\./, 'p.')

function useHashDay() {
  const read = () => { try { const d = new URLSearchParams(location.search).get('day'); return d ? Number(d) : null } catch { return null } }
  const [day, setDay] = useState(read)
  const go = (d) => {
    const u = new URL(location.href)
    if (d) u.searchParams.set('day', d); else u.searchParams.delete('day')
    history.pushState({ d }, '', u); setDay(d)
  }
  useEffect(() => { const on = () => setDay(read()); window.addEventListener('popstate', on); return () => window.removeEventListener('popstate', on) }, [])
  return [day, go]
}

function Home({ index, onOpen }) {
  return (
    <div className="wrap">
      <div className="hero">
        <div className="crest">🪄</div>
        <div className="kicker">Liter Stella · 완독 클럽</div>
        <h1 className="cinzel">해리포터 완독 클럽</h1>
        <p>하루 3쪽, 스텔라와 함께 원서를 끝까지. 강독 영상·오늘의 한 문장·워크북 단어·낭독 오디오를 하루치씩 모아, 100일이면 1권을 완독합니다.</p>
        <div className="rule" />
        <p style={{ fontSize: '12.5px', color: '#c9b795' }}>{index ? `${index.bookEn} · ${index.days.length}일 공개 중` : ' '}</p>
        {/* 이 앱엔 헤더·도크가 없어 첫 화면에서도 안내를 찾을 수 있게 둔다(Day 화면에도 있음) */}
        <A11yGuideChip preset="hp" style={{ marginTop: '14px' }} colors={A11Y_COLORS} />
      </div>
      {!index ? <div style={{ textAlign: 'center', color: '#c9b795', padding: '40px' }}>클럽을 여는 중…</div> : (
        <div className="grid">
          {index.days.map(d => (
            <button key={d.day} className="daycard" onClick={() => onOpen(d.day)} aria-label={`Day ${d.day} 열기`}>
              <img className="thumb" src={d.illustration} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
              {d.hasAudio && <span className="badge">🎧 오디오</span>}
              <div className="meta">
                <div className="dno cinzel">DAY {String(d.day).padStart(2, '0')} · {cleanPages(d.pages)}</div>
                <div className="sent">“{d.sentenceEn}”</div>
              </div>
            </button>
          ))}
        </div>
      )}
      <div className="foot">© Liter Stella · 해리포터 완독 클럽<br />본 자료는 스텔라의 원서 강독과 완독 워크북을 기반으로 한 비영리 교육 목적 콘텐츠입니다.</div>
    </div>
  )
}

function DayView({ day, onBack, onOpen, total }) {
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  const [caps, setCaps] = useState(null) // 싱크 자막(전사) — 없는 Day는 자막 UI 숨김
  const aState = useAudio()
  useEffect(() => { let a = true; setD(null); setErr('')
    fetch(`/hp1/day-${day}.json`).then(r => r.ok ? r.json() : Promise.reject()).then(j => a && setD(j)).catch(() => a && setErr('불러오지 못했어요.'))
    window.scrollTo(0, 0); return () => { a = false } }, [day])
  useEffect(() => { let a = true; setCaps(null)
    loadCaptions(`/hp1/day-${day}`).then(c => { if (a) setCaps(c) })
    return () => { a = false } }, [day])

  // 낭독 오디오 = 스텔라 플레이어(챌린지 앱과 동일 스택 이식 — 키보드·HUD·더블탭·맥스마이즈·PiP·접근성 통일).
  //   이 앱엔 도크(이어듣기 필)가 없어 Day 화면을 떠나면 정지(유령 재생 방지).
  useEffect(() => {
    if (!d?.audioUrl) return undefined
    audio.load({ src: d.audioUrl, key: `hp-${d.day}`, title: `Day ${String(d.day).padStart(2, '0')} · ${d.chapterKo}`, subtitle: 'Stella AI 낭독', book: d.chapterKo })
    return undefined
  }, [d])
  useEffect(() => () => { audio.stop() }, [])

  if (err) return <div className="wrap"><button className="back" onClick={onBack}><ArrowLeft size={17} /> 클럽으로</button><p className="p">{err}</p></div>
  if (!d) return <div className="wrap"><div style={{ color: '#c9b795', padding: '40px', textAlign: 'center' }}>여는 중…</div></div>

  return (
    <div className="wrap">
      {/* 낭독기 전용 인트로 — Day 진입 직후 읽힘(화면낭독기 사용은 감지 불가 → 낭독 순서에 심는다) */}
      <SrIntro text={a11ySrText('hp')} />
      <button className="back" onClick={onBack}><ArrowLeft size={17} /> 완독 클럽으로</button>
      <div style={{ marginTop: '6px' }}>
        <div className="kicker">Chapter {d.chapterNo} · {cleanPages(d.pages)}</div>
        <h1 className="cinzel" style={{ fontSize: 'clamp(20px,5vw,28px)', color: 'var(--gold-bright)', margin: '6px 0 2px' }}>Day {String(d.day).padStart(2, '0')}</h1>
        <div style={{ color: '#d8c7a6', fontSize: '13.5px' }}>{d.chapterKo}</div>
      </div>

      {/* 무대 — 스텔라 플레이어(챌린지와 통일): 삽화 배경 + 키보드·HUD·더블탭 ±10초·가장자리 탭/화살표=이전·다음 Day·맥스마이즈·PiP */}
      {d.audioUrl ? (
        <div style={{ marginTop: '16px' }}>
          <PodcastStage hero={d.illustration} title={`Day ${String(d.day).padStart(2, '0')} · ${d.chapterKo}`} subtitle="Stella AI 낭독"
            transcript={caps} currentTime={aState.cur}
            onPrevEp={d.day > 1 ? () => onOpen(d.day - 1) : undefined}
            onNextEp={total && d.day < total ? () => onOpen(d.day + 1) : undefined}
            epNoun="Day" />
        </div>
      ) : (
        <>
          <div className="stage" style={{ marginTop: '16px' }}>
            <img src={d.illustration} alt={d.chapterKo} loading="lazy" />
            <div className="ov"><span className="chip"><Sparkles size={13} /> Stella AI 낭독</span></div>
          </div>
          <div style={{ marginTop: '10px', textAlign: 'center', color: '#c9b795', fontSize: '13px', border: '1px dashed rgba(200,157,62,.4)', borderRadius: '12px', padding: '14px' }}><Headphones size={14} /> 낭독 오디오 준비 중</div>
        </>
      )}

      <p className="p" style={{ marginTop: '18px', color: '#efe6d4' }}>{d.intro}</p>

      {d.youtubeId && (
        <section className="sect">
          <h3 className="cinzel">오늘의 강독 · 유튜브 무료</h3>
          <div className="ytwrap"><iframe src={`https://www.youtube-nocookie.com/embed/${d.youtubeId}`} title="강독" allow="accelerometer;encrypted-media;picture-in-picture" allowFullScreen /></div>
        </section>
      )}

      <section className="sect">
        <h3 className="cinzel">오늘의 스토리</h3>
        {d.scenes.map(s => (
          <div key={s.no} className="scene">
            <h4>Scene {s.no} · {s.title}</h4>
            <p className="p">{s.body}</p>
            {s.after && <p className="p">{s.after}</p>}
          </div>
        ))}
      </section>

      <div className="onecard">
        <div className="kicker" style={{ marginBottom: '10px' }}>오늘의 한 문장</div>
        <div className="en">“{d.sentenceEn}”</div>
        <div className="div" />
        <div className="ko">{d.sentenceKo}</div>
        <div className="src">— {d.source}</div>
      </div>

      {d.reading?.length > 0 && (
        <section className="sect">
          <h3 className="cinzel">스텔라의 문장 읽기</h3>
          {d.reading.map((p, i) => <p key={i} className="p">{p}</p>)}
          {d.pullquote && <div className="pull">{d.pullquote}</div>}
        </section>
      )}

      {d.essay?.length > 0 && (
        <section className="sect">
          <h3 className="cinzel">1분 에세이</h3>
          <div className="essaybox">{d.essay.map((p, i) => <p key={i} className="p" style={{ color: '#e0d4bd' }}>{p}</p>)}</div>
        </section>
      )}

      {d.vocab?.length > 0 && (
        <section className="sect">
          <h3 className="cinzel">📖 워크북 단어 · 표현</h3>
          <div className="vgrid">
            {d.vocab.map((v, i) => (
              <div key={i} className="vcard">
                <div className="vh"><span className="w">{v.w}</span>{v.pos && <span className="pos">{v.pos}</span>}</div>
                <div className="vko">{v.ko}</div>
                {v.note && <div className="vnote">{v.note}</div>}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 사다리 */}
      <div style={{ marginTop: '26px', display: 'grid', gap: '10px' }}>
        <a className="cta gold" href={d.youtubeId ? `https://youtu.be/${d.youtubeId}` : CLUB_URL} target="_blank" rel="noopener noreferrer"><Play size={17} /> 유튜브에서 강독 전체 보기</a>
        <a className="cta ghost" href={CLASS_URL} target="_blank" rel="noopener noreferrer"><GraduationCap size={17} /> 스텔라와 한 문장씩 깊이 — 완독 클럽 안내 →</a>
      </div>

      {/* 접근 안내 칩 — 스텔라 녹음(R2 a11y/hp.mp3) 재생 + 실패 시 브라우저 음성 폴백 */}
      <A11yGuideChip preset="hp" style={{ marginTop: '16px' }} colors={A11Y_COLORS} />

      {d.teaser && <div className="teaser"><b className="gold cinzel">DAY {String(d.teaser.day).padStart(2, '0')}</b><br />{d.teaser.text}</div>}

      {day < total && <button className="cta ghost" style={{ marginTop: '18px' }} onClick={() => onOpen(day + 1)}>다음 날 <ChevronRight size={16} /></button>}
    </div>
  )
}

export default function App() {
  const [index, setIndex] = useState(null)
  const [day, go] = useHashDay()
  useEffect(() => { fetch('/hp1/index.json').then(r => r.json()).then(setIndex).catch(() => {}) }, [])
  const total = index?.days?.length || 0
  if (day && index?.days?.some(x => x.day === day)) return <DayView day={day} total={total} onBack={() => go(null)} onOpen={go} />
  return <Home index={index} onOpen={go} />
}
