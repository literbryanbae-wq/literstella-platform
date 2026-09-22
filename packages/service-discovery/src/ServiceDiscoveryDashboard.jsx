import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import {
  ArrowUpRight,
  BookOpen,
  Clapperboard,
  Compass,
  Flame,
  GraduationCap,
  Globe,
  Headphones,
  Mail,
  MessageCircle,
  Sparkles,
  PenLine,
  ShoppingBag,
  Star,
  Timer,
} from 'lucide-react';
import './ServiceDiscoveryDashboard.css';

const SCENES = {
  reader: 'classic-c3-episode-listening', challenge: 'hogwarts-h4-reading-stage',
  lecture: 'classes-hero', timer: 'hogwarts-h3-reading-desk',
  lyra: 'classic-c4-saved-next', diagnosis: 'hogwarts-h2-open-letter',
  story: 'stories-hero', diary: 'classic-c1-archive-home',
  sentence: 'classic-c2-series', hpletter: 'hogwarts-h1-sealed-arrival',
};

// Keep focal points with the shared scene contract, not host-specific CSS.
const SCENE_POSITIONS = {
  reader: '100% center', challenge: '100% center',
  lecture: '100% center', timer: '84% center',
  lyra: '100% center', diagnosis: '100% center',
  story: '88% center', diary: '100% center',
  sentence: '100% center', hpletter: '75% center',
};

const SERVICES = [
  { key: 'english-learning', title: '올인원 영어 학습실', prompt: '읽은 영어를 내 말로, 다음 연습을 만나보세요', action: '학습실 먼저 만나보기', href: 'https://english.literstella.co.kr/growth-lab?preview=1&page=invitation', icon: BookOpen, accent: '49 117 97', scene: 'service-english-learning', squareScene: true, badge: 'NEW' },
  {
    key: 'reader',
    title: '원서 리더',
    prompt: '지금 바로 한 장을 읽고 싶다면',
    action: '무료로 읽기',
    href: 'https://challenge.literstella.co.kr/?read=902',
    icon: BookOpen,
    accent: '82 129 102',
  },
  {
    key: 'challenge',
    title: '야나완 챌린지',
    prompt: '혼자 미루기 쉬운 날이라면',
    action: '도전 시작하기',
    href: 'https://challenge.literstella.co.kr/?service=challenge',
    icon: Flame,
    accent: '232 92 61',
  },
  {
    key: 'lecture',
    title: '클래식 원서 강독',
    prompt: '설명과 함께 원문을 깊이 읽고 싶다면',
    action: '강독 둘러보기',
    href: 'https://class-new.literstella.co.kr/classes',
    icon: Headphones,
    accent: '194 147 43',
  },
  {
    key: 'timer',
    badge: 'NEW',
    title: '독서 타이머',
    prompt: '딱 10분, 읽기에 집중하고 싶다면',
    action: '타이머 열기',
    href: 'https://challenge.literstella.co.kr/?tool=timer',
    icon: Timer,
    accent: '82 124 178',
  },
  {
    key: 'lyra',
    title: '리딩메이트 Lyra',
    prompt: '막힌 문장과 다음 행동이 궁금하다면',
    action: 'Lyra에게 묻기',
    href: 'https://challenge.literstella.co.kr/?tool=lyra',
    icon: MessageCircle,
    accent: '141 104 174',
  },
  {
    key: 'diagnosis',
    title: '3분 영어 진단',
    prompt: '내 수준과 맞는 책부터 찾고 싶다면',
    action: '3분 진단하기',
    href: 'https://read.literstella.co.kr/#diagnosis',
    icon: Compass,
    accent: '43 136 137',
  },
  {
    key: 'story',
    title: '스토리극장',
    prompt: '영어 부담 없이 이야기부터 빠지고 싶다면',
    action: '이야기 보러 가기',
    href: 'https://class-new.literstella.co.kr/stories',
    icon: Clapperboard,
    accent: '176 76 99',
  },
  {
    key: 'diary',
    title: '원서 다이어리',
    prompt: '오늘 읽은 마음과 문장을 남기고 싶다면',
    action: '다이어리 쓰기',
    href: 'https://challenge.literstella.co.kr/?mode=diary',
    icon: PenLine,
    accent: '102 116 153',
  },
  {
    key: 'sentence',
    title: '클래식 영어 한 문장',
    prompt: '하루 3분, 명문장 한 편으로 시작하고 싶다면',
    action: '오늘의 문장 듣기',
    href: 'https://challenge.literstella.co.kr/?sentence=archive',
    icon: Mail,
    accent: '167 129 60',
  },
  {
    key: 'hpletter',
    title: '해리포터 호그와트 영어 편지',
    prompt: '마법 편지로 가볍게 시작하고 싶다면',
    action: '편지 받으러 가기',
    href: 'https://challenge.literstella.co.kr/?club=hp',
    icon: Sparkles,
    accent: '122 84 156',
  },
];

// 평가 순위와 별개인 새 입구는 항상 기존 10개 다음에 표시한다.
const ADDITIONAL_SERVICES = [
  {
    key: 'partner',
    badge: 'NEW',
    title: '나도 영어 원서 강독가',
    prompt: '영어 원서 강독가에 도전하고 싶다면',
    action: '강독가 알아보기',
    href: 'https://partner.literstella.co.kr',
    icon: GraduationCap,
    accent: '82 129 102',
    scene: 'service-partner',
    squareScene: true,
    isAdditional: true,
  },
  {
    key: 'goods',
    title: 'Book & Goods',
    prompt: '책과 굿즈를 준비하고 있어요.',
    action: '준비 중',
    icon: ShoppingBag,
    accent: '167 129 60',
    scene: 'service-goods',
    squareScene: true,
    comingSoon: true,
    isAdditional: true,
  },
  {
    key: 'global',
    title: '리터스텔라 글로벌',
    prompt: '세계의 이야기로 언어와 문화를 만나세요',
    action: '글로벌 둘러보기',
    href: 'https://global.literstella.com/',
    icon: Globe,
    accent: '49 117 97',
    scene: 'service-global',
    squareScene: true,
    badge: 'NEW',
    isAdditional: true,
  },
];

const HOST_SERVICE = { read: 'diagnosis', class: 'lecture', challenge: 'challenge', diary: 'diary', english: 'english-learning' };

export function menuServices(app) {
  if (!Object.hasOwn(HOST_SERVICE, app)) throw new Error(`Unknown service menu host: ${app}`);
  return [...SERVICES, ...ADDITIONAL_SERVICES].filter(card => !card.comingSoon && card.key !== HOST_SERVICE[app]);
}

export function ServiceCard({ card, isMostRated = false, loaded = true, compact = false, onTimer, onSelect }) {
  const Icon = card.icon;
  const CardTag = card.comingSoon ? 'article' : card.key === 'timer' ? 'button' : 'a';
  const scene = card.scene || SCENES[card.key];
  const choose = event => {
    if (card.key === 'timer') { onTimer?.(); return; }
    if (!onSelect || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); onSelect(card);
  };
  if (compact) return <CardTag className="ls-service-menu__item" data-service={card.key}
    href={card.key === 'timer' ? undefined : card.href}
    type={card.key === 'timer' ? 'button' : undefined} onClick={choose}
    aria-label={card.key === 'timer' ? '독서 타이머 선택' : card.title}
    aria-haspopup={card.key === 'timer' ? 'dialog' : undefined}
    style={{ '--service-accent': card.accent }}>
    <span className="ls-service-menu__icon" aria-hidden="true"><Icon size={26} strokeWidth={1.75} /></span>
    <span className="ls-service-menu__label">{card.title}</span>
    {card.badge && <span className="ls-service-menu__badge">{card.badge}</span>}
  </CardTag>;
  return <CardTag
    className={`ls-service-discovery__card${isMostRated ? ' is-most-rated' : ''}${card.comingSoon ? ' is-coming-soon' : ''}`}
    data-service={card.key}
    href={card.comingSoon || card.key === 'timer' ? undefined : card.href}
    type={card.key === 'timer' ? 'button' : undefined}
    onClick={card.comingSoon ? undefined : choose}
    aria-label={card.comingSoon ? `${card.title} · 준비 중` : `${card.title} 바로가기${card.badge ? ` · ${card.badge}` : ''}`}
    style={{ '--service-accent': card.accent,
      '--service-scene-size': 'cover',
      '--service-scene-position': SCENE_POSITIONS[card.key] || 'center',
      '--ttg-scene-day': `url("/themes/ttaki-gnyang/scenes/${scene}-day.webp")`,
      '--ttg-scene-night': `url("/themes/ttaki-gnyang/scenes/${scene}-night.webp")`,
    }}>
    <div className="ls-service-discovery__card-top">
      <span className="ls-service-discovery__icon" aria-hidden="true"><Icon size={19} /></span>
      {card.badge && <span className="ls-service-discovery__badge">{card.badge}</span>}
      {!card.comingSoon && <ArrowUpRight className="ls-service-discovery__arrow" size={17} aria-hidden="true" />}
    </div>
    <strong>{card.title}</strong>
    <p>{card.prompt}</p>
    <div className="ls-service-discovery__card-bottom">
      {!card.isAdditional && (card.stats?.count > 0 ?
        <span className="ls-service-discovery__rating"><Star size={12} aria-hidden="true" /> 평균 {card.stats.avg.toFixed(1)} · {card.stats.count.toLocaleString()}개 평가</span> :
        <span className="ls-service-discovery__rating is-pending">{loaded ? '바로 시작할 수 있어요' : '평가 불러오는 중'}</span>)}
      <span className="ls-service-discovery__action">{card.action}</span>
    </div>
    {isMostRated && <span className="ls-service-discovery__most-rated">회원 평가 최다</span>}
  </CardTag>;
}

export function ServiceMenuCards({ app, onSelect, onTimer }) {
  return <nav className="ls-service-menu" aria-label="리터스텔라 대표 서비스">
    <div className="ls-service-menu__grid">{menuServices(app).map(card =>
      <ServiceCard key={card.key} card={card} compact onSelect={onSelect} onTimer={onTimer} />)}
    </div>
  </nav>;
}

function normalizeStats(rows) {
  return new Map((rows || []).map((row) => [String(row.service_key || ''), {
    avg: Number(row.avg_rating) || 0,
    count: Number(row.rating_count) || 0,
  }]));
}

function serviceKeyForSource(value) {
  const source = String(value || '').replace(/\s*만족도\s*$/, '').trim();
  if (source === '원서 리더') return 'reader';
  if (['챌린지 인증', '인증·기록'].includes(source)) return 'challenge';
  if (['스텔라 강독', '강독 복습 퀴즈'].includes(source)) return 'lecture';
  if (['책 속으로 타이머', '독서 타이머'].includes(source)) return 'timer';
  if (['Lyra 대화', '텔라 대화'].includes(source)) return 'lyra';
  if (['진단 결과', 'AI 리포트'].includes(source)) return 'diagnosis';
  if (['스토리 극장', '스토리극장'].includes(source)) return 'story';
  if (['다꾸 카드', '다꾸/사진 스탬프', '필사노트', '기념 카드'].includes(source)) return 'diary';
  if (['클래식 한 문장', '클래식 영어 한 문장'].includes(source)) return 'sentence';
  if (['해리포터 클럽', '호그와트 영어 편지', '해리포터 완독 클럽'].includes(source)) return 'hpletter';
  return null;
}

function aggregateRecent(rows) {
  const grouped = new Map();
  for (const row of rows || []) {
    const key = serviceKeyForSource(row.source);
    const rating = Number(row.rating);
    if (!key || !Number.isFinite(rating) || rating < 0.5 || rating > 5) continue;
    const current = grouped.get(key) || { sum: 0, count: 0 };
    grouped.set(key, { sum: current.sum + rating, count: current.count + 1 });
  }
  return new Map([...grouped].map(([key, value]) => [key, { avg: value.sum / value.count, count: value.count }]));
}

export default function ServiceDiscoveryDashboard({ client, onTimer }) {
  const [chooseTimer, setChooseTimer] = useState(false);
  const timerOptions = useRef(null);
  useEffect(() => {
    if (chooseTimer) {
      timerOptions.current?.scrollIntoView({ block: 'center' });
      timerOptions.current?.querySelector('a')?.focus({ preventScroll: true });
    }
  }, [chooseTimer]);
  const [stats, setStats] = useState(new Map());
  const [loaded, setLoaded] = useState(false);
  const [scope, setScope] = useState('none');

  useEffect(() => {
    if (window.location.hash !== '#service-discovery') return undefined;
    const timer = window.setTimeout(() => document.getElementById('service-discovery')?.scrollIntoView({ block: 'start' }), 80);
    return () => window.clearTimeout(timer);
  }, []);

  const load = useCallback(async () => {
    try {
      if (!client) return;
      const serviceResult = await client.rpc('satisfaction_public_services');
      if (!serviceResult.error && Array.isArray(serviceResult.data) && serviceResult.data.length) {
        setStats(normalizeStats(serviceResult.data));
        setScope('all');
        return;
      }

      const recentResult = await client.rpc('satisfaction_public_recent', { lim: 50 });
      if (!recentResult.error && Array.isArray(recentResult.data)) {
        setStats(aggregateRecent(recentResult.data));
        setScope('recent');
      }
    } catch (_error) {
      // 바로가기는 유지하고 검증되지 않은 인기·평점 표현만 숨긴다.
    } finally {
      setLoaded(true);
    }
  }, [client]);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 86400000); // 하루 1회(운영자 확정 2026-08-05) — 집계는 느리게 변해서 재방문 시 mount 재조회로 충분
    return () => window.clearInterval(timer);
  }, [load]);

  const cards = useMemo(() => SERVICES
    .map((service, originalIndex) => ({ ...service, originalIndex, stats: stats.get(service.key) || null }))
    .sort((a, b) => {
      if (a.key === 'english-learning') return -1;
      if (b.key === 'english-learning') return 1;
      const aRank = a.stats?.count > 0 ? (a.stats.avg >= 4.5 ? 2 : 1) : 0;
      const bRank = b.stats?.count > 0 ? (b.stats.avg >= 4.5 ? 2 : 1) : 0;
      if (aRank !== bRank) return bRank - aRank;
      const countDiff = (b.stats?.count || 0) - (a.stats?.count || 0);
      if (countDiff) return countDiff;
      const avgDiff = (b.stats?.avg || 0) - (a.stats?.avg || 0);
      return avgDiff || a.originalIndex - b.originalIndex;
    }).concat(ADDITIONAL_SERVICES), [stats]);

  const hasServiceStats = cards.some((card) => card.stats?.count > 0);
  const hasHighSatisfaction = cards.some((card) => card.stats?.count > 0 && card.stats.avg >= 4.5);
  const topCount = Math.max(0, ...cards.map((card) => card.stats?.count || 0));

  return (
    <section id="service-discovery" className="ls-service-discovery" aria-labelledby="ls-service-discovery-title">
      <header className="ls-service-discovery__header">
        <div>
          <div className="ls-service-discovery__eyebrow"><span aria-hidden="true" /> 회원 평가 기반 바로가기</div>
          <h2 id="ls-service-discovery-title">
            {hasHighSatisfaction
              ? '먼저 써 본 회원이 높게 평가한 기능이에요'
              : hasServiceStats ? '실제 회원 평가를 보고 필요한 기능을 골라보세요' : '지금 필요한 기능으로 바로 가세요'}
          </h2>
          <p>마음에 닿는 한 가지를 고르면 해당 서비스가 바로 열려요.</p>
        </div>
        <span className="ls-service-discovery__live">{scope === 'recent' ? '최근 공개 평가' : '매일 갱신'}</span>
      </header>

      {chooseTimer && <div ref={timerOptions} className="ls-service-discovery__timer-options" role="group" aria-label="타이머 선택">
        <a href="https://challenge.literstella.co.kr/?tool=timer" target="_blank" rel="noopener noreferrer"><Timer size={20} /> 클래식 타이머</a>
        <a href="https://literstella-reading-timer.pages.dev/" target="_blank" rel="noopener noreferrer"><Sparkles size={20} /> 딱히그냥 타이머</a>
        <button type="button" onClick={() => setChooseTimer(false)} aria-label="타이머 선택 닫기">닫기</button>
      </div>}
      <div className="ls-service-discovery__grid">
        {cards.map(card => <ServiceCard key={card.key} card={card} loaded={loaded}
          isMostRated={!card.isAdditional && hasServiceStats && card.stats?.count === topCount}
          onTimer={onTimer || (() => setChooseTimer(true))} />)}
      </div>

      <p className="ls-service-discovery__note">
        {hasServiceStats
          ? scope === 'recent'
            ? '최근 공개 평가를 서비스별로 모은 실제 집계입니다.'
            : '평균과 평가 수는 로그인 회원이 기능을 이용한 뒤 남긴 공개 집계입니다.'
          : '서비스별 공개 집계가 준비되는 동안 바로가기는 정상 이용할 수 있어요.'}
      </p>
    </section>
  );
}
