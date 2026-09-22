import {serviceMenuFor} from './serviceMenu.js';

const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const external = (href, text, cls='') => `<a class="${cls}" href="${escape(href)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
const channels = [
 ['리터스텔라 소개','https://read.literstella.co.kr/about.html'],
 ['원서 난이도 가이드','https://read.literstella.co.kr/books/'],
 ['공식 카페','https://cafe.naver.com/literenglish'],
 ['유튜브','https://www.youtube.com/@literstella'],
 ['인스타그램','https://instagram.com/literstella_official'],
 ['블로그','https://blog.naver.com/sweetanima'],
 ['해리포터 완독 클럽','https://smartstore.naver.com/literstella'],
];
const business = [
 ['대표','배선원'],['사업자등록번호','857-35-01071'],
 ['주소','제주특별자치도 서귀포시 남원읍 신흥앞동산로40번길 39-23, A동 202호'],
 ['통신판매업 신고','제 2026-제주남원-00041호'],
 ['대표전화','010-8619-4504 (상담·문의는 카카오 채널)'],
 ['이메일','literbryanbae@gmail.com'],['개인정보책임자','배선원'],
 ['콘텐츠 디렉터','스텔라(이지영)'],['출판사 신고번호','제 2025-000031호'],
];

// Only trusted application configuration enters this renderer; labels and URLs are escaped.
export function footerHtml({app='read',actions=[],year=new Date().getFullYear()}={}) {
 const menu=serviceMenuFor(app).map(s=>{
  const content=`<strong>${escape(s.label)}${s.isNew?'<em>NEW</em>':''}${s.current?'<small> · 현재</small>':''}</strong><span>${escape(s.sub)}</span>`;
  return s.href?`<a data-footer-service="${escape(s.key)}" href="${escape(s.href)}" target="_blank" rel="noopener noreferrer">${content}</a>`:`<div data-footer-service="${escape(s.key)}">${content}</div>`;
 }).join('');
 const legal=[['privacy','개인정보처리방침','https://challenge.literstella.co.kr/privacy'],['terms','이용약관','https://challenge.literstella.co.kr/terms'],['refund','환불 규정','https://class-new.literstella.co.kr/refund']].map(([key,label,url])=>actions.includes(key)?`<button type="button" id="${app==='read'?key+'Btn':'sf-'+app+'-'+key}" data-footer-action="${key}">${label}</button>`:external(url,label)).join('');
 return `<footer class="ls-site-footer" data-footer-app="${escape(app)}"><div class="ls-site-footer__inner">
 <div class="ls-site-footer__top"><div class="ls-site-footer__brand"><img src="/brand/shared/logo-symbol.png" width="34" height="34" alt="LiterStella"/><img src="/brand/shared/logo-literstella-ko.png" alt="리터스텔라"/><a class="ls-site-footer__why" href="https://www.literstella.co.kr/#trust" target="_blank" rel="noopener noreferrer">리터스텔라 AI수업은 다릅니다 <em>Why?</em></a></div><details><summary>리터스텔라 서비스 <span aria-hidden="true">⌄</span></summary><nav aria-label="리터스텔라 서비스">${menu}</nav></details></div>
 <div class="ls-site-footer__channels">${channels.map(([label,url])=>external(url,escape(label))).join('')}</div>
 <div class="ls-site-footer__actions">${external('https://pf.kakao.com/_xkxdZxeb/chat','카카오톡 문의하기','ls-site-footer__kakao')}${actions.includes('payment')?'<button type="button" data-footer-action="payment">야나완 챌린지 참가 신청·결제</button><p>자동결제(구독)가 아닌 이번 도전 1건의 결제입니다.</p>':''}</div>
 <div class="ls-site-footer__business"><strong>리터스텔라 (LiterStella)</strong><div>${business.map(([k,v])=>`<span><i>${k}</i>${escape(v)}${k==='통신판매업 신고'?external('https://www.ftc.go.kr/bizCommPop.do?wrkr_no=8573501071','사업자정보확인'):''}</span>`).join('')}</div><p>© ${escape(year)} LiterStella. All rights reserved.</p></div>
 <div class="ls-site-footer__legal">${legal}${external('https://challenge.literstella.co.kr/course-terms','수강 조건 개정 · 10월 1일 시행')}</div>
 </div></footer>`;
}
