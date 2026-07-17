// 라이프사이클 이메일 11종 미리보기 갤러리 생성 → email-preview.html
import { LIFECYCLE, renderEmail } from './src/lifecycle-emails.js';
import { writeFileSync } from 'fs';

const BASE = { nickname: '스텔라', book: '해리포터와 마법사의 돌', goalDays: 100, startDate: '2026년 7월 1일' };
const PER = {
  signup: {}, enroll: {},
  day1: { points: 0 },
  day3: { points: 10, streak: 3, pages: 9 },
  day7: { points: 10, streak: 7, pages: 21 },
  day10: { points: 10, streak: 10, pages: 30 },
  day30: { points: 50, streak: 30, pages: 90 },
  day66: { points: 100, streak: 66, pages: 198 },
  day100: { points: 200, days: 100, pages: 300, books: 1 },
  finish: { points: 100 },
  diaryFirst: {},
};

const keys = Object.keys(LIFECYCLE);
const cards = keys.map((k) => {
  const data = { ...BASE, ...PER[k] };
  const { subject, html, kind } = renderEmail(k, data);
  const safe = html.replace(/"/g, '&quot;');
  const badge = kind === 'transactional'
    ? '<span style="background:#e7f0e9;color:#2f7a55;">거래성(동의 불필요)</span>'
    : '<span style="background:#fbeede;color:#b8932f;">마케팅성(수신동의+거부 필요)</span>';
  return `<div class="card">
    <div class="meta"><span class="num">${LIFECYCLE[k].label}</span> <span class="kind" style="${''}">${badge}</span></div>
    <div class="subj">제목: ${subject}</div>
    <div class="pre">미리보기 텍스트: ${LIFECYCLE[k].preheader}</div>
    <iframe loading="lazy" srcdoc="${safe}"></iframe>
  </div>`;
}).join('\n');

const page = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>리터스텔라 라이프사이클 이메일 11종</title>
<style>
  body{margin:0;background:#ece7dc;font-family:'Apple SD Gothic Neo',Arial,sans-serif;color:#1d2433;padding:24px;}
  h1{font-size:20px;margin:0 0 4px;} .lead{color:#6b6354;font-size:13px;margin:0 0 20px;}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:18px;}
  .card{background:#fff;border:1px solid #ddd6c6;border-radius:14px;overflow:hidden;display:flex;flex-direction:column;}
  .meta{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:11px 14px 6px;}
  .num{font-size:13px;font-weight:900;color:#1d2433;}
  .kind span{font-size:10.5px;font-weight:800;border-radius:999px;padding:3px 8px;}
  .subj{font-size:12.5px;font-weight:700;color:#3a3a3a;padding:0 14px;}
  .pre{font-size:11px;color:#8a8270;padding:3px 14px 10px;}
  iframe{width:100%;height:560px;border:0;border-top:1px solid #eee5d3;background:#f4f1ea;}
</style></head><body>
<h1>📧 리터스텔라 라이프사이클 이메일 11종 (Resend)</h1>
<p class="lead">브랜드 셸 공통 · 미리보기 텍스트(프리헤더) 포함 · 거래성/마케팅성 구분 표시. 변수는 {{nickname}} 등으로 발송 시 치환됩니다.</p>
<div class="grid">${cards}</div>
</body></html>`;

writeFileSync('./email-preview.html', page, 'utf-8');
console.log('OK: email-preview.html (' + keys.length + '종)');
// 위젯용: 갤러리 본문만 별도 출력
writeFileSync('./email-preview-fragment.html', `<style>
.eg{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px;}
.eg .card{background:var(--background,#fff);border:1px solid var(--border,#ddd6c6);border-radius:14px;overflow:hidden;display:flex;flex-direction:column;}
.eg .meta{display:flex;justify-content:space-between;gap:8px;padding:11px 14px 6px;}
.eg .num{font-size:13px;font-weight:900;}
.eg .kind span{font-size:10px;font-weight:800;border-radius:999px;padding:3px 8px;}
.eg .subj{font-size:12px;font-weight:700;padding:0 14px;}
.eg .pre{font-size:11px;color:#8a8270;padding:3px 14px 10px;}
.eg iframe{width:100%;height:520px;border:0;border-top:1px solid #eee5d3;background:#f4f1ea;}
</style><div class="eg">${cards}</div>`, 'utf-8');
