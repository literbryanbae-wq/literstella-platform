# -*- coding: utf-8 -*-
r"""매일 뉴스레터(가벼운 새 포맷) 렌더러 — 라이트 콘텐츠팩 JSON → 이메일 HTML.

전략 정본: NEWSLETTER-STRATEGY-2026-07-13.md §3.
  한 통 = 삽화 1장 + 짧은 텍스트 1코너 + 제품 CTA 1개 + 하단 '오늘의 3분' 앵커 위젯.
  요일 로테이션(월 원서소식 / 화 오늘의표현 / 수 독자이야기 / 목 큐레이션 / 금 스텔라비하인드 / 주말 가볍게).

철칙(전략 §0): '한 문장의 해설'은 오디오+그 페이지에만 산다.
  → 뉴스레터는 그 문장을 다시 풀지 않고 하단 앵커 위젯에서 '들어보기 →' 링크로만 인용한다.
  → 이 렌더러는 anchor 블록에 해설 본문을 넣지 않는다(하드가드로 강제).

무거운 강독 콘텐츠팩(hp1-day*.json = one_sentence 심화)과 다른 소스·다른 스키마.
  이 파일은 '써먹게(눈·짧게·실용)'의 라이트 채널. 강독 심화는 오디오 채널로 이동.

하드닝(nl_render_hp.py 정본 규칙 계승): solid hex만(rgba 금지)·표 기반·전 인라인·640px·script/flex/grid 금지·금지어 스캔.

사용: python nl_render_daily.py daily-packs/2026-07-14-tue.json out/daily-2026-07-14-tue.html
"""
import os, io, sys, json, html, re

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# 브랜드 워드마크 — 🔴 운영자 확정 대기(§4 리네임). 확정 시 이 한 줄만 교체.
#   기존 "오늘을 여는 클래식 영어 한 문장"은 오디오 시그니처로 이동 → 매일 이메일은 새 이름 필요.
BRAND = {
    "kicker": "리터스텔라",           # 상단 소제목(작게)
    "wordmark": "오늘의 원서",         # 메인 워드마크 (임시 후보 — 운영자 확정 전)
    "tagline": "원서로 여는 오늘 한 조각",
}

# 하단 앵커 위젯이 링크할 오디오 전용 페이지 베이스.
#   🔴 병렬 '페이지 제작 세션'과 URL 스킴 조율 필요. 페이지 미완이면 이 값이 플레이스홀더로 노출.
ANCHOR_BASE = "https://literstella.co.kr/one-sentence"   # 예: /one-sentence/hp1-037

BANNED = ["완주", "여정", "대장정", "도반", "전액기부"]

# 요일 코너 프리셋(전략 §3 표). 코너별 kicker·악센트색·CTA 톤 기본값.
WEEKDAY = {
    "mon": {"label": "월요일 · 원서 소식", "accent": "gold"},
    "tue": {"label": "화요일 · 오늘의 표현", "accent": "gold"},
    "wed": {"label": "수요일 · 독자 이야기", "accent": "coral"},
    "thu": {"label": "목요일 · 이번 주 이 책", "accent": "gold"},
    "fri": {"label": "금요일 · 스텔라 비하인드", "accent": "gold"},
    "sat": {"label": "주말 · 가볍게 한 판", "accent": "coral"},
    "sun": {"label": "주말 · 가볍게 한 판", "accent": "coral"},
}

# 라이트 페이퍼 테마(진단앱 라이트 팔레트 계열 + 골드/코랄). 앵커만 딥잉크(오디오=밤 무드).
T = {
    "paper": "#FFFFFF", "page": "#FCFAF5",
    "cream": "#F7F1E6", "cream2": "#F1E7D2", "cream3": "#FBF7EF",
    "ink": "#2A2416", "ink2": "#4A4030",
    "muted": "#8C7F6B", "muted2": "#A99C86",
    "gold": "#C8A84B", "goldsoft": "#D9BE6E", "golddeep": "#A8842F",
    "coral": "#DD6A49", "coraldeep": "#C0492F",
    "line": "#E8DFCF", "linesoft": "#D8C7A6",
    "anchor": "#241F14", "anchor2": "#141009", "anchorgold": "#EBCB7E", "anchormuted": "#B7A57E",
    "paperlink": "#B07A2E",
}
LOGO_SYMBOL = "https://cdn.liveklass.com/common/019d0f4354bd75f89c650133a6d8953c.png"
LOGO_FOOT_SYMBOL = "https://cdn.liveklass.com/common/019d0f436c8b7a04aa75a80802cbea3c.png"
LOGO_FOOT_TEXT = "https://cdn.liveklass.com/common/019d0f4354c670ab9bc1732aadc1ba86.png"


def esc(s):
    return html.escape(str(s or ""), quote=False)


def accent(pack):
    a = WEEKDAY.get(pack["issue"].get("weekday", "mon"), WEEKDAY["mon"])["accent"]
    return T["gold"] if a == "gold" else T["coral"]


# ── 라이트 콘텐츠 블록 렌더 (type별) ────────────────────────────────────────
def block_p(b, ac):
    return (f'  <p class="mob-txt" style="margin:0 0 14px;font-size:15px;line-height:1.85;'
            f'color:{T["ink2"]};font-weight:300;">{esc(b["text"])}</p>')


def block_list(b, ac):
    rows = "".join(
        f'''    <tr>
      <td valign="top" style="width:20px;padding:0 8px 10px 0;color:{ac};font-size:14px;line-height:1.7;">&#9679;</td>
      <td class="mob-txt" style="padding:0 0 10px;font-size:14.5px;line-height:1.7;color:{T["ink2"]};">{esc(it)}</td>
    </tr>''' for it in b.get("items", []))
    return (f'  <table border="0" cellpadding="0" cellspacing="0" width="100%" style="width:100%;margin:2px 0 12px;"><tbody>\n'
            f'{rows}\n  </tbody></table>')


def block_term(b, ac):
    """화요일 · 오늘의 표현 카드 (실용 단어/표현 1개)."""
    ex = (f'<p style="margin:12px 0 0;font-size:13.5px;line-height:1.75;color:{T["ink2"]};">'
          f'<span style="color:{T["golddeep"]};font-weight:600;">이렇게 써요 &middot; </span>{esc(b["example"])}</p>'
          if b.get("example") else '')
    tip = (f'<p style="margin:8px 0 0;font-size:12.5px;line-height:1.7;color:{T["muted"]};">{esc(b["tip"])}</p>'
           if b.get("tip") else '')
    return f'''  <table border="0" cellpadding="0" cellspacing="0" width="100%" style="width:100%;background:{T['cream']};border:1px solid {T['line']};border-left:3px solid {ac};margin:4px 0 16px;"><tbody><tr>
    <td style="padding:18px 20px;">
      <p style="margin:0;font-family:'Playfair Display',Georgia,serif;font-size:22px;font-style:italic;color:{T['ink']};">{esc(b['en'])}</p>
      <p style="margin:6px 0 0;font-size:14.5px;font-weight:600;color:{T['golddeep']};">{esc(b['ko'])}</p>
      {ex}
      {tip}
    </td>
  </tr></tbody></table>'''


def block_quote(b, ac):
    """수요일 · 독자 이야기 / 독자가 고른 문장."""
    by = f'<p style="margin:10px 0 0;font-size:12px;color:{T["muted"]};text-align:right;">&mdash; {esc(b["by"])}</p>' if b.get("by") else ''
    ko = f'<p style="margin:8px 0 0;font-size:13.5px;line-height:1.7;color:{T["ink2"]};">{esc(b["ko"])}</p>' if b.get("ko") else ''
    en = (f'<p lang="en" style="margin:0;font-family:\'Playfair Display\',Georgia,serif;font-style:italic;'
          f'font-size:16px;line-height:1.7;color:{T["ink"]};">&ldquo;{esc(b["en"])}&rdquo;</p>') if b.get("en") else ''
    return f'''  <table border="0" cellpadding="0" cellspacing="0" width="100%" style="width:100%;background:{T['cream3']};border:1px solid {T['line']};border-left:3px solid {ac};margin:4px 0 16px;"><tbody><tr>
    <td style="padding:18px 20px;">
      {en}
      {ko}
      {by}
    </td>
  </tr></tbody></table>'''


def block_book(b, ac):
    """목요일 · 이번 주 이 책 (표지 + 한 줄 이유)."""
    cover = (f'''      <td valign="top" style="width:88px;padding-right:16px;">
        <img src="{esc(b['cover'])}" width="80" alt="{esc(b.get('title_ko',''))}" style="display:block;width:80px;max-width:80px;height:auto;border:1px solid {T['line']};border-radius:4px;">
      </td>''' if b.get("cover") else '')
    return f'''  <table border="0" cellpadding="0" cellspacing="0" width="100%" style="width:100%;background:{T['cream']};border:1px solid {T['line']};margin:4px 0 16px;"><tbody><tr>
    <td style="padding:18px 20px;">
      <table border="0" cellpadding="0" cellspacing="0" width="100%"><tbody><tr>
{cover}
      <td valign="top">
        <p style="margin:0;font-family:'Playfair Display',Georgia,serif;font-style:italic;font-size:16px;color:{T['ink']};line-height:1.4;">{esc(b.get('title_en',''))}</p>
        <p style="margin:3px 0 8px;font-size:13.5px;font-weight:600;color:{T['golddeep']};">{esc(b.get('title_ko',''))}</p>
        <p class="mob-txt" style="margin:0;font-size:13.5px;line-height:1.7;color:{T['ink2']};">{esc(b.get('why',''))}</p>
      </td>
      </tr></tbody></table>
    </td>
  </tr></tbody></table>'''


def block_quiz(b, ac):
    """주말 · 가벼운 퀴즈. 정답은 밝히지 않고 '리더에서 확인' 유도(가볍게)."""
    opts = "".join(
        f'<p style="margin:0 0 7px;font-size:14px;line-height:1.5;color:{T["ink2"]};">'
        f'<span style="color:{ac};font-weight:700;">{chr(9312+i)}</span> &nbsp;{esc(o)}</p>'
        for i, o in enumerate(b.get("options", [])))
    hint = (f'<p style="margin:12px 0 0;font-size:12px;color:{T["muted"]};">{esc(b["answer_hint"])}</p>'
            if b.get("answer_hint") else '')
    return f'''  <table border="0" cellpadding="0" cellspacing="0" width="100%" style="width:100%;background:{T['cream']};border:1px solid {T['line']};border-left:3px solid {ac};margin:4px 0 16px;"><tbody><tr>
    <td style="padding:18px 20px;">
      <p style="margin:0 0 12px;font-size:15px;font-weight:600;color:{T['ink']};line-height:1.6;">Q. {esc(b.get('q',''))}</p>
      {opts}
      {hint}
    </td>
  </tr></tbody></table>'''


BLOCKS = {"p": block_p, "list": block_list, "term": block_term,
          "quote": block_quote, "book": block_book, "quiz": block_quiz}


def render_blocks(blocks, ac):
    out = []
    for b in blocks:
        fn = BLOCKS.get(b.get("type", "p"))
        if not fn:
            raise ValueError(f"알 수 없는 블록 type: {b.get('type')!r}")
        out.append(fn(b, ac))
    return "\n".join(out)


def render(pack):
    iss = pack["issue"]
    wd = WEEKDAY.get(iss.get("weekday", "mon"), WEEKDAY["mon"])
    ac = accent(pack)
    hero = pack.get("hero") or {}
    hero_url = hero.get("url")
    cta = pack["cta"]
    an = pack.get("anchor") or {}

    hero_slot = (
        f'<img src="{esc(hero_url)}" width="600" alt="{esc(hero.get("alt",""))}" '
        f'style="display:block;width:100%;max-width:600px;height:auto;border:0;">'
        if hero_url else
        f'<div style="border:1px dashed {T["linesoft"]};background:{T["cream3"]};padding:30px 8px;text-align:center;">'
        f'<span style="font-size:11px;color:{T["muted2"]};letter-spacing:1px;">&#128444; 삽화 준비 중</span></div>')

    body = render_blocks(pack.get("blocks", []), ac)
    lede = (f'  <p class="mob-txt" style="margin:0 0 16px;font-size:15.5px;line-height:1.8;color:{T["ink"]};">'
            f'{esc(pack["lede"])}</p>' if pack.get("lede") else '')

    # ── 하단 '오늘의 3분' 앵커 위젯 (해설 본문 없음 · 티저+링크만) ──
    an_url = an.get("url") or (f'{ANCHOR_BASE}/{esc(an["id"])}' if an.get("id") else ANCHOR_BASE)
    an_sentence = (
        f'<p lang="en" style="margin:0 0 4px;font-family:\'Playfair Display\',Georgia,serif;font-style:italic;'
        f'font-size:15px;line-height:1.6;color:{T["anchorgold"]};">&ldquo;{esc(an["sentence_en"])}&rdquo;</p>'
        if an.get("sentence_en") else '')
    an_meta_html = " &middot; ".join(esc(p) for p in (an.get("book_ko"), an.get("tag")) if p)
    anchor_block = f'''  <!-- 하단 고정 앵커: 오늘의 3분(오디오 페이지) — 티저+링크만, 해설 본문 없음 -->
  <tr><td style="background:{T['paper']};padding:8px 20px 26px;">
    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="width:100%;background:{T['anchor']};background-image:linear-gradient(160deg,{T['anchor']} 0%,{T['anchor2']} 100%);border:1px solid {T['golddeep']};"><tbody>
      <tr><td style="height:2px;background:{T['gold']};font-size:1px;line-height:1px;">&nbsp;</td></tr>
      <tr><td style="padding:18px 20px 20px;">
        <p style="margin:0 0 10px;font-family:'EB Garamond',serif;font-size:11px;letter-spacing:2px;color:{T['anchormuted']};">&#127911; 오늘의 3분 &middot; 「스텔라의 클래식 영어 한 문장」</p>
        <p style="margin:0 0 4px;font-size:13px;color:{T['anchormuted']};">{an_meta_html}</p>
        {an_sentence}
        <table border="0" cellpadding="0" cellspacing="0" style="margin:14px 0 0;"><tbody><tr>
          <td style="background:{T['gold']};"><a href="{an_url}" style="display:inline-block;padding:11px 20px;font-size:13px;font-weight:700;color:{T['anchor2']};text-decoration:none;letter-spacing:.5px;">&#9654;&nbsp; 3분, 귀로 들어보기</a></td>
        </tr></tbody></table>
      </td></tr>
    </tbody></table>
  </td></tr>''' if an else ''

    return f'''<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{esc(BRAND['wordmark'])} · {esc(wd['label'])} · {esc(iss.get('date',''))}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital@0;1&family=Playfair+Display:ital@0;1&family=Noto+Serif+KR:wght@300;400;500&family=Noto+Sans+KR:wght@300;400;500&display=swap">
<style>
  body{{margin:0;padding:0;background:{T['page']};-webkit-text-size-adjust:100%;}}
  img{{border:0;max-width:100%;}}
  @media (max-width:480px){{ .mob-txt{{font-size:14px !important;}} .body-pad{{padding:20px 16px 0 !important;}} .hd-pad{{padding:14px 16px !important;}} }}
</style>
</head>
<body>
<table border="0" cellpadding="0" cellspacing="0" style="background:{T['page']};overflow-x:hidden;width:100%;" width="100%"><tbody><tr><td align="center" style="padding:0;margin:0;">
<table border="0" cellpadding="0" cellspacing="0" class="main-table" style="width:100%;max-width:640px;margin:0 auto;table-layout:fixed;background:{T['paper']};"><tbody>

  <!-- 헤더 바 (워드마크) -->
  <tr><td class="hd-pad" style="background:{T['paper']};border-bottom:1px solid {T['line']};padding:16px 22px;">
    <table border="0" cellpadding="0" cellspacing="0" width="100%"><tbody><tr>
      <td style="vertical-align:middle;">
        <table border="0" cellpadding="0" cellspacing="0"><tbody><tr>
          <td style="vertical-align:middle;padding-right:10px;"><img src="{LOGO_SYMBOL}" width="28" height="28" alt="리터스텔라" style="display:block;width:28px;height:28px;border:0;"></td>
          <td style="vertical-align:middle;">
            <div style="font-family:'EB Garamond',serif;font-size:9.5px;letter-spacing:2.4px;color:{T['muted2']};line-height:1.25;text-transform:uppercase;">{esc(BRAND['kicker'])}</div>
            <div style="font-family:'Noto Serif KR','EB Garamond',serif;font-size:17px;font-weight:700;letter-spacing:.2px;color:{T['ink']};line-height:1.3;">{esc(BRAND['wordmark'])}</div>
          </td>
        </tr></tbody></table>
      </td>
      <td align="right" style="vertical-align:middle;font-family:'EB Garamond',serif;font-size:11px;letter-spacing:1.5px;color:{T['muted']};white-space:nowrap;">{esc(iss.get('date',''))}</td>
    </tr></tbody></table>
  </td></tr>

  <!-- 요일 코너 라벨 바 -->
  <tr><td style="background:{ac};padding:9px 22px;">
    <table border="0" cellpadding="0" cellspacing="0" width="100%"><tbody><tr>
      <td style="font-family:'Noto Sans KR',sans-serif;font-size:12px;font-weight:700;letter-spacing:1px;color:{T['paper']};">{esc(wd['label'])}</td>
      <td align="right" style="font-family:'EB Garamond',serif;font-size:11px;color:{T['paper']};">{('No.' + esc(iss['no'])) if iss.get('no') else ''}</td>
    </tr></tbody></table>
  </td></tr>

  <!-- 삽화 1장 -->
  <tr><td style="background:{T['paper']};">{hero_slot}</td></tr>

  <!-- 코너 본문 (짧게) -->
  <tr><td class="body-pad" style="background:{T['paper']};padding:26px 22px 0;">
    <p style="margin:0 0 6px;font-family:'EB Garamond',serif;font-size:11px;letter-spacing:2px;color:{ac};text-transform:uppercase;"><strong>{esc(pack.get('kicker', wd['label']))}</strong></p>
    <p style="margin:0 0 16px;font-family:'Noto Serif KR',serif;font-size:21px;font-weight:500;line-height:1.4;color:{T['ink']};">{esc(pack['headline'])}</p>
{lede}
{body}
  </td></tr>

  <!-- 제품 CTA 1개 -->
  <tr><td style="background:{T['paper']};padding:8px 22px 22px;">
    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="width:100%;"><tbody><tr>
      <td align="center" style="background:{T['coral']};border-radius:4px;">
        <a href="{esc(cta['url'])}" style="display:block;padding:15px 18px;font-size:14.5px;font-weight:700;color:{T['paper']};text-decoration:none;letter-spacing:.3px;">{esc(cta['label'])} &rarr;</a>
      </td>
    </tr></tbody></table>
    {(f'<p style="margin:10px 2px 0;font-size:12px;color:' + T['muted'] + ';line-height:1.6;text-align:center;">' + esc(cta['sub']) + '</p>') if cta.get('sub') else ''}
  </td></tr>

  <!-- 구분 -->
  <tr><td style="background:{T['paper']};padding:6px 0 14px;text-align:center;"><p style="margin:0;font-size:11px;letter-spacing:8px;color:{T['linesoft']};">&#10022;</p></td></tr>

{anchor_block}

  <!-- footer -->
  <tr><td style="background:{T['cream2']};padding:26px 22px 22px;text-align:center;border-top:1px solid {T['linesoft']};">
    <table align="center" border="0" cellpadding="0" cellspacing="0" style="margin:0 auto 12px;"><tbody>
      <tr><td align="center" style="padding-bottom:8px;"><img src="{LOGO_FOOT_SYMBOL}" width="28" height="28" alt="Liter Stella" style="display:block;width:28px;height:28px;border:0;"></td></tr>
      <tr><td align="center"><img src="{LOGO_FOOT_TEXT}" width="78" alt="리터스텔라" style="display:block;width:78px;max-width:78px;height:auto;border:0;"></td></tr>
    </tbody></table>
    <p style="margin:0 0 4px;font-size:11px;color:{T['muted']};line-height:1.7;">&#128218; MY READ TO SPEAK &middot; &#127942; 영어 챌린지 야나완&trade; &middot; &#127891; 클래식 원서 강독</p>
    <p style="margin:0;font-size:11px;line-height:1.8;color:{T['muted2']};">&copy; 2026 Liter Stella &middot; literstella.co.kr<br><a href="{{{{unsubscribe}}}}" style="color:{T['muted2']};text-decoration:underline;">수신 설정</a></p>
  </td></tr>

</tbody></table>
</td></tr></tbody></table>
</body>
</html>'''


def validate(doc, pack):
    # 하드닝 검증
    assert "rgba(" not in doc, "rgba() 발견 — Outlook 폴백 위험"
    hits = [w for w in BANNED if w in doc]
    assert not hits, f"금지어 {hits}"
    # 철칙: 앵커 위젯에 해설 본문 금지(전략 §0). anchor에 body/paragraphs/reading 류 키 있으면 차단.
    an = pack.get("anchor") or {}
    forbidden = [k for k in ("body", "paragraphs", "reading", "essay", "explanation", "ko_reading") if k in an]
    assert not forbidden, f"앵커에 해설 본문 키 금지(오디오 전용): {forbidden}"


def main():
    src, out = sys.argv[1], sys.argv[2]
    pack = json.load(open(src, encoding="utf-8"))
    doc = render(pack)
    validate(doc, pack)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    open(out, "w", encoding="utf-8").write(doc)
    en = len(re.findall(r'[A-Za-z]', doc)); ko = len(re.findall(r'[가-힣]', doc))
    print(f"OK {out}  ({len(doc):,} bytes)  rgba 0 · 금지어 0 · 640px 표 · solid hex · 영어비 {en/(en+ko)*100:.1f}%")


if __name__ == "__main__":
    main()
