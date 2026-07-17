# 삽화 프롬프트 세트 — 뉴스레터·리더 일러스트

> 원서별 수채+잉크워시 톤(NotebookLM 자산과 통일). 이미지엔 **글자 없음**. Gemini(imagen/nano-banana) 또는 이미지 API 배치.
> 조립 공식: `BASE_STYLE + 원서 팔레트·모티프 + 그 Day의 장면(콘텐츠팩 sceneSummary) + NEGATIVE`

## BASE_STYLE (전 삽화 공통)
```
Soft watercolor and ink-wash illustration, literary storybook aesthetic, loose expressive brushwork,
visible paper grain and bleeding pigment edges, muted atmospheric palette, gentle diffused light,
painterly and contemplative mood, fine ink linework accents, generous negative space,
hand-painted classic-literature feel. No people's faces in sharp detail (soft impressionistic figures).
```

## NEGATIVE (전 삽화 공통)
```
no text, no letters, no words, no watermark, no signature, no title, no logo,
not photorealistic, not 3d render, not glossy, no digital gradient banding,
no modern objects, no bright neon, no busy clutter.
```

## 규격
- **히어로/표지:** 1:1 정사각 (모바일 편지·리더 상단). 여백 위쪽에 두어 제목 오버레이 여지.
- **인라인 장면:** 4:3 가로 (장면 요약 옆/위).
- 파일: `illust/{book}/day{NN}_{hero|scene}.png`

## 원서별 팔레트·모티프
| 원서 | 팔레트 | 모티프 |
|---|---|---|
| **키다리 아저씨** | 멜랑콜리 잉크블루·슬레이트 + 앤티크골드, 차가운 회청 워시 | 고아원 단칸·철책 너머·긴 그림자·현관·편지지 |
| **오즈의 마법사** | 도브그레이(캔자스) → **에메랄드 도착** + 노란벽돌 골드 | 잿빛 대초원·회오리·단칸집·검은 강아지 토토·문 너머 색 |
| **빨강머리 앤** | 세이지그린 + 코랄, 따뜻한 파스텔 수채 | 에이번리 전원·초록지붕·들꽃·개울·창가 |
| **오만과 편견** | 더스티 블루그레이 + 골드, 절제된 리젠시 | 영국 시골 대저택·마차·응접실·정원 산책 |
| **작은 아씨들** | 버건디 + 크림, 아늑한 실내 톤 | 벽난로·네 자매·바느질·남북전쟁기 가정 |

---

## 예시 프롬프트 (완성형)

### 키다리 아저씨 · Day01 히어로 (Blue Wednesday)
```
[BASE_STYLE], melancholy ink-blue and slate palette with antique-gold accents, cold blue-gray washes,
a small lone orphanage window at dusk seen from inside, a tall iron paling fence beyond,
a faint long shadow stretching across a bare wooden floor, a single folded letter on a sill,
quiet loneliness with a thread of hope, 1:1 square, upper negative space. [NEGATIVE]
```

### 오즈의 마법사 · Day01 히어로 (The Cyclone)
```
[BASE_STYLE], vast dove-gray Kansas prairie under a heavy sky, a tiny one-room farmhouse,
everything drained to sober gray EXCEPT one small black dog with bright eyes — the only spark of life,
a faint emerald glow just beginning to arrive at the horizon's edge, distant funnel of a coming cyclone,
dove-gray with emerald and yellow-brick gold accents, 1:1 square, upper negative space. [NEGATIVE]
```

### 오즈의 마법사 · Day01 인라인 장면 (Scene 2 회오리)
```
[BASE_STYLE], a small farmhouse on the gray prairie as a great cyclone funnel descends from the north and south,
tall grass bending violently, a girl and a little black dog silhouetted in the doorway,
dove-gray storm palette with faint emerald undertone, dramatic yet painterly, 4:3 landscape. [NEGATIVE]
```

## 사용
1. 각 Day 콘텐츠팩의 `sceneSummary`·모티프를 위 공식에 끼워 프롬프트 자동 생성(코드로 조립).
2. Gemini(imagen-3 / nano-banana) 또는 이미지 API 배치 → `illust/{book}/`.
3. 편지 HTML의 🖼 슬롯을 실제 `<img>`로 교체(발송 전 하드닝 룰: width·display:block·alt).
4. **일관성 팁:** 같은 원서는 BASE_STYLE + 팔레트를 고정, 장면만 변경 → 시리즈 통일감. seed 고정 가능하면 원서별 seed 유지.

## 🔴 운영자 결정 대기
- 생성 경로: **Gemini 직접**(웹, 수동 배치) vs **이미지 API**(자동 배치, 60편×1~2장). 후자면 어떤 API(Google Imagen API / 기타).
