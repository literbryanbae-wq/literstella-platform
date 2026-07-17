import { LIFECYCLE, innerCard } from './src/lifecycle-emails.js';
import { writeFileSync, readFileSync, existsSync } from 'fs';
const PUB='E:/LiterStella Project/LiterStella-DEV/02-challenge/literstella-challenge/public/badge/';
const b64=f=>{const p=PUB+f; return existsSync(p)?'data:image/png;base64,'+readFileSync(p).toString('base64'):null;};
const BASE={nickname:'스텔라',book:'해리포터와 마법사의 돌',goalDays:100,startDate:'2026년 7월 1일'};
const PER={signup:{},enroll:{},day1:{},
  day3:{points:15,streak:3,pages:9},day7:{points:25,streak:7,pages:21},day10:{points:35,streak:10,pages:30},
  day30:{points:30,streak:30,pages:90},day66:{points:66,streak:66,pages:198},day100:{points:1000,days:100,pages:300,books:1},
  finish:{points:80},diaryFirst:{},tellaUpgrade:{toStage:'tutor',stageName:'튜터',days:30,intimacy:3}};
const KIND={transactional:'거래성',info:'정보성'};
let cards=Object.keys(LIFECYCLE).map((k,i)=>{
  const t=LIFECYCLE[k]; const data={...BASE,...PER[k]};
  const fill=s=>s.replace(/\{\{(\w+)\}\}/g,(_,x)=>data[x]!=null?data[x]:'');
  const card=innerCard(t.build(data)).replace(/\{\{unsubscribe\}\}/g,'수신 설정 · 발신: 리터스텔라');
  const kb=`<span style="background:#e7f0e9;color:#2f7a55;">${KIND[t.kind]||'정보성'}</span>`;
  return `<div class="cell"><div class="lbl"><b>${i+1}. ${t.label}</b> ${kb}</div><div class="subj">${fill(t.subject)}</div><div class="pre">↳ ${t.preheader}</div><div class="mail">${card}</div></div>`;
}).join('');
const frag=`<style>
.egg{display:flex;flex-direction:column;gap:20px;}
.egg .cell{border:1px solid var(--color-border-tertiary);border-radius:var(--border-radius-lg);overflow:hidden;background:var(--color-background-secondary);}
.egg .lbl{font-size:14px;padding:12px 14px 4px;display:flex;gap:8px;align-items:center;color:var(--color-text-primary);}
.egg .lbl span{font-size:11px;font-weight:500;border-radius:999px;padding:2px 9px;}
.egg .subj{font-size:13px;font-weight:500;padding:0 14px;color:var(--color-text-primary);}
.egg .pre{font-size:12px;padding:2px 14px 12px;color:var(--color-text-secondary);}
.egg .mail{padding:14px;background:#f4f1ea;display:flex;justify-content:center;}
.egg .mail table{margin:0 auto;}
</style><div class="egg">${cards}</div>`;
writeFileSync('./email-widget.html',frag,'utf-8');
console.log('widget bytes:',frag.length,'| 종수:',Object.keys(LIFECYCLE).length);
