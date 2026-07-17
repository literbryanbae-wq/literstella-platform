// Waveform — 팟캐스트 스크러버. 미리 구운 피크(public/stella/peaks/{id}.json)를 캔버스에 그린다.
//   왜 미리 굽나: 오디오가 Worker 게이트(다른 오리진)에서 오므로 WebAudio AnalyserNode로 실시간 분석하면
//   CORS 때문에 무음으로 읽힌다. 실제 팟캐스트 앱들도 서버에서 피크를 구워 내려준다.
//   접근성: 캔버스는 장식(aria-hidden). 조작·탐색은 부모의 role="slider"가 담당한다.
import { useEffect, useRef } from 'react';

export default function Waveform({ peaks, progress = 0, height = 56, hover = null }) {
  const ref = useRef(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv || !peaks?.length) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = cv.clientWidth, h = height;
    cv.width = w * dpr; cv.height = h * dpr;
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const cs = getComputedStyle(cv);
    const played = cs.getPropertyValue('--wf-played').trim() || '#d9a84f';
    const rest = cs.getPropertyValue('--wf-rest').trim() || 'rgba(255,255,255,0.22)';

    const n = peaks.length;
    const gap = 1;
    const bw = Math.max(1, w / n - gap);
    const mid = h / 2;
    for (let i = 0; i < n; i++) {
      const x = (i * w) / n;
      const bh = Math.max(2, (peaks[i] / 100) * (h - 4));
      const frac = (i + 0.5) / n;
      ctx.fillStyle = frac <= progress ? played : rest;
      if (hover != null && Math.abs(frac - hover) < 0.004) ctx.fillStyle = played;
      const r = Math.min(bw / 2, 1.5);
      const y = mid - bh / 2;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, bw, bh, r);
      else ctx.rect(x, y, bw, bh);
      ctx.fill();
    }
  }, [peaks, progress, height, hover]);

  return (
    <canvas ref={ref} aria-hidden="true"
      style={{ width: '100%', height: `${height}px`, display: 'block', cursor: 'pointer',
        '--wf-played': 'var(--ls-gold, #d9a84f)',
        '--wf-rest': 'color-mix(in srgb, var(--ls-text) 22%, transparent)' }} />
  );
}
