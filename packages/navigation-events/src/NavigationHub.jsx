import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, ArrowUpRight, ChevronRight, Gift, Menu, MessageCircle, Monitor, Moon, Sun, Timer, X } from 'lucide-react';
import { APP_NAMES, APP_HOME, EVENTS, NETWORK, KAKAO_URL, eventEnded, eventPath, eventRoute, safeReturn, eventOrigin, savedEventContext } from './catalog.mjs';
import './navigation.css';

const dispatch = (type, detail) => window.dispatchEvent(new CustomEvent(type, { detail }));
export const openMenu = () => dispatch('ls:menu');
export const openEvents = (slug = '') => dispatch('ls:events', { slug });
export const openHighlights = () => dispatch('ls:highlights');
export function NavigationButtons({ compact = false }) {
  return <div className={`lsne-buttons${compact ? ' is-compact' : ''}`}>
    <button type="button" onClick={() => openEvents()} aria-label="이벤트 전체보기" title="이벤트"><Gift size={20} /><span>이벤트</span><i aria-hidden="true" /></button>
    <button type="button" onClick={openMenu} aria-label="전체 메뉴 열기" aria-haspopup="dialog" title="전체 메뉴"><Menu size={21} /><span>전체 메뉴</span></button>
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
    const events = e => showEvents(typeof e.detail?.slug === 'string' ? e.detail.slug : '');
    const highlights = () => showModal('highlights');
    const pop = () => {
      modalRef.current = ''; setModal(''); setRoute(eventRoute(window.location.pathname));
      const next = afterClose.current; afterClose.current = null;
      if (next) setTimeout(next, 0);
    };
    window.addEventListener('ls:menu', menu); window.addEventListener('ls:events', events); window.addEventListener('ls:highlights', highlights); window.addEventListener('popstate', pop);
    return () => { window.removeEventListener('ls:menu', menu); window.removeEventListener('ls:events', events); window.removeEventListener('ls:highlights', highlights); window.removeEventListener('popstate', pop); };
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
        if (target.origin === window.location.origin) go(target.pathname + target.search + target.hash);
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
  const modalTitle = {menu:'전체 메뉴',timer:'독서 타이머',appearance:'화면 설정',highlights:'리터스텔라 이벤트'}[modal];
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
        <p className="lsne-notice">{event.notice}</p>
        {event.timer ? <button className="lsne-primary" onClick={() => showModal('timer')}><Timer size={19} />{event.cta}</button> : <a className="lsne-primary" href={event.href}>{eventEnded(event) ? '지난 안내 확인' : event.cta}<ArrowUpRight size={18} /></a>}
        <details><summary>신청과 계정 안내</summary><p>이벤트 안내는 로그인 없이 볼 수 있습니다. 실제 신청과 수강권 확인은 연결된 서비스에서 진행합니다. 이미 가입했다면 기존 계정으로 로그인해 주세요.</p></details>
      </article> : <><h1>이벤트를 찾을 수 없습니다.</h1><button className="lsne-primary" onClick={() => go('/events')}>이벤트 전체보기</button></>}
      <footer className="lsne-help"><a href={KAKAO_URL} target="_blank" rel="noopener noreferrer"><MessageCircle size={19} />카카오 문의<ArrowUpRight size={15} /></a></footer>
    </main>
  </FocusLayer>;
  return <>{page}{modal && <FocusLayer dark={dark} title={modalTitle} onClose={() => closeModal()}>
    <header className="lsne-modal-header"><div><small>{APP_NAMES[app]}</small><h2>{modalTitle}</h2></div><button className="lsne-close" onClick={() => closeModal()} aria-label="메뉴 닫기"><X size={23} /></button></header>
    {modal === 'menu' ? <div className="lsne-menu-groups">
      {localGroups.map(group => <section key={group.id}><h3>{group.title}</h3>{group.items.map(item => <LinkRow key={item.id} item={item} onSelect={select} />)}</section>)}
      <section><h3>이벤트·혜택 <span className="lsne-new">NEW</span></h3><LinkRow item={{label:'이벤트 전체보기'}} onSelect={() => showEvents('')} Icon={Gift} />{EVENTS.map(e => <LinkRow key={e.id} item={{label:e.title}} onSelect={() => showEvents(e.id)} />)}</section>
      <section><h3>리터스텔라 전체 서비스</h3>{NETWORK.map(([id,label,href]) => <LinkRow key={id} item={{id,label,href}} Icon={id === 'timer' ? Timer : ArrowUpRight} onSelect={item => id === 'timer' ? showModal('timer') : select(item)} />)}</section>
      <section><h3>계정·지원</h3>{supportGroups.flatMap(group => group.items).map(item => <LinkRow key={item.id} item={item} onSelect={select} />)}<LinkRow item={{label:'카카오 문의',href:KAKAO_URL}} onSelect={select} Icon={MessageCircle} /></section>
    </div> : modal === 'appearance' ? <div className="lsne-filters" role="group" aria-label="화면 모드">{[['light','데이',Sun],['dark','나이트',Moon],['system','기기',Monitor]].map(([value,label,Icon]) => <button type="button" key={value} aria-pressed={appearance?.value === value} onClick={() => appearance?.onChange(value)}><Icon size={20} />{label}</button>)}</div> : modal === 'timer' ? <div className="lsne-timer-choice"><button type="button" onClick={() => openTimer(true)}><Timer size={29} /><strong>클래식 타이머</strong><span>기존 독서 타이머</span></button><button type="button" onClick={() => openTimer(false)}><Art event={EVENTS[3]} /><strong>딱히그냥 타이머</strong><span>두 친구와 집중하기</span></button></div> : <><EventHighlights onSelect={showEvents} /><button type="button" className="lsne-text-link" onClick={() => showEvents('')}>이벤트 전체보기 <ArrowRight size={18} /></button></>}
  </FocusLayer>}</>;
}
