# -*- coding: utf-8 -*-
r"""HP1 '오늘의 조각' 웹 페이지 렌더러 — 콘텐츠팩 JSON + 워크북 단어 + 미디어 → 리치 HTML 페이지.
이메일 뉴스레터와 달리 웹 페이지라: 유튜브 임베드·오디오 플레이어·큰 삽화·풍부한 워크북 단어 섹션 가능.
정본=JSON. 영어 <10%(교육용 taught quote만). 금지어 스캔.
  python nl_page_hp.py content-packs/hp1-day01.json out/hp1-day01.page.html
"""
import os, io, sys, json, html, re

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
BANNED = ["완주", "여정", "대장정", "도반", "전액기부"]

# Day01 워크북(354p 완독 워크북 Ch1, LiterStella 자산)에서 큐레이션한 단어·표현.
# 영어=단어만(예문 산문 재현 최소화), 뜻·해설=한국어(워크북 근거).
WORKBOOK_VOCAB = {
    1: [
        {"w": "crane", "pos": "동", "ko": "(무엇을 더 잘 보려고) 몸이나 목을 길게 빼다",
         "note": "명사 '크레인·학'에서 온 동사예요. 위로 길게 올라간 크레인, 목이 긴 학을 떠올리면 '목을 길게 빼다'라는 뜻이 잘 연상됩니다. 이모의 목이 유난히 길다는 묘사와 딱 어울려요."},
        {"w": "beefy", "pos": "형", "ko": "우람한, 뚱뚱한",
         "note": "'beef(소고기)'를 떠올려 보세요. 고깃덩어리처럼 살이 붙은 뚱뚱한 모습. 그냥 'fat'보다 훨씬 이미지가 선명하죠."},
        {"w": "shudder", "pos": "동", "ko": "몸서리치다, 진저리치다",
         "note": "생각만 해도 끔찍할 때. 더즐리 부부가 포터네 이야기가 나올까 봐 몸서리치는 장면."},
        {"w": "dull", "pos": "형", "ko": "흐린, 구름이 잔뜩 낀",
         "note": "'dull, gray weather(흐리고 우중충한 날씨)'처럼 날씨에 자주 붙여 씁니다. 꼭 함께 기억하세요."},
        {"w": "wrestle", "pos": "동", "ko": "몸싸움을 벌이다; 낑낑대며 씨름하다",
         "note": "떼쓰는 아기 더들리를 아기 의자에 앉히려 낑낑대는 모습. 동작이 눈앞에 그려지죠."},
        {"w": "tantrum", "pos": "명", "ko": "(아이가) 성질을 부림",
         "note": "'have a tantrum'으로 통째로 외우세요. 'have'가 너무 쉬워 보여 빠뜨리기 쉬운데, 이런 동사 짝을 함께 알아야 문장이 나옵니다."},
        {"w": "peculiar", "pos": "형", "ko": "이상한, 특이한",
         "note": "'something peculiar'처럼 -thing이 붙은 명사는 꾸미는 형용사를 '뒤'에 둡니다. 앞으로 계속 나오니 기억해 두면 좋아요."},
        {"w": "jerk", "pos": "동", "ko": "휙 움직이다",
         "note": "원서엔 동작을 나타내는 동사가 참 다양하게 나와요. 이 단어도 그중 하나. 뒤에 어떻게 연결되는지 보면 해석이 어렵지 않습니다."},
    ],
}


def esc(s):
    return html.escape(str(s or ""), quote=False)


def paras(items):
    out = []
    for it in items:
        if isinstance(it, dict) and it.get("pullquote"):
            out.append(f'<blockquote class="pull">{esc(it["pullquote"])}</blockquote>')
        else:
            out.append(f'<p>{esc(it)}</p>')
    return "\n".join(out)


def render(pack, vocab, media):
    d = pack["day"]; ch = pack["chapter"]; total = pack["book"]["total_days"]
    yt = media.get("youtubeId")
    hero = media.get("hero")
    audio = media.get("audio")

    # 페이지는 영어 <10% 목표 → 장면은 우리말 재서술만(영어 인용은 '오늘의 한 문장' 1개 + 단어로 한정)
    scenes = "\n".join(
        f'<div class="scene"><h4>Scene {s["no"]} · {esc(s["title"])}</h4><p>{esc(s["body"])}</p>'
        + (f'<p>{esc(s["after"])}</p>' if s.get("after") else '') + '</div>'
        for s in pack["scenes"])

    vocab_cards = "\n".join(
        f'<div class="vcard"><div class="vhead"><b class="w">{esc(v["w"])}</b>'
        f'<span class="pos">{esc(v["pos"])}</span></div><div class="vko">{esc(v["ko"])}</div>'
        f'<div class="vnote">{esc(v["note"])}</div></div>'
        for v in vocab)

    yt_block = (
        f'<section class="media"><h3>🎬 오늘의 강독 · 유튜브 무료</h3>'
        f'<div class="ytwrap"><iframe src="https://www.youtube-nocookie.com/embed/{esc(yt)}" '
        f'title="강독" frameborder="0" allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture" '
        f'allowfullscreen></iframe></div></section>' if yt else '')

    audio_block = (
        f'<section class="media"><h3>🎧 스텔라의 해설 오디오</h3>'
        + (f'<audio controls preload="none" src="{esc(audio)}" style="width:100%"></audio>'
           if audio else '<div class="soon">🎧 해설 오디오 준비 중 (성우 클론 재설정 대기)</div>')
        + '</section>')

    return f'''<!doctype html>
<html lang="ko"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>해리포터 1권 완독 · Day {d:02d} · 리터스텔라</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@300;500;700&family=Noto+Sans+KR:wght@300;400;500;700&family=Playfair+Display:ital@0;1&display=swap" rel="stylesheet">
<style>
  :root{{--maroon:#3B141A;--gold:#C89D3E;--gold2:#a8842f;--ink:#241a12;--muted:#7a6a58;--paper:#fbf7ef;--card:#fff;--line:#ece2d0;--coral:#c0492f}}
  *{{box-sizing:border-box}} body{{margin:0;background:var(--paper);color:var(--ink);font-family:'Noto Sans KR',sans-serif;line-height:1.75}}
  .wrap{{max-width:760px;margin:0 auto;background:var(--card);box-shadow:0 1px 40px rgba(59,20,26,.08)}}
  .hero{{position:relative;aspect-ratio:16/10;overflow:hidden;background:var(--maroon)}}
  .hero img{{width:100%;height:100%;object-fit:cover;display:block}}
  .hero .tag{{position:absolute;left:0;top:0;padding:10px 16px;background:linear-gradient(180deg,rgba(59,20,26,.85),transparent);color:#f5e6c8;font-size:12px;letter-spacing:3px}}
  .head{{padding:26px 28px 6px}}
  .kick{{color:var(--gold2);font-size:12px;letter-spacing:3px;font-weight:700}}
  h1{{font-family:'Playfair Display',serif;font-style:italic;font-size:26px;margin:6px 0 2px;color:var(--maroon)}}
  .sub{{color:var(--muted);font-size:13px}}
  .body{{padding:8px 28px 30px}}
  h3{{font-family:'Noto Serif KR',serif;color:var(--maroon);font-size:17px;border-bottom:2px solid var(--gold);display:inline-block;padding-bottom:4px;margin:30px 0 12px}}
  h4{{color:var(--coral);font-size:14px;margin:16px 0 4px}}
  p{{font-size:15.5px;margin:0 0 12px}}
  .intro{{font-size:15.5px;color:#3a2e1e;text-align:center;padding:18px 6px 4px}}
  .qt{{font-family:'Playfair Display',serif;font-style:italic;color:#6b4a3a;border-left:3px solid var(--gold);padding:4px 14px;margin:8px 0}}
  .onecard{{background:var(--maroon);color:#f5efe4;border-radius:14px;padding:22px 20px;margin:14px 0}}
  .onecard .en{{font-family:'Playfair Display',serif;font-style:italic;font-size:18px;line-height:1.7;color:#f0d98a}}
  .onecard .ko{{margin-top:10px;font-size:14px;color:#e7dcc8}}
  .onecard .src{{margin-top:10px;font-size:11px;color:#b79b6a}}
  .pull{{font-family:'Noto Serif KR',serif;background:#f7efe0;border-left:3px solid var(--gold);margin:14px 0;padding:14px 16px;color:#5a4326;font-size:15px}}
  .media{{margin:24px 0}} .ytwrap{{position:relative;aspect-ratio:16/9;border-radius:12px;overflow:hidden;background:#000}}
  .ytwrap iframe{{position:absolute;inset:0;width:100%;height:100%}}
  .soon{{background:#f3ece0;border:1px dashed var(--gold);border-radius:12px;padding:18px;text-align:center;color:var(--muted);font-size:13px}}
  .vgrid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}}
  .vcard{{background:#fbf6ec;border:1px solid var(--line);border-radius:12px;padding:14px 16px}}
  .vhead{{display:flex;align-items:baseline;gap:8px}} .vcard .w{{font-family:'Playfair Display',serif;font-style:italic;font-size:19px;color:var(--maroon)}}
  .vcard .pos{{font-size:11px;color:#fff;background:var(--gold2);border-radius:20px;padding:1px 8px}}
  .vcard .vko{{font-weight:700;margin:4px 0;font-size:14.5px}} .vcard .vnote{{font-size:13.5px;color:#5a4c3a;line-height:1.7}}
  .teaser{{background:#f7efe0;border-left:3px solid var(--gold);border-radius:0 10px 10px 0;padding:14px 16px;margin:24px 0}}
  .teaser b{{color:var(--maroon)}}
  .cta{{background:var(--maroon);color:#fff;border-radius:14px;padding:22px;text-align:center;margin:24px 0}}
  .cta a{{color:#f0d98a;text-decoration:none;font-weight:700}}
  .foot{{padding:24px 28px 40px;text-align:center;color:var(--muted);font-size:11.5px;border-top:1px solid var(--line)}}
  @media(max-width:520px){{h1{{font-size:22px}} .body,.head{{padding-left:18px;padding-right:18px}}}}
</style></head>
<body><div class="wrap">
  {'<div class="hero"><span class="tag">DAY '+f'{d:02d} / {total}'+'</span><img src="'+esc(hero)+'" alt="'+esc(ch['title_ko'])+'"></div>' if hero else ''}
  <div class="head">
    <div class="kick">해리포터 완독 · 무료 공개</div>
    <h1>Harry Potter and the Sorcerer&rsquo;s Stone</h1>
    <div class="sub">Chapter {esc(ch['no'])} &middot; {esc(pack['pages'])} &middot; J.K. Rowling, 1997</div>
  </div>
  <div class="body">
    <p class="intro">{esc(pack['intro'])}</p>
    {yt_block}
    <h3>오늘의 스토리</h3>
    {scenes}
    <div class="onecard"><div class="en">&ldquo;{esc(pack['one_sentence']['en'])}&rdquo;</div>
      <div class="ko">{esc(pack['one_line_translation'])}</div>
      <div class="src">&mdash; {esc(pack['one_sentence']['source'])}</div></div>
    <h3>스텔라의 문장 읽기</h3>
    {paras(pack['sentence_reading'])}
    {audio_block}
    <h3>1분 에세이 · 왜 이 문장을 골랐나</h3>
    {paras(pack['essay'])}
    <h3>📖 워크북 단어 &middot; 표현</h3>
    <p style="color:var(--muted);font-size:13px;margin-top:-4px">리터스텔라 완독 워크북에서 오늘 페이지의 핵심 표현만 골랐어요.</p>
    <div class="vgrid">{vocab_cards}</div>
    <div class="teaser"><b>Day {pack['teaser']['day']:02d} 예고</b><br>{esc(pack['teaser']['text'])}</div>
    <div class="cta">🏆 해리포터 완독 클럽 &middot; 원서 100일 완독 도전<br>
      <a href="https://cafe.naver.com/literenglish">야, 나도 원서 완독할 수 있어 &rarr;</a></div>
  </div>
  <div class="foot">&copy; 2026 Liter Stella &middot; 자료는 스텔라의 원서 강독과 완독 워크북을 기반으로 제작. 영어 인용은 강의에서 함께 읽은 문장에 한합니다.</div>
</div></body></html>'''


def main():
    src, out = sys.argv[1], sys.argv[2]
    pack = json.load(open(src, encoding="utf-8"))
    d = pack["day"]
    media = {
        "youtubeId": {1: "KInBE69u4aw", 2: "1VUXF4n6HdE", 3: "NFVkSu9U0Xo", 4: "uei1JnLI6Xg", 5: "6seMq5njD4M"}.get(d),
        "hero": f"https://pub-f4c490e22e384c7e9b95fc9648cb5f4c.r2.dev/illust/hp-nl/day{d:02d}_hero.png",
        "audio": f"hp1-day{d:02d}-essay.mp3" if os.path.exists(os.path.join(os.path.dirname(out), f"hp1-day{d:02d}-essay.mp3")) else None,
    }
    doc = render(pack, WORKBOOK_VOCAB.get(d, pack["vocab"] and [{"w": v["word"], "pos": "", "ko": v["meaning"], "note": ""} for v in pack["vocab"]]), media)
    hits = [w for w in BANNED if w in doc]
    if hits:
        print(f"[!] 금지어 {hits}"); sys.exit(1)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    open(out, "w", encoding="utf-8").write(doc)
    en = len(re.findall(r'[A-Za-z]', doc)); ko = len(re.findall(r'[가-힣]', doc))
    print(f"✅ {out} ({len(doc):,}B) · 영어글자 {en} / 한글 {ko} = 영어비 {en/(en+ko)*100:.1f}% · 금지어 0")


if __name__ == "__main__":
    main()
