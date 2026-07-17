# -*- coding: utf-8 -*-
r"""HP 뉴스레터 렌더러 — 콘텐츠팩 JSON → 이메일 HTML (키다리 정본 골격 + HP 마룬/골드 테마).

원칙(아키텍처 #1): 정본=JSON, HTML은 그 렌더. Day6+ 동일 함수로 재렌더.
키다리 골격(samples/kidari-day01.html) 그대로, 테마색·콘텐츠만 교체(배치 핸드오프 규칙).
하드닝: solid hex만(rgba 금지) · 표 기반 · 전 인라인 · 640px · script/flex/grid 금지 · 금지어 스캔.
미디어: 삽화·오디오 URL 있으면 실제 노출, 없으면 '준비 중' 플레이스홀더(키다리와 동일 패턴).

사용: python nl_render_hp.py content-packs/hp1-day05.json out/hp1-day05.html
"""
import os, io, sys, json, html, re

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
BANNED = ["완주", "여정", "대장정", "도반", "전액기부"]

# HP 마룬/골드 테마 (운영자 HP 뉴스레터 팔레트 + access-tiers 마룬)
T = {
    "dark": "#3B141A", "dark2": "#2E1015", "darkcard": "#4A1A22",
    "gold": "#C89D3E", "goldsoft": "#D9B45A", "goldbright": "#EFA526", "goldmuted": "#A98A55",
    "coral": "#EB6B56",
    "paper": "#FFFFFF", "cream": "#F5EFE6", "cream2": "#F2E8D0", "cream3": "#FAF6EE",
    "page": "#FCFAF5",
    "muted": "#C7B6A0", "muted2": "#A38F84",
    "light": "#EFEFEF", "light2": "#F2F3F5",
    "ink": "#2A2010", "ink2": "#3A2E1E",
    "line": "#E8DFCF", "linedash": "#D8C7A6", "linesoft": "#7A5A40",
}
LOGO_SYMBOL = "https://cdn.liveklass.com/common/019d0f4354bd75f89c650133a6d8953c.png"
LOGO_FOOT_SYMBOL = "https://cdn.liveklass.com/common/019d0f436c8b7a04aa75a80802cbea3c.png"
LOGO_FOOT_TEXT = "https://cdn.liveklass.com/common/019d0f4354c670ab9bc1732aadc1ba86.png"


def esc(s):
    return html.escape(str(s or ""), quote=False)


def media_row(icon, kicker, desc, url, todo_label):
    """오디오/영상 행. url 있으면 재생 링크, 없으면 '준비 중'."""
    right = (f'<a href="{esc(url)}" style="font-family:\'EB Garamond\',serif;font-size:10px;letter-spacing:1px;color:{T["paper"]};background:{T["dark"]};padding:8px 12px;text-decoration:none;display:inline-block;border:1px solid {T["linesoft"]};border-radius:3px;">재생하기</a>'
             if url else
             f'<span style="font-family:\'EB Garamond\',serif;font-size:10px;letter-spacing:.5px;color:{T["muted2"]};background:{T["cream2"]};padding:8px 10px;display:inline-block;border:1px solid {T["linedash"]};border-radius:3px;">{esc(todo_label)}</span>')
    return f'''  <tr><td class="body-pad" style="background:{T['paper']};padding:0 20px 12px;">
    <table border="0" cellpadding="0" cellspacing="0" style="background:{T['cream']};border:1px solid {T['line']};width:100%;" width="100%"><tbody><tr>
      <td style="padding:13px 0 13px 16px;vertical-align:middle;width:58px;">
        <table border="0" cellpadding="0" cellspacing="0" width="36"><tbody><tr>
          <td align="center" style="width:36px;height:36px;line-height:36px;text-align:center;background:{T['dark']};border-radius:50%;color:{T['gold']};font-size:15px;">{icon}</td>
        </tr></tbody></table>
      </td>
      <td style="padding:13px 0;vertical-align:middle;">
        <p style="margin:0 0 3px;font-family:'EB Garamond',serif;font-size:12px;letter-spacing:1px;color:{T['dark']};"><strong>{esc(kicker)}</strong></p>
        <p style="margin:0;font-size:11px;color:{T['muted2']};line-height:1.5;">{esc(desc)}</p>
      </td>
      <td style="padding:13px 16px 13px 0;vertical-align:middle;text-align:right;width:92px;"><div style="text-align:center;">{right}</div></td>
    </tr></tbody></table>
  </td></tr>'''


def scene_block(sc):
    q = ''
    if sc.get("quote"):
        q = f'''    <table border="0" cellpadding="0" cellspacing="0" style="margin:0 0 16px;border-left:2px solid {T['linesoft']};width:100%;" width="100%"><tbody><tr>
      <td class="mob-txt" style="padding:10px 14px;font-family:'Playfair Display',serif;font-style:italic;font-size:14px;color:{T['muted']};line-height:1.8;">&ldquo;{esc(sc['quote'])}&rdquo;</td>
    </tr></tbody></table>'''
    after = f'<p class="mob-txt" style="margin:0 0 18px;font-size:14px;line-height:1.9;color:{T["light"]};font-weight:300;">{esc(sc["after"])}</p>' if sc.get("after") else ''
    return f'''    <p style="margin:0 0 10px;font-size:12px;color:{T['goldbright']};letter-spacing:.5px;"><strong>&#9679; Scene {sc['no']} &middot; {esc(sc['title'])}</strong></p>
    <p class="mob-txt" style="margin:0 0 12px;font-size:14px;line-height:1.9;color:{T['light']};font-weight:300;">{esc(sc['body'])}</p>
{q}
{after}'''


def para_block(items, color):
    out = []
    for it in items:
        if isinstance(it, dict) and it.get("pullquote"):
            out.append(f'''    <table border="0" cellpadding="0" cellspacing="0" style="margin:0 0 14px 10px;border-left:3px solid {T['gold']};background:{T['cream']};width:100%;" width="95%"><tbody><tr>
      <td class="mob-txt" style="padding:14px 16px;font-family:'Playfair Display',serif;font-style:italic;font-size:14px;color:#463620;line-height:1.75;">{esc(it['pullquote'])}</td>
    </tr></tbody></table>''')
        else:
            out.append(f'<p class="mob-txt" style="font-size:15px;line-height:1.85;color:{color};margin:0 0 14px 10px;">{esc(it)}</p>')
    return "\n".join(out)


def vocab_rows(vocab):
    rows = []
    for i, v in enumerate(vocab):
        border = '' if i == len(vocab) - 1 else f'border-bottom:1px solid #EFEADE;'
        rows.append(f'''      <tr><td style="background:{T['paper']};padding:13px 20px;{border}">
        <table cellpadding="0" cellspacing="0" width="100%"><tbody><tr>
          <td class="mob-txt" style="font-family:'Playfair Display',serif;font-style:italic;font-size:15px;color:{T['dark']};vertical-align:top;padding-right:12px;font-weight:bold;width:130px;">{esc(v['word'])}</td>
          <td class="mob-txt" style="font-size:14px;color:#5A4A30;line-height:1.6;">{esc(v['meaning'])}</td>
        </tr></tbody></table>
      </td></tr>''')
    return "\n".join(rows)


def render(pack):
    book = pack["book"]; ch = pack["chapter"]; total = book["total_days"]
    day = pack["day"]; media = pack.get("media", {})
    hero_url = media.get("hero_illust", {}).get("url") if isinstance(media.get("hero_illust"), dict) else None
    essay_audio = media.get("essay_audio", {}).get("url") if isinstance(media.get("essay_audio"), dict) else None
    story_video = media.get("free_reading_video", {})

    hero_slot = (f'<img src="{esc(hero_url)}" width="600" alt="{esc(ch["title_ko"])}" style="display:block;width:100%;max-width:600px;height:auto;border:0;border-radius:6px;margin:0 auto 14px;">'
                 if hero_url else
                 f'<div style="border:1px dashed {T["gold"]};border-radius:6px;padding:26px 8px;background:{T["dark2"]};margin:0 0 14px;"><span style="font-size:11px;color:{T["muted"]};">🖼 삽화 준비 중 (SDXL)</span></div>')

    scenes = "\n".join(scene_block(s) for s in pack["scenes"])
    reading = para_block(pack["sentence_reading"], T["ink2"])
    essay = "\n".join(f'<p class="mob-txt" style="margin:0 0 12px;font-size:14px;line-height:1.85;color:{T["ink2"]};">{esc(p)}</p>' for p in pack["essay"])
    vocab = vocab_rows(pack["vocab"])

    return f'''<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>리터스텔라 · 해리포터 완독 클럽 뉴스레터 · Day {day:02d}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital@0;1&family=Playfair+Display:ital@0;1&family=Noto+Serif+KR:wght@300;400;500&family=Noto+Sans+KR:wght@300;400;500&display=swap">
<style>
  body{{margin:0;padding:0;background:{T['page']};-webkit-text-size-adjust:100%;}}
  img{{border:0;max-width:100%;}}
  @media (max-width:480px){{ .mob-txt{{font-size:14px !important;}} .hd-pad{{padding:30px 16px 24px !important;}} .body-pad{{padding:14px 14px 0 !important;}} .story-pad{{padding:0 14px 24px !important;}} }}
</style>
</head>
<body>
<table border="0" cellpadding="0" cellspacing="0" style="background:{T['page']};overflow-x:hidden;width:100%;" width="100%"><tbody><tr><td align="center" style="padding:0;margin:0;">
<table border="0" cellpadding="0" cellspacing="0" class="main-table" style="width:100%;max-width:640px;margin:0 auto;table-layout:fixed;background:{T['paper']};"><tbody>

  <!-- 헤더 바 -->
  <tr><td style="background:{T['dark']};padding:12px 20px;">
    <table border="0" cellpadding="0" cellspacing="0" width="100%"><tbody><tr>
      <td style="vertical-align:middle;">
        <table border="0" cellpadding="0" cellspacing="0"><tbody><tr>
          <td style="vertical-align:middle;padding-right:9px;"><img src="{LOGO_SYMBOL}" width="26" height="26" alt="리터스텔라" style="display:block;width:26px;height:26px;border:0;"></td>
          <td style="vertical-align:middle;">
            <div style="font-family:'EB Garamond',serif;font-size:9.5px;letter-spacing:2.4px;color:{T['muted']};line-height:1.25;">오늘을 여는</div>
            <div style="font-family:'Nanum Myeongjo','EB Garamond',serif;font-size:15px;font-weight:700;letter-spacing:.2px;color:{T['gold']};line-height:1.35;">마법 같은 영어 한 문장</div>
          </td>
        </tr></tbody></table>
      </td>
      <td align="right" style="vertical-align:middle;font-family:'EB Garamond',serif;font-size:11px;letter-spacing:2px;color:{T['gold']};white-space:nowrap;"><strong>DAY {day:02d}</strong> <span style="color:{T['muted']};">/ {total}</span></td>
    </tr></tbody></table>
  </td></tr>

  <!-- 슬림 히어로 -->
  <tr><td style="background:{T['dark']};background-image:linear-gradient(160deg,{T['darkcard']} 0%,{T['dark']} 55%,{T['dark2']} 100%);padding:20px 22px 22px;text-align:center;border-top:1px solid {T['gold']};">
    <p style="margin:0 0 5px;font-family:'Playfair Display',serif;font-style:italic;font-size:22px;color:#FAFAF7;line-height:1.25;">Harry Potter and the <span style="color:{T['gold']};">Sorcerer&rsquo;s</span> Stone</p>
    <p style="margin:0;font-family:'EB Garamond',serif;font-size:11px;letter-spacing:1px;color:{T['muted']};">Chapter {esc(ch['no'])} &middot; {esc(ch['title_en'])} &middot; J.K. Rowling, 1997</p>
  </td></tr>

  <!-- Day·시즌 바 -->
  <tr><td style="background:{T['paper']};border-bottom:1px solid {T['line']};padding:11px 26px;">
    <table border="0" cellpadding="0" cellspacing="0" width="100%"><tbody><tr>
      <td style="font-family:'EB Garamond',serif;font-size:10px;color:{T['muted2']};letter-spacing:1.5px;width:40%;">Day {day:02d} &middot; {esc(pack.get('season',''))}</td>
      <td align="center" style="font-size:10px;color:{T['gold']};">✦</td>
      <td align="right" style="font-family:'EB Garamond',serif;font-style:italic;font-size:11px;color:{T['gold']};">완독 클럽 · 자동 발행</td>
    </tr></tbody></table>
  </td></tr>

  <!-- 인트로 + 히어로 삽화 -->
  <tr><td style="background:{T['paper']};padding:24px 20px 8px;text-align:center;">
    {hero_slot}
    <p class="mob-txt" style="margin:0;font-size:13px;line-height:2.0;color:{T['ink']};font-weight:300;">{esc(pack['intro'])}</p>
  </td></tr>

{media_row('&#9654;', '📽️ 오늘을 여는 스토리 영상', story_video.get('desc','오늘의 함께 읽기'), story_video.get('url'), f"Day{day:02d} 준비 중")}

  <!-- 챕터/페이지 배지 -->
  <tr><td class="body-pad" style="background:{T['paper']};padding:12px 20px 0;">
    <table border="0" cellpadding="0" cellspacing="0" style="background:{T['dark']};border-left:3px solid {T['gold']};width:100%;" width="100%"><tbody><tr>
      <td style="padding:14px 16px;vertical-align:middle;width:36%;text-align:center;"><span style="background:{T['gold']};color:{T['dark']};font-family:'EB Garamond',serif;font-size:9px;letter-spacing:1px;text-transform:uppercase;padding:5px 12px;font-weight:600;display:inline-block;white-space:nowrap;">📖 {esc(pack['pages'])}</span></td>
      <td style="padding:14px 16px 14px 0;vertical-align:middle;">
        <p style="margin:0;font-family:'EB Garamond',serif;font-style:italic;font-size:13px;color:{T['gold']};line-height:1.6;text-align:left;"><strong style="color:{T['paper']};font-style:normal;">{esc(ch['title_en'])}</strong><br><strong style="color:{T['goldbright']};">{esc(ch['title_ko'])}</strong></p>
      </td>
    </tr></tbody></table>
  </td></tr>

  <!-- 오늘의 스토리 · 장면 요약 -->
  <tr><td class="body-pad" style="background:{T['paper']};padding:16px 20px 0;">
    <table border="0" cellpadding="0" cellspacing="0" style="background:{T['dark']};border:1px solid {T['linesoft']};width:100%;" width="100%"><tbody>
      <tr><td style="height:1px;background:{T['gold']};font-size:1px;">&nbsp;</td></tr>
      <tr><td style="padding:26px 22px;">
        <p style="margin:0 0 20px;font-family:'EB Garamond',serif;font-size:15px;letter-spacing:2px;color:{T['gold']};"><strong>✦ 오늘의 스토리 &middot; 장면 요약</strong></p>
{scenes}
      </td></tr>
    </tbody></table>
  </td></tr>

  <!-- 오늘의 한 문장 -->
  <tr><td class="body-pad" style="background:{T['paper']};padding:16px 20px 0;">
    <table border="0" cellpadding="0" cellspacing="0" style="background:{T['dark2']};border:1px solid {T['linesoft']};width:100%;" width="100%"><tbody>
      <tr><td style="height:1px;background:{T['gold']};font-size:1px;">&nbsp;</td></tr>
      <tr><td style="padding:26px 22px;">
        <p style="margin:0 0 14px;font-family:'EB Garamond',serif;font-size:14px;letter-spacing:2px;color:{T['gold']};"><strong>✦ 오늘의 한 문장 &middot; Day {day:02d}</strong></p>
        <p class="mob-txt" style="margin:0 0 18px;font-family:'Playfair Display',serif;font-style:italic;font-size:16px;color:{T['light2']};line-height:1.9;"><span style="color:#E4CB80;border-bottom:1px solid {T['linesoft']};padding-bottom:1px;">&ldquo;{esc(pack['one_sentence']['en'])}&rdquo;</span></p>
        <p style="margin:0;font-family:'EB Garamond',serif;font-size:11px;color:{T['goldmuted']};letter-spacing:1px;"><strong>&mdash; {esc(pack['one_sentence']['source'])}</strong></p>
      </td></tr>
    </tbody></table>
  </td></tr>

  <!-- 한 줄 해석 -->
  <tr><td class="body-pad" style="background:{T['paper']};padding:12px 20px 0;">
    <table border="0" cellpadding="0" cellspacing="0" style="background:{T['cream']};border-top:2px solid {T['gold']};width:100%;" width="100%"><tbody><tr>
      <td style="padding:20px;">
        <p style="margin:0 0 10px;font-family:'EB Garamond',serif;font-size:12px;letter-spacing:2px;color:{T['dark']};"><strong>한 줄 해석</strong></p>
        <p class="mob-txt" style="margin:0;font-size:15px;line-height:1.8;color:{T['ink']};font-weight:400;">{esc(pack['one_line_translation'])}</p>
      </td>
    </tr></tbody></table>
  </td></tr>

  <!-- 구분 -->
  <tr><td style="background:{T['paper']};padding:24px 0;text-align:center;"><p style="margin:0;font-size:11px;letter-spacing:10px;color:#C8B79A;">✦ &middot; ✦</p></td></tr>

  <!-- 스텔라의 문장 읽기 -->
  <tr><td class="story-pad" style="background:{T['paper']};padding:0 20px 26px;">
    <p style="margin:0 0 16px;font-family:'EB Garamond',serif;font-size:13px;letter-spacing:2px;color:{T['dark']};border-left:3px solid {T['gold']};padding-left:12px;"><strong>스텔라의 문장 읽기</strong></p>
{reading}
  </td></tr>

{media_row('🎧', '✦ 스텔라의 3분 클래식 오디오', '이 문장 앞에서 제가 오래 머문 이야기를, 목소리로 함께 들어요', essay_audio, '3분 오디오 준비 중')}

  <!-- 1분 에세이 -->
  <tr><td style="background:{T['paper']};padding:12px 20px 16px;">
    <table border="0" cellpadding="0" cellspacing="0" style="border:1px solid {T['line']};width:100%;" width="100%"><tbody>
      <tr><td style="background:{T['dark']};padding:12px 20px;">
        <table border="0" cellpadding="0" cellspacing="0" width="100%"><tbody><tr>
          <td style="font-family:'EB Garamond',serif;font-size:12px;letter-spacing:1px;color:{T['gold']};"><strong>✦ 1분 에세이</strong></td>
          <td align="right" style="font-family:'Playfair Display',serif;font-style:italic;font-size:11px;color:{T['muted']};">왜 이 문장을 골랐나</td>
        </tr></tbody></table>
      </td></tr>
      <tr><td style="padding:20px;background:{T['paper']};">
{essay}
      </td></tr>
    </tbody></table>
  </td></tr>

  <!-- Today's Vocabulary -->
  <tr><td style="background:{T['paper']};padding:0 20px 18px;">
    <table border="0" cellpadding="0" cellspacing="0" style="border:1px solid {T['line']};width:100%;" width="100%"><tbody>
      <tr><td style="background:{T['dark']};padding:12px 20px;">
        <table border="0" cellpadding="0" cellspacing="0" width="100%"><tbody><tr>
          <td style="font-family:'EB Garamond',serif;font-size:10px;letter-spacing:1px;color:{T['gold']};"><strong>✦ Today&rsquo;s Vocabulary</strong></td>
          <td align="right" style="font-family:'Playfair Display',serif;font-style:italic;font-size:10.5px;color:{T['muted']};">Day {day:02d} &middot; {len(pack['vocab'])} words</td>
        </tr></tbody></table>
      </td></tr>
{vocab}
    </tbody></table>
  </td></tr>

  <!-- Day 티저 -->
  <tr><td style="background:{T['paper']};padding:0 20px 16px;">
    <table border="0" cellpadding="0" cellspacing="0" style="background:{T['cream']};border-width:1px 1px 1px 3px;border-style:solid;border-color:{T['linedash']} {T['linedash']} {T['linedash']} {T['gold']};width:100%;" width="100%"><tbody><tr>
      <td style="padding:16px 20px;vertical-align:middle;"><span style="display:inline-block;background:{T['dark']};color:{T['goldbright']};font-size:10px;padding:4px 8px;margin-bottom:8px;border-radius:2px;"><strong>Day {pack['teaser']['day']:02d}</strong></span>
        <p class="mob-txt" style="margin:0;font-size:14px;color:#463620;line-height:1.7;">{esc(pack['teaser']['text'])}</p>
      </td>
    </tr></tbody></table>
  </td></tr>

  <!-- 야나완 CTA -->
  <tr><td style="background:{T['paper']};padding:0 20px 30px;">
    <table border="0" cellpadding="0" cellspacing="0" style="background:{T['dark']};border:1px solid {T['linesoft']};border-radius:4px;width:100%;" width="100%"><tbody><tr>
      <td style="padding:20px;vertical-align:middle;text-align:center;">
        <p style="margin:0 0 8px;font-size:15px;color:{T['paper']};font-weight:bold;">🏆 해리포터 완독 클럽 &middot; 원서 100일 완독 도전</p>
        <p style="margin:0 0 12px;"><a href="https://cafe.naver.com/literenglish" style="font-size:13px;color:#F0D98A;text-decoration:none;">(야, 나도 원서 완독할 수 있어! 완독 클럽 🔗)</a></p>
        <p style="margin:0;font-size:13px;color:{T['muted']};line-height:1.6;"><strong style="color:{T['light']};">100일 완독하면?</strong><br><strong style="color:{T['paper']};">완독 수료 + 다음 권 완독 클럽 특별 할인</strong></p>
      </td>
    </tr></tbody></table>
  </td></tr>

  <!-- footer -->
  <tr><td style="background:{T['dark']};padding:28px 20px 24px;text-align:center;border-top:1px solid {T['linesoft']};">
    <table align="center" border="0" cellpadding="0" cellspacing="0" style="margin:0 auto 12px;"><tbody>
      <tr><td align="center" style="padding-bottom:8px;"><img src="{LOGO_FOOT_SYMBOL}" width="30" height="30" alt="Liter Stella" style="display:block;width:30px;height:30px;border:0;"></td></tr>
      <tr><td align="center"><img src="{LOGO_FOOT_TEXT}" width="80" alt="리터스텔라" style="display:block;width:80px;max-width:80px;height:auto;border:0;"></td></tr>
    </tbody></table>
    <p style="margin:0;font-size:11px;line-height:1.8;color:{T['muted']};">&copy; 2026 Liter Stella &middot; literstella.co.kr<br><a href="https://literstella.stibee.com/" style="color:{T['muted']};text-decoration:none;">뉴스레터 이메일 구독</a></p>
  </td></tr>

</tbody></table>
</td></tr></tbody></table>

<table border="0" cellpadding="0" cellspacing="0" width="100%" style="background:{T['page']};"><tr><td align="center" style="padding:24px 16px 40px;">
  <p style="margin:0;font-size:10px;color:{T['muted2']};line-height:1.7;text-align:center;">자료는 모두 스텔라의 원서 강독을 기반으로 제작되었습니다.<br>영어 인용은 강의에서 함께 읽은 문장에 한합니다. AI 학습 과정에서 가벼운 오류가 있을 수 있습니다.</p>
</td></tr></table>

</body>
</html>'''


def main():
    src, out = sys.argv[1], sys.argv[2]
    pack = json.load(open(src, encoding="utf-8"))
    doc = render(pack)
    # 하드닝 검증
    assert "rgba(" not in doc, "rgba() 발견 — Outlook 폴백 위험"
    hits = [w for w in BANNED if w in doc]
    assert not hits, f"금지어 {hits}"
    os.makedirs(os.path.dirname(out), exist_ok=True)
    open(out, "w", encoding="utf-8").write(doc)
    print(f"✅ {out}  ({len(doc):,} bytes)  rgba 0 · 금지어 0 · 640px 테이블 · solid hex")


if __name__ == "__main__":
    main()
