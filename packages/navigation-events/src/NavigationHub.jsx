import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, ArrowUpRight, ChevronRight, Gift, LayoutGrid, Menu, MessageCircle, Monitor, Moon, Sun, Timer, X } from 'lucide-react';
import { APP_NAMES, APP_HOME, EVENTS, KAKAO_URL, eventEnded, eventPath, eventRoute, safeReturn, eventOrigin, savedEventContext } from './catalog.mjs';
import { ServiceMenuCards } from '../service-discovery/ServiceDiscoveryDashboard.jsx';
import './navigation.css';

const dispatch = (type, detail) => window.dispatchEvent(new CustomEvent(type, { detail }));

// 와이드 플로팅 '전체 메뉴' — 드래그로 치울 수 있다(운영자 2026-09-16: 라일라·다른 메뉴와 겹친다).
//   🔴 버튼 자체가 드래그 대상이라 **클릭과 구분**해야 한다 — 4px 문턱을 넘어야 이동으로 본다.
//      문턱이 없으면 손이 미세하게 떨려도 메뉴가 안 열려 '고장난 버튼'이 된다.
//   🔴 저장은 우/상단 오프셋(px) — 가장자 기준이라 창 크기가 바뀜도 매달린 모서리를 유지한다.
//      불러올 때와 리사이즈 때 **다시 클램한다** — 안 하면 작은 화면에서 버튼이 화면 밖으로 나가 영영 못 누른다.
//   ⚠️ body 포털 + 같은 class/마크업을 유지한다 — 영어앱이 `body > button.lsne-desktop-services` 로
//      z-index 12002 를 덮어쓴다(fixed 표면 위로 올리기). 요소 종류나 포털 대상을 바꾸면 그게 깨진다.
const LAUNCHER_POS_KEY = 'ls_nav_launcher_pos'; // { r, t } = 우/상단 오프셋 px
const readLauncherPos = () => { try { const v = JSON.parse(localStorage.getItem(LAUNCHER_POS_KEY) || 'null'); return (v && Number.isFinite(v.r) && Number.isFinite(v.t)) ? v : null; } catch (_e) { return null; } };
// 🔴 버튼 **자기 크기**를 빼야 화면 안에 남는다. 고정값(120/56)으로 두면 저장값이 클 때
//    왼쪽·아래로 밀려 나가 눈에만 보이고 못 누른다(2026-09-16 실측으로 잡음).
//    px 은 반올림한다 — 소수점 좌표는 버튼 글자를 번지게 한다.
const clampLauncher = (r, t, el) => {
  const box = el ? el.getBoundingClientRect() : null;
  // 🔴 눈에 보이는 너비로 재면 **순환**이 된다 — 밀려난 버튼은 이미 좌방해 있어(83px)
  //    그 값으로 클램하면 '맞다'고 판정해 그대로 둔다(2026-09-16 실측: left -6 재현).
  //    scrollWidth 는 내용 너비라 눌려도 줄지 않는다 — 둘 중 큰 것을 쓴다.
  const w = Math.max((box && box.width) || 0, (el && el.scrollWidth) || 0, 130);
  const h = Math.max((box && box.height) || 0, (el && el.scrollHeight) || 0, 48);
  // 🔴 innerWidth 가 아니라 clientWidth 다. innerWidth 는 **스크롤바를 포함**하고
  //    CSS `right` 는 콘텐츠 가장자리 기준이라 그대로 섞으면 스크롤바 폭만큼(≈10px)
  //    왼쪽으로 샐다(2026-09-16 실측: left -6). **재는 공간과 적용하는 공간을 같게 둔다.**
  const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
  return {
    r: Math.round(Math.max(4, Math.min(Math.max(4, vw - w - 4), r))),
    t: Math.round(Math.max(4, Math.min(Math.max(4, vh - h - 4), t))),
  };
};

function DesktopServicesLauncher({ dark, onOpen }) {
  const ref = useRef(null);
  const moved = useRef(false);
  const [pos, setPos] = useState(readLauncherPos);
  // 🔴 화살표 연타는 한 번에 여러 건이 들어온다 — 매번 state 를 읽으면 **전부 같은 낡은 값**에서
  //    계산해 마지막 하나만 반영된다(2026-09-16 실측: ↑↑→ 중 → 만 먹힘). ref 로 최신값을 들고 다닌다.
  const posRef = useRef(pos);
  const apply = (next, persist) => {
    posRef.current = next;
    setPos(next);
    if (!persist) return;
    try {
      if (next) localStorage.setItem(LAUNCHER_POS_KEY, JSON.stringify(next));
      else localStorage.removeItem(LAUNCHER_POS_KEY);
    } catch (_e) { /* noop */ }
  };

  // 창이 작아지면 저장된 자리가 화면 밖일 수 있다 — 다시 안으로 끌어온다.
  useEffect(() => {
    if (!pos) return undefined;
    const fit = () => {
      const p = posRef.current;
      if (!p) return;
      const next = clampLauncher(p.r, p.t, ref.current);
      // 고친 값은 저장에도 되돌려 쓴다 — 안 그러면 다음 번에 또 화면 밖 값을 읽는다.
      if (next.r !== p.r || next.t !== p.t) apply(next, true);
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [pos && pos.r, pos && pos.t]);

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    const el = ref.current; if (!el) return;
    const box = el.getBoundingClientRect();
    const r0 = document.documentElement.clientWidth - box.right, t0 = box.top;
    const sx = e.clientX, sy = e.clientY;
    moved.current = false;
    let cur = { r: r0, t: t0 };
    const move = (ev) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (!moved.current && Math.abs(dx) + Math.abs(dy) < 4) return; // 문턱 — 클릭을 죽이지 않는다
      moved.current = true;
      cur = clampLauncher(r0 - dx, t0 + dy, el);
      apply(cur, false);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved.current) apply(cur, true);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onClick = () => { if (moved.current) { moved.current = false; return; } onOpen(); };

  // 키보드 — 화살표 12px 씩, Home 으로 기본 자리 복귀(더블클릭은 클릭 2번과 언거서 안 쓴다).
  const onKeyDown = (e) => {
    if (e.key === 'Home') {
      e.preventDefault(); apply(null, true);
      return;
    }
    const step = { ArrowLeft: [12, 0], ArrowRight: [-12, 0], ArrowUp: [0, -12], ArrowDown: [0, 12] }[e.key];
    if (!step) return;
    e.preventDefault();
    const el = ref.current; if (!el) return;
    const box = el.getBoundingClientRect();
    const base = posRef.current || { r: document.documentElement.clientWidth - box.right, t: box.top };
    apply(clampLauncher(base.r + step[0], base.t + step[1], el), true);
  };

  return <button ref={ref} type="button" className="lsne-desktop-services" data-theme={dark ? 'dark' : 'light'}
    style={pos ? { right: `${pos.r}px`, top: `${pos.t}px` } : undefined}
    onPointerDown={onPointerDown} onClick={onClick} onKeyDown={onKeyDown}
    aria-haspopup="dialog" aria-label="전체 메뉴: 다른 앱으로 이동. 끌어서 자리를 옮길 수 있습니다"
    title="전체 메뉴 — 끌어서 자리 이동 · Home 키로 제자리">
    <LayoutGrid size={22} aria-hidden="true" /><span>전체 메뉴</span>
  </button>;
}
export const openMenu = () => dispatch('ls:menu');
export const openServiceMenu = () => dispatch('ls:services');
export const openEvents = (slug = '') => dispatch('ls:events', { slug });
export const openHighlights = () => dispatch('ls:highlights');
export function NavigationButtons({ compact = false, eventsOnly = false }) {
  return <div className={`lsne-buttons${compact ? ' is-compact' : ''}`}>
    <button type="button" onClick={() => openEvents()} aria-label="이벤트 전체보기" title="이벤트"><Gift size={20} /><span>이벤트</span><i aria-hidden="true" /></button>
    {!eventsOnly && <button type="button" onClick={openMenu} aria-label="앱 메뉴 열기" aria-haspopup="dialog" title="앱 메뉴"><Menu size={21} /><span>앱 메뉴</span></button>}
  </div>;
}
function Art({ event }) {
  return <picture className="lsne-art" style={{ '--lsne-focal': event.focal }}>
    <img src={`/navigation-events/${event.art}-day.webp`} alt="" loading="lazy" width="300" height="200" />
  </picture>;
}
export function EventHighlights({ onSelect = openEvents }) {
  return <div className="lsne-highlights">{EVENTS.map(event => <button type="button" key={event.id} onClick={() => onSelect(event.id)}>
    <Art event={event} /><span><strong>{event.title}</strong><small>{event.summary}</small><b>{eventEnded(event) ? '종료 안내' : event.timer ? '타이머 열기' : '자세히 보기'} <ArrowRight size={15} /></b></span>
  </button>)}</div>;
}
function useAppearance() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const update = () => setDark(document.body.matches('.dark-mode,.dark-theme') || document.documentElement.dataset.learningTheme === 'dark');
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-learning-theme'] });
    return () => observer.disconnect();
  }, []);
  return dark;
}
const layers = [];
const inertBefore = new Map();
let overflowBefore = '';
function protectLayers() {
  const top = layers.at(-1);
  for (const node of document.body.children) {
    if (['SCRIPT','STYLE','LINK'].includes(node.tagName)) continue;
    if (!inertBefore.has(node)) inertBefore.set(node, node.inert);
    node.inert = top ? !node.contains(top) : inertBefore.get(node);
  }
  if (!top) { inertBefore.forEach((was, node) => { node.inert = was; }); inertBefore.clear(); }
}
function FocusLayer({ children, onClose, page = false, dark, title, scrollKey = '' }) {
  const ref = useRef(null);
  const outer = useRef(null);
  const positions = useRef(new Map());
  useLayoutEffect(() => { if (page && outer.current) outer.current.scrollTop = positions.current.get(scrollKey) || 0; }, [page, scrollKey]);
  const saved = useRef(onClose); saved.current = onClose;
  useEffect(() => {
    const prior = document.activeElement;
    const layer = ref.current;
    if (!layers.length) overflowBefore = document.body.style.overflow;
    layers.push(layer);
    document.body.style.overflow = 'hidden';
    protectLayers();
    const observer = new MutationObserver(protectLayers); observer.observe(document.body, { childList: true });
    ref.current?.querySelector('button,a[href]')?.focus({ preventScroll: true });
    const key = event => {
      if (event.isComposing || layers.at(-1) !== layer) return;
      if (event.key === 'Escape' && !page) { event.preventDefault(); event.stopImmediatePropagation(); saved.current?.(); }
      if (event.key !== 'Tab' || !ref.current?.contains(document.activeElement)) return;
      const controls = [...ref.current.querySelectorAll('button,a[href],input,summary,[tabindex="0"]')].filter(node => !node.disabled && node.getClientRects().length);
      if (!controls.length) return;
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1).focus(); }
      else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0].focus(); }
    };
    document.addEventListener('keydown', key, true);
    return () => {
      observer.disconnect(); document.removeEventListener('keydown', key, true);
      const index = layers.indexOf(layer);
      if (index >= 0) layers.splice(index, 1);
      protectLayers();
      if (!layers.length) document.body.style.overflow = overflowBefore;
      if (prior?.isConnected && !prior.closest('[inert]')) prior.focus?.({ preventScroll: true });
    };
  }, [page]);
  return createPortal(<div ref={outer} onScroll={e => { if (page) positions.current.set(scrollKey,e.currentTarget.scrollTop); }} data-lsne-layer data-theme={dark ? 'dark' : 'light'} className={`lsne-layer ${page ? 'lsne-page' : 'lsne-modal'}`} onClick={e => { if (!page && e.target === e.currentTarget) onClose?.(); }}>
    <section ref={ref} className="lsne-surface" role={page ? 'region' : 'dialog'} aria-modal={page ? undefined : true} aria-label={title}>{children}</section>
  </div>, document.body);
}
function LinkRow({ item, onSelect, Icon = ChevronRight }) {
  return <button type="button" className="lsne-row" onClick={() => onSelect(item)}><span>{item.label}</span><Icon size={17} aria-hidden="true" /></button>;
}
export default function NavigationHub({ app = 'class', sections = [], onAction, navigate, locationKey, appearance }) {
  const [modal, setModal] = useState('');
  const [route, setRoute] = useState(() => eventRoute(window.location.pathname));
  const [filter, setFilter] = useState('active');
  const dark = useAppearance();
  const callbacks = useRef({ onAction, navigate, sections, app }); callbacks.current = { onAction, navigate, sections, app };
  const returnTo = useRef(savedEventContext(window.history.state).path || APP_HOME[app] || '/');
  const modalRef = useRef('');
  const afterClose = useRef(null);
  const showModal = value => {
    if (!modalRef.current) window.history.pushState({ ...window.history.state, lsneModal: true }, '');
    modalRef.current = value; setModal(value);
  };
  const closeModal = after => {
    if (modalRef.current && window.history.state?.lsneModal) {
      afterClose.current = after || null;
      window.history.back();
    } else { modalRef.current = ''; setModal(''); after?.(); }
  };
  const go = path => {
    const state = eventRoute(new URL(path,window.location.origin).pathname) ? {lsneReturn:returnTo.current,lsneApp:callbacks.current.app} : {};
    if (callbacks.current.navigate) callbacks.current.navigate(path, {state});
    else { window.history.pushState(state, '', path); window.dispatchEvent(new PopStateEvent('popstate')); }
    setRoute(eventRoute(new URL(path, window.location.origin).pathname));
  };
  const showEvents = slug => {
    if (!eventRoute(window.location.pathname)) returnTo.current = eventOrigin(window.location.pathname + window.location.search + window.location.hash, callbacks.current.app);
    closeModal(() => go(eventPath(slug)));
  };
  useEffect(() => {
    const menu = () => showModal('menu');
    const services = () => showModal('services');
    const events = e => showEvents(typeof e.detail?.slug === 'string' ? e.detail.slug : '');
    const highlights = () => showModal('highlights');
    const pop = () => {
      modalRef.current = ''; setModal(''); setRoute(eventRoute(window.location.pathname));
      const next = afterClose.current; afterClose.current = null;
      if (next) setTimeout(next, 0);
    };
    window.addEventListener('ls:menu', menu); window.addEventListener('ls:services', services); window.addEventListener('ls:events', events); window.addEventListener('ls:highlights', highlights); window.addEventListener('popstate', pop);
    return () => { window.removeEventListener('ls:menu', menu); window.removeEventListener('ls:services', services); window.removeEventListener('ls:events', events); window.removeEventListener('ls:highlights', highlights); window.removeEventListener('popstate', pop); };
  }, []);
  useEffect(() => { setRoute(eventRoute(window.location.pathname)); }, [locationKey]);
  // Adapter actions own login, mode switching and existing in-app tools.
  const select = item => {
    if (item.action === 'appearance' && appearance) { showModal('appearance'); return; }
    closeModal(() => {
      if ((item.run || item.action) && eventRoute(window.location.pathname)) go(safeReturn(returnTo.current, APP_HOME[callbacks.current.app]));
      setTimeout(() => {
      if (item.run) { item.run(); return; }
      if (item.action) { callbacks.current.onAction?.(item.action); return; }
      if (item.href) {
        const target = new URL(item.href, window.location.origin);
        if (!['http:', 'https:'].includes(target.protocol)) return;
        // 🔴 같은 앱이라도 **쿼리·해시가 붙은 딥링크는 전체 이동**으로 보낸다.
        //    go() 는 라우터 이동이라 주소만 바뀌고, 마운트 때 한 번만 도는 딥링크 effect
        //    (?read= · ?tool= · ?mode= · ?sentence=)가 다시 깨어나지 않는다.
        //    2026-09-19 챌린지 라이브 실측: 자기 앱 쿼리 카드 5개 중 **4개가 주소만 바뀐 채
        //    아무것도 안 열렸다**(?club=hp 만 살아 있었다 — 그쪽은 주소 변화를 구독한다).
        //    경로만 다른 카드(/classes · /stories · /)는 라우터가 제대로 처리하므로 그대로 둔다.
        if (target.origin === window.location.origin && !target.search && !target.hash) go(target.pathname);
        else window.location.assign(target.href);
      }
      }, 0);
    });
  };
  const openTimer = classic => {
    closeModal(() => {
      if (eventRoute(window.location.pathname)) go(safeReturn(returnTo.current, APP_HOME[callbacks.current.app]));
      setTimeout(() => {
      if (callbacks.current.onAction) callbacks.current.onAction(classic ? 'timer-classic' : 'timer-character');
      else window.location.assign(classic ? 'https://challenge.literstella.co.kr/?tool=timer' : 'https://literstella-reading-timer.pages.dev/');
      }, 100);
    });
  };
  const localGroups = sections.filter(s => !['account','support','account-support'].includes(s.id));
  const supportGroups = sections.filter(s => ['account','support','account-support'].includes(s.id));
  const event = EVENTS.find(e => e.id === route?.id);
  const modalTitle = {menu:`${APP_NAMES[app]} 메뉴`,services:'전체 메뉴',timer:'독서 타이머',appearance:'화면 설정',highlights:'리터스텔라 이벤트'}[modal];
  const page = route && <FocusLayer page dark={dark} title="리터스텔라 이벤트" scrollKey={`${route.id || 'list'}:${filter}`}>
    <header className="lsne-page-header"><button className="lsne-brand" onClick={() => go(APP_HOME[app] || '/')} aria-label={`${APP_NAMES[app]} 홈`}><img src="/brand/shared/logo-symbol.png" alt="" /><img className="lsne-wordmark" src="/navigation-events/logo-literstella-en.png" alt="Liter Stella" /></button><NavigationButtons /></header>
    <main className="lsne-main" key={route.id || 'list'}>
      <button className="lsne-back" onClick={() => route.id ? go('/events') : go(safeReturn(returnTo.current, APP_HOME[app]))}><ArrowLeft size={18} />{route.id ? '이벤트 목록' : APP_NAMES[app]}</button>
      {!route.id ? <>
        <div className="lsne-title"><h1>이벤트</h1><span>{APP_NAMES[app]}</span></div>
        <div className="lsne-filters" role="group" aria-label="이벤트 상태">{[['active','진행 안내'],['ended','종료']].map(([id,label]) => <button type="button" key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}</div>
        <div className="lsne-event-list">{EVENTS.filter(e => eventEnded(e) === (filter === 'ended')).map(e => <button type="button" className="lsne-event-row" key={e.id} onClick={() => go(eventPath(e.id))}><Art event={e} /><span><small>{eventEnded(e) ? '종료' : e.timer ? '상시' : '안내'}</small><strong>{e.title}</strong><p>{e.summary}</p><em>{e.period}</em></span><ChevronRight size={20} /></button>)}</div>
        {!EVENTS.some(e => eventEnded(e) === (filter === 'ended')) && <p className="lsne-empty">해당하는 이벤트가 없습니다.</p>}
      </> : event ? <article className="lsne-detail">
        <Art event={event} /><small>{eventEnded(event) ? '종료된 이벤트' : event.period}</small><h1>{event.title}</h1><p className="lsne-lead">{event.summary}</p>
        <dl>{event.facts.map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        {event.gifts && <section className="lsne-gifts" aria-labelledby="lsne-gifts-h">
          <h2 id="lsne-gifts-h"><Gift size={17} aria-hidden="true" />{event.gifts.title}</h2>
          <ol>{event.gifts.tiers.map(([day, gift, scope]) => <li key={day}><b>{day}</b><strong>{gift}</strong><em>{scope}</em></li>)}</ol>
          {event.gifts.warn && <p className="lsne-gift-warn">{event.gifts.warn}</p>}
        </section>}
        <p className="lsne-notice">{event.notice}</p>
        {event.timer ? <button className="lsne-primary" onClick={() => showModal('timer')}><Timer size={19} />{event.cta}</button> : <a className="lsne-primary" href={event.href}>{eventEnded(event) ? '지난 안내 확인' : event.cta}<ArrowUpRight size={18} /></a>}
        <details><summary>신청과 계정 안내</summary><p>이벤트 안내는 로그인 없이 볼 수 있습니다. 실제 신청과 수강권 확인은 연결된 서비스에서 진행합니다. 이미 가입했다면 기존 계정으로 로그인해 주세요.</p></details>
      </article> : <><h1>이벤트를 찾을 수 없습니다.</h1><button className="lsne-primary" onClick={() => go('/events')}>이벤트 전체보기</button></>}
      <footer className="lsne-help"><a href={KAKAO_URL} target="_blank" rel="noopener noreferrer"><MessageCircle size={19} />카카오 문의<ArrowUpRight size={15} /></a></footer>
    </main>
  </FocusLayer>;
  return <>{createPortal(<DesktopServicesLauncher dark={dark} onOpen={() => showModal('services')} />, document.body)}{page}{modal && <FocusLayer dark={dark} title={modalTitle} onClose={() => closeModal()}>
    <header className="lsne-modal-header"><div><small>{APP_NAMES[app]}</small><h2>{modalTitle}</h2></div><button className="lsne-close" onClick={() => closeModal()} aria-label="메뉴 닫기"><X size={23} /></button></header>
    {modal === 'menu' ? <div className="lsne-menu-groups">
      {localGroups.map(group => <section key={group.id}><h3>{group.title}</h3>{group.items.map(item => <LinkRow key={item.id} item={item} onSelect={select} />)}</section>)}
      <section><h3>이벤트·혜택 <span className="lsne-new">NEW</span></h3><LinkRow item={{label:'이벤트 전체보기'}} onSelect={() => showEvents('')} Icon={Gift} /></section>
      <section><h3>계정·지원</h3>{supportGroups.flatMap(group => group.items).map(item => <LinkRow key={item.id} item={item} onSelect={select} />)}<LinkRow item={{label:'카카오 문의',href:KAKAO_URL}} onSelect={select} Icon={MessageCircle} /></section>
    </div> : modal === 'services' ? <ServiceMenuCards app={app} onSelect={card => select({ href: card.href })} onTimer={() => showModal('timer')} /> : modal === 'appearance' ? <div className="lsne-filters" role="group" aria-label="화면 모드">{[['light','데이',Sun],['dark','나이트',Moon],['system','기기',Monitor]].map(([value,label,Icon]) => <button type="button" key={value} aria-pressed={appearance?.value === value} onClick={() => appearance?.onChange(value)}><Icon size={20} />{label}</button>)}</div> : modal === 'timer' ? <div className="lsne-timer-choice"><button type="button" onClick={() => openTimer(true)}><Timer size={29} /><strong>클래식 타이머</strong><span>기존 독서 타이머</span></button><button type="button" onClick={() => openTimer(false)}><Art event={EVENTS[3]} /><strong>딱히그냥 타이머</strong><span>두 친구와 집중하기</span></button></div> : <><EventHighlights onSelect={showEvents} /><button type="button" className="lsne-text-link" onClick={() => showEvents('')}>이벤트 전체보기 <ArrowRight size={18} /></button></>}
  </FocusLayer>}</>;
}
