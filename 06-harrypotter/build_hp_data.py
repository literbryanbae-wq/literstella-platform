# -*- coding: utf-8 -*-
r"""HP 완독클럽 앱 데이터 빌드 — content-packs + 미디어(유튜브·삽화·오디오·워크북단어) → public/hp1/day-N.json.
정본=content-packs(04-platform-docs). 이 앱은 그 렌더. 저작권: 영어=one_sentence 1문장 + 워크북 단어(헤드워드).
"""
import os, io, sys, json, shutil, re

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
HERE = os.path.dirname(os.path.abspath(__file__))
CP = r"E:\LiterStella Project\LiterStella-DEV\04-platform-docs\docs\newsletter\content-packs"
AUDIO_SRC = r"E:\LiterStella_전사\audio_out"
OUT = os.path.join(HERE, "public", "hp1")                       # 프로토타입 앱(06-harrypotter)
# 🔴 라이브 소스 = 챌린지앱 public/hp1 (커밋·배포됨). 빌더가 여기에 직접 쓴다(수동 cp 금지).
WT_OUT = r"E:\LiterStella Project\LiterStella-DEV\02-challenge\stella-reader-wt\public\hp1"
R2 = "https://pub-f4c490e22e384c7e9b95fc9648cb5f4c.r2.dev"

# ⚠️ 파일 소유권 — 이 빌더는 **day-N.json / index.json 만** 쓴다. 아래는 다른 세션 소유라 절대 건드리지 않는다:
#   • day-N.tr.json        = 번역 세션(영어 번역). ⚠️ 원작 번역이 아니라 우리 재서술·해설의 English retelling/commentary.
#   • day-N.transcript.json = 오디오 전사 세션(싱크 자막).
#   과거 `cp public/hp1/*.json` 로 일괄 복사하다가 남의 tr.json을 낡은 사본으로 덮을 뻔함 → 그래서 개별 파일만 기록.

# 실제 per-day 강독 전체(VOD) — content-pack free_reading_video는 4일 전부 day1로 복붙된 오류라 여기 정본 매핑 사용.
VOD = {1: "KInBE69u4aw", 2: "1VUXF4n6HdE", 3: "NFVkSu9U0Xo", 4: "uei1JnLI6Xg", 5: "6seMq5njD4M"}


def _ytid(url):
    m = re.search(r"(?:youtu\.be/|v=)([\w-]+)", str(url or ""))
    return m.group(1) if m else None
# Day01 워크북 단어(354p 완독워크북 Ch1 큐레이션). 다른 Day는 content-pack vocab 폴백.
WB_VOCAB = {
    1: [
        {"w": "crane", "pos": "동", "ko": "(더 잘 보려고) 목을 길게 빼다", "note": "'크레인·학'에서 온 동사. 목이 긴 학을 떠올리면 뜻이 연상돼요."},
        {"w": "beefy", "pos": "형", "ko": "우람한, 뚱뚱한", "note": "'beef(소고기)'를 떠올려 보세요. fat보다 이미지가 선명하죠."},
        {"w": "shudder", "pos": "동", "ko": "몸서리치다", "note": "생각만 해도 끔찍할 때."},
        {"w": "dull", "pos": "형", "ko": "흐린, 우중충한", "note": "'dull, gray weather'처럼 날씨에 자주 붙여 씁니다."},
        {"w": "wrestle", "pos": "동", "ko": "낑낑대며 씨름하다", "note": "떼쓰는 아기를 의자에 앉히려 낑낑대는 모습."},
        {"w": "tantrum", "pos": "명", "ko": "(아이가) 성질 부림", "note": "'have a tantrum'으로 통째 외우기."},
        {"w": "peculiar", "pos": "형", "ko": "이상한, 특이한", "note": "'something peculiar'처럼 -thing 명사는 형용사를 뒤에."},
        {"w": "jerk", "pos": "동", "ko": "휙 움직이다", "note": "원서엔 동작 동사가 다양해요."},
    ],
}


def has_audio(day):
    return os.path.exists(os.path.join(AUDIO_SRC, f"hp1-day{day:02d}-essay.mp3"))


def build_day(day):
    o = json.load(open(os.path.join(CP, f"hp1-day{day:02d}.json"), encoding="utf-8"))
    ch = o["chapter"]
    reading = [x for x in o["sentence_reading"] if isinstance(x, str)]
    pull = next((x["pullquote"] for x in o["sentence_reading"] if isinstance(x, dict) and x.get("pullquote")), None)
    vocab = WB_VOCAB.get(day) or [{"w": v["word"], "pos": "", "ko": v["meaning"], "note": ""} for v in o["vocab"]]
    media = o.get("media", {})
    story_id = _ytid((media.get("story_video") or {}).get("url"))   # 3분 스토리 영상(유튜브)
    return {
        "day": day, "pages": o["pages"], "chapterNo": ch["no"], "chapterKo": ch["title_ko"],
        # 페이지 미디어 = 3분 스토리 영상 + 스텔라 3분 오디오(R2). 65분 VOD 강독은 하단 '전체 보기' 링크로만.
        "storyVideoId": story_id, "youtubeId": story_id,   # youtubeId 자리에도 스토리영상(구 VOD 임베드 대체)
        "vodId": VOD.get(day),                             # 무료 강독 전체(원천 VOD)
        "illustration": f"{R2}/illust/hp-nl/day{day:02d}_hero.png",
        "audioUrl": f"{R2}/hp1/day{day:02d}.mp3", "isOriginalVoice": False,   # 스텔라 PVC 3분(R2)
        "intro": o["intro"],
        "scenes": [{"no": s["no"], "title": s["title"], "body": s["body"], "after": s.get("after", "")} for s in o["scenes"]],
        "sentenceEn": o["one_sentence"]["en"], "sentenceKo": o["one_line_translation"], "source": o["one_sentence"]["source"],
        "readingTitle": "스텔라의 문장 읽기", "reading": reading, "pullquote": pull,
        "essay": o["essay"], "vocab": vocab,
        "teaser": o["teaser"],
    }


def write_both(obj, name):
    """day-N.json / index.json 만 두 곳(프로토타입 + 라이브 챌린지)에 기록. 남의 파일은 안 건드림."""
    for root in (OUT, WT_OUT):
        os.makedirs(root, exist_ok=True)
        json.dump(obj, open(os.path.join(root, name), "w", encoding="utf-8"), ensure_ascii=False, indent=1)


def main():
    os.makedirs(OUT, exist_ok=True)
    days = []
    for d in range(1, 5):   # day01~04 (스텔라 3분 오디오 완성분)
        obj = build_day(d)
        # 저작권 감사: 영어 문장은 one_sentence 1개 + 단어 헤드워드만(재서술 영어문장 금지)
        blob = " ".join([obj["intro"]] + [s["body"] + s["after"] for s in obj["scenes"]] + obj["reading"] + obj["essay"])
        stray = re.findall(r'[A-Z][A-Za-z ,\']{18,}[.!?]', blob)
        assert not stray, f"Day{d} 재서술에 영어문장 혼입: {stray[:2]}"
        write_both(obj, f"day-{d}.json")
        days.append({"day": d, "pages": obj["pages"], "sentenceEn": obj["sentenceEn"],
                     "hasAudio": bool(obj["audioUrl"]), "illustration": obj["illustration"]})
    write_both({"book": "해리포터와 마법사의 돌", "bookEn": "Harry Potter and the Sorcerer's Stone",
                "author": "J.K. Rowling", "totalDays": 100, "days": days}, "index.json")
    print(f"✅ {len(days)}일치 → {OUT}\n              → {WT_OUT} (라이브)")

    # ── EN 사이드카 동기화 (번역 세션 지시 A, 2026-07-15) ──
    #   정본 = 챌린지 public/hp1(번역 세션이 커밋). 이 빌더는 만들지 않고 '챌린지 → 프로토타입'으로 복사만.
    #   조용한 실패 방지: 로더가 404를 삼켜 EN 토글/자막이 소리 없이 사라지므로, 없으면 [WARN] 출력.
    synced, missing = 0, []
    for n in [d["day"] for d in days]:
        for suf in ("tr.json", "transcript.tr.json"):
            name = f"day-{n}.{suf}"
            src = os.path.join(WT_OUT, name)
            if os.path.exists(src):
                shutil.copy(src, os.path.join(OUT, name)); synced += 1
            else:
                missing.append(name)
    print(f"   EN 사이드카 동기화(챌린지→프로토타입): {synced}개 복사" + (f" · ⚠️ 누락 {missing}" if missing else ""))
    if missing:
        print(f"   [WARN] 위 사이드카 없음 → 독립 앱에서 EN 토글/자막이 조용히 사라짐. 번역 세션에 통지 필요.")
    for d in days:
        print(f"   Day{d['day']} p.{d['pages']} audio={'O' if d['hasAudio'] else '-'}")


if __name__ == "__main__":
    main()
