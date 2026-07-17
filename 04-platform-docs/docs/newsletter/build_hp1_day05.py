# -*- coding: utf-8 -*-
r"""HP1 뉴스레터 Day05 콘텐츠팩 생성 (vol1 코퍼스 기반, 강의 100%·원문 미제공).

운영자 지시(2026-07-11): 영어 축소하지 말고 키다리처럼 강의 스크립트에 근거해 제작, '원문(연속 산문)'만 제공 안 함.
  → 스텔라가 강의에서 실제로 짚어 읽은 '개별 문장'은 인용 가능(출처 표기). Day01~04와 동일한 밀도.
  → 금지 = 원문 연속 산문 전재(textEn 통짜 블록). 그래서 각 인용은 '전사에 실재' + '문장 길이(≤25어절)'로 강제.
소재: vol1 #6 (6seMq5njD4M, p.13~15). 하드가드로 모든 영어 인용을 전사에 대조.
"""
import os, io, sys, json, re

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "content-packs")
TRANSCRIPT = r"E:\LiterStella_전사\hp\vol1\transcripts\006_6seMq5njD4M.json"
BANNED = ["완주", "여정", "대장정", "도반", "전액기부"]
MAX_QUOTE_WORDS = 25  # 개별 문장까지만. 이보다 길면 '원문 산문 전재'로 간주해 차단.

BOOK = json.load(open(os.path.join(OUT, "hp1-day01.json"), encoding="utf-8"))["book"]

DAY = {
    "day": 5, "pages": "p.13-15", "season": "Spring 2026",
    "chapter": {"no": "I", "title_en": "The Boy Who Lived", "title_ko": "이야기의 절정 — 문간에 놓인 아기"},
    "intro": "프리벳가의 신비로운 밤이 절정으로 향합니다. 밤하늘에서 굉음과 함께, 거인 해그리드가 아기를 품에 안고 내려옵니다. 해리포터와 마법사의 돌 다섯 번째 이야기 — 오늘, 한 아기의 운명이 낡은 집 문간에 조용히 놓입니다.",
    "scenes": [
        {"no": 1, "title": "늦는 손님, 하늘에서 온 오토바이",
         "body": "덤블도어는 바늘이 열두 개나 달렸지만 숫자는 하나도 없는 기묘한 시계를 꺼내 들여다봅니다. 우리 눈에는 도무지 읽을 수 없는 시계인데도 그에게는 아무 문제가 없어요. 시계를 도로 주머니에 넣으며 한마디 합니다.",
         "quote": "Hagrid's late.",
         "after": "맥고나걸 교수가 '하필이면 왜 여기냐'며 떠보듯 묻는 바로 그 순간, 어두운 밤하늘에서 커다란 엔진 소리가 울려 퍼집니다."},
        {"no": 2, "title": "\"이 사람들에게 아기를 맡긴다고요?\"",
         "body": "굉음의 정체는 하늘을 나는 오토바이. 거인 해그리드가 담요에 싼 아기를 품에 안고 사뿐히 내려옵니다.",
         "quote": "I've come to bring Harry to his aunt and uncle.",
         "after": "부모를 잃은 아기 해리를, 하나 남은 혈육인 이모네 — 바로 이 프리벳가 4번지에 맡기려는 것이죠. 맥고나걸 교수는 펄쩍 뜁니다. 하루 종일 이 집 사람들을 지켜봤는데, 우리 마법 세계와 이보다 더 안 어울리는 사람들은 찾을 수 없다고요. 하지만 덤블도어는 차분합니다. 그 모든 관심과 명성에서 멀리 떨어져 평범하게 자라는 편이 훗날 이 아이에게 얼마나 더 나을지 생각해 보라고 말하죠."},
        {"no": 3, "title": "번개 모양 흉터, 그리고 눈물의 작별",
         "body": "담요 안에서 곤히 잠든 아기의 이마에는, 번개 모양의 상처가 또렷이 새겨져 있습니다. 맥고나걸이 '저게 바로 그…?' 하고 속삭이자 덤블도어가 고개를 끄덕입니다. 아기를 문간에 내려놓고 돌아서야 하는 순간, 덩치 큰 해그리드는 울음을 터뜨려요.",
         "quote": "Hagrid let out a howl.",
         "after": "상처 입은 짐승처럼 울부짖는 거예요. 릴리와 제임스를 잃은 슬픔을, 그는 도무지 견딜 수가 없거든요."},
    ],
    "one_sentence": {"en": "He will have that scar forever.",
                      "source": "Harry Potter and the Sorcerer's Stone, Chapter I · p.13–15"},
    "one_line_translation": "그 아이는 그 흉터를 평생 갖고 살아가게 될 거예요.",
    "sentence_reading": [
        "스텔라 선생님이 강의에서 '짧은 문장인데 너무 중요하다'고 콕 짚은 대목이에요. 겨우 다섯 단어짜리 문장이지만, 이 흉터 하나가 앞으로 펼쳐질 이야기 전체를 짊어집니다.",
        "흉터(scar)는 단순한 상처가 아니라, 그날 밤 무슨 일이 있었는지를 말없이 증언하는 표식이에요. 아기는 기억조차 못 하는 일 때문에 이미 유명해졌고, 그 증거를 이마에 새긴 채 평범한 이모네 집 문간에 놓입니다.",
        {"pullquote": "기억하지 못하는 일 때문에 유명해진 아이 — 그 아이러니가 이 한 문장에 응축돼 있습니다."},
        "will have … forever. 미래를 여는 will과 '영원히'라는 forever가 만나, 시간의 무게가 문장에 얹힙니다. 짧은 문장일수록 단어 하나하나가 더 또렷하게 울린다는 걸 이 문장이 보여줘요.",
    ],
    "essay": [
        "세상 모두가 축배를 드는 밤, 정작 그 주인공은 자기에게 무슨 일이 일어났는지도 모른 채 담요에 싸여 잠들어 있습니다. 부모의 사랑도, 마법 세계의 환호도 아직 기억하지 못한 채로요.",
        "덤블도어가 아기를 굳이 평범한 머글 집에 맡기는 이유가 여기 있습니다. 넘치는 관심과 명성 속에서 자라는 것이 오히려 아이를 망칠 수 있다는 것 — 진짜 지혜는 화려함이 아니라 이런 절제에서 나오는 것 아닐까요.",
        "거인 해그리드가 상처 입은 짐승처럼 우는 장면에서, 우리는 이 이야기가 마냥 밝기만 한 동화가 아님을 예감합니다. 큰 슬픔 위에서 시작되기에, 앞으로의 모험이 더 값지게 다가옵니다.",
    ],
    "vocab": [
        {"word": "of all places", "meaning": "(그 많은 곳 중에) 하필이면 왜 여기서"},
        {"word": "fast asleep", "meaning": "깊이 잠든, 곤히 잠든"},
        {"word": "howl", "meaning": "(짐승·바람이) 울부짖다; 울부짖는 소리"},
    ],
    "teaser": {"day": 6, "text": "드디어 챕터 1이 끝납니다. 온 마법 세계가 잔을 높이 들어 외칩니다 — 그런데 정작 그 주인공은 낡은 집 문간에서 곤히 잠들어 있죠. '살아남은 아이'를 향한 축배의 밤."},
    "media": {
        "free_reading_video": {"desc": "리터스텔라 해리포터 원서 함께 읽기 · Day 5 (p.13~15)",
                                "url": "https://youtu.be/6seMq5njD4M"},
    },
    "_mediaTodo": ["hero_illust(삽화·SDXL)", "essay_audio(3분 에세이 오디오·Fish 스텔라 클론+BGM)",
                   "story_video(운영자 3분 스토리 영상)", "pdf(Day05 PDF)"],
    "_source": "vol1 #6 (6seMq5njD4M, p.13~15) · one_sentence 1921~1965s (스텔라 '짧은데 너무 중요' 강조)",
    "_generatedFrom": "corpus (강의 100%·원문 연속산문 미제공; 인용은 스텔라가 강의에서 읽은 개별 문장, 전부 전사 대조)",
}


def collect(v, acc):
    if isinstance(v, str): acc.append(v)
    elif isinstance(v, dict): [collect(x, acc) for k, x in v.items() if not k.startswith("_")]
    elif isinstance(v, list): [collect(x, acc) for x in v]


def all_english_quotes(day):
    q = [s["quote"] for s in day["scenes"] if s.get("quote")]
    q.append(day["one_sentence"]["en"])
    return q


def main():
    full = " ".join(s["text"] for s in json.load(open(TRANSCRIPT, encoding="utf-8"))["segments"])

    # ① 모든 영어 인용 = 전사에 실재(스텔라 낭독) + 문장 길이(원문 산문 전재 차단)
    for q in all_english_quotes(DAY):
        if q not in full:
            print(f"[!] 인용이 전사에 없음(지어냄?) — 중단: {q!r}"); sys.exit(1)
        if len(re.findall(r"[A-Za-z']+", q)) > MAX_QUOTE_WORDS:
            print(f"[!] 인용이 문장 한계 초과(원문 산문?) — 중단: {q!r}"); sys.exit(1)

    # ② 장면 body/after·해설·에세이엔 영어 '문장' 금지(한국어 재서술만). 인용은 quote 필드로만.
    acc = []
    collect({k: v for k, v in DAY.items()
             if k not in ("one_sentence", "one_line_translation", "vocab", "scenes")}, acc)
    for s in DAY["scenes"]:
        collect({k: v for k, v in s.items() if k != "quote"}, acc)
    stray = re.findall(r'[A-Z][A-Za-z ,\'’]{16,}[.!?]', " ".join(acc))
    if stray:
        print(f"[!] 재서술 영역에 영어 문장 혼입 — 중단: {stray[:2]}"); sys.exit(1)

    # ③ 금지어
    blob_acc = []; collect(DAY, blob_acc); blob = " ".join(blob_acc)
    hits = [w for w in BANNED if w in blob]
    if hits:
        print(f"[!] 금지어 {hits} — 중단"); sys.exit(1)

    pack = {"book": BOOK, **DAY, "_warnings": []}
    json.dump(pack, open(os.path.join(OUT, "hp1-day05.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    qs = all_english_quotes(DAY)
    print(f"✅ hp1-day05.json  영어 인용 {len(qs)}개(전부 전사 실재·문장길이) · 금지어 0 · 원문 산문블록 없음")
    for q in qs: print(f"    · {q}")

    idx = json.load(open(os.path.join(OUT, "hp1-index.json"), encoding="utf-8"))
    idx["days"] = [d for d in idx["days"] if d["day"] != 5]
    idx["days"].append({"day": 5, "pages": DAY["pages"], "file": "hp1-day05.json",
                        "one_sentence": DAY["one_sentence"]["en"], "warnings": []})
    idx["days"].sort(key=lambda d: d["day"])
    json.dump(idx, open(os.path.join(OUT, "hp1-index.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
