import React, { useEffect, useState } from 'react';
import { ArrowUpRight, CalendarDays } from 'lucide-react';
import './ServiceLinks.css';

export const SERVICE_LINKS = [
  ['올인원 영어 학습실', 'https://english.literstella.co.kr/growth-lab?preview=1&page=invitation', true],
  ['무료 영어 독서 진단', 'https://read.literstella.co.kr/'],
  ['영어 챌린지 야나완', 'https://challenge.literstella.co.kr/?mode=challenge'],
  ['클래식 원서 강독', 'https://class-new.literstella.co.kr/classes'],
  ['파트너 원서 강독가', 'https://coaching.literstella.co.kr/'],
  ['리터스텔라 글로벌', 'https://global.literstella.com/', true],
];

export function last100Active(now = Date.now()) {
  return now >= Date.parse('2026-08-31T00:00:00+09:00') && now < Date.parse('2026-09-24T00:00:00+09:00');
}

export function Last100Notice() {
  const [active, setActive] = useState(() => last100Active());
  useEffect(() => {
    const id = setInterval(() => setActive(last100Active()), 60000);
    return () => clearInterval(id);
  }, []);
  if (!active) return null;
  return <aside className="ls-network-notice" aria-label="2026년 마지막 100일 도전">
    <CalendarDays size={22} aria-hidden="true" />
    <div><strong>2026년 마지막 100일, 야나완과 함께</strong><p>9월 23일까지 시작일을 선택할 수 있어요.</p></div>
    <a href="https://challenge.literstella.co.kr/?mode=challenge">100일 도전 확인 <ArrowUpRight size={18} aria-hidden="true" /></a>
  </aside>;
}

export default function ServiceLinks() {
  return <nav className="ls-network-links" aria-label="리터스텔라 서비스">
    {SERVICE_LINKS.map(([title, href, isNew]) => <a key={href} href={href}>{title}{isNew && <span>NEW</span>}<ArrowUpRight size={16} aria-hidden="true" /></a>)}
  </nav>;
}
