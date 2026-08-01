# -*- coding: utf-8 -*-
r"""HP 앱 데이터 빌드.

정본 content-pack index에 등록된 Day만 평면 앱 JSON으로 변환한다.
중요: media URL은 content-pack에 승인된 절대 URL이 있을 때만 전달한다.
없는 media의 URL을 추정·합성하지 않으며 hasAudio/hasImage는 false로 유지한다.
"""
import argparse
import io
import json
import os
import re
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(HERE)
DEFAULT_CP = os.path.join(
    REPO_ROOT, "04-platform-docs", "docs", "newsletter", "content-packs"
)

# Day01~05의 기존 무료 강독 VOD 정본. 후속 Day는 content-pack에 승인 URL이
# 들어오기 전까지 null을 유지한다.
VOD = {
    1: "KInBE69u4aw",
    2: "1VUXF4n6HdE",
    3: "NFVkSu9U0Xo",
    4: "uei1JnLI6Xg",
    5: "6seMq5njD4M",
}

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


def _ytid(url):
    match = re.search(r"(?:youtu\.be/|v=)([\w-]+)", str(url or ""))
    return match.group(1) if match else None


def _approved_url(value):
    """승인된 절대 HTTP(S) URL만 전달한다. 상대경로와 추정 URL은 null."""
    text = str(value or "").strip()
    return text if re.match(r"^https?://", text, re.IGNORECASE) else None


def load_index(content_packs):
    path = os.path.join(content_packs, "hp1-index.json")
    with open(path, encoding="utf-8") as handle:
        index = json.load(handle)
    rows = index.get("days") or []
    days = [row.get("day") for row in rows]
    if days != sorted(days) or len(days) != len(set(days)):
        raise ValueError(f"index Day 순서/중복 오류: {days}")
    for row in rows:
        source = os.path.join(content_packs, row["file"])
        if not os.path.isfile(source):
            raise FileNotFoundError(source)
    return index


def build_day(day, content_packs):
    path = os.path.join(content_packs, f"hp1-day{day:02d}.json")
    with open(path, encoding="utf-8") as handle:
        source = json.load(handle)

    chapter = source["chapter"]
    reading = [item for item in source["sentence_reading"] if isinstance(item, str)]
    pullquote = next(
        (
            item["pullquote"]
            for item in source["sentence_reading"]
            if isinstance(item, dict) and item.get("pullquote")
        ),
        None,
    )
    vocab = WB_VOCAB.get(day) or [
        {"w": item["word"], "pos": "", "ko": item["meaning"], "note": ""}
        for item in source["vocab"]
    ]
    media = source.get("media") or {}
    story_id = _ytid((media.get("story_video") or {}).get("url"))
    free_reading_id = _ytid((media.get("free_reading_video") or {}).get("url"))
    illustration = _approved_url((media.get("hero_illust") or {}).get("url"))
    audio_url = _approved_url((media.get("essay_audio") or {}).get("url"))

    return {
        "day": day,
        "pages": source["pages"],
        "chapterNo": chapter.get("no"),
        "chapterKo": chapter.get("title_ko"),
        "chapterEditorialStatus": chapter.get("editorial_status"),
        "chapterEvidence": chapter.get("evidence"),
        "storyVideoId": story_id,
        "youtubeId": story_id,
        "vodId": VOD.get(day) or free_reading_id,
        "illustration": illustration,
        "audioUrl": audio_url,
        "hasAudio": bool(audio_url),
        "hasImage": bool(illustration),
        "isOriginalVoice": False if audio_url else None,
        "intro": source["intro"],
        "scenes": [
            {
                "no": scene["no"],
                "title": scene["title"],
                "body": scene["body"],
                "after": scene.get("after", ""),
            }
            for scene in source["scenes"]
        ],
        "sentenceLabel": source["one_sentence"].get("label"),
        "sentenceEn": source["one_sentence"]["en"],
        "sentenceKo": source["one_line_translation"],
        "source": source["one_sentence"]["source"],
        "readingTitle": "스텔라의 문장 읽기",
        "reading": reading,
        "pullquote": pullquote,
        "essay": source["essay"],
        "vocab": vocab,
        "teaser": source["teaser"],
        "productionStatus": source.get("_productionStatus"),
        "releaseStatus": source.get("_releaseStatus"),
        "warnings": source.get("_warnings") or [],
    }


def write_json(root, obj, name):
    os.makedirs(root, exist_ok=True)
    with open(os.path.join(root, name), "w", encoding="utf-8") as handle:
        json.dump(obj, handle, ensure_ascii=False, indent=1)


def parse_days(raw, available):
    if not raw:
        return available
    requested = [int(value.strip()) for value in raw.split(",") if value.strip()]
    missing = [day for day in requested if day not in available]
    if missing:
        raise ValueError(f"index에 없는 Day 요청: {missing}")
    return requested


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--content-packs", default=DEFAULT_CP)
    parser.add_argument("--out", required=True, help="검증된 출력 디렉터리. 앱 경로 반영은 별도 승인.")
    parser.add_argument("--days", help="선택 Day CSV. 생략 시 content-pack index 전체.")
    args = parser.parse_args(argv)

    index_source = load_index(args.content_packs)
    available = [row["day"] for row in index_source["days"]]
    selected = parse_days(args.days, available)

    rows = []
    for day in selected:
        obj = build_day(day, args.content_packs)
        blob = " ".join(
            [obj["intro"]]
            + [scene["body"] + scene["after"] for scene in obj["scenes"]]
            + obj["reading"]
            + obj["essay"]
        )
        stray = re.findall(r"[A-Z][A-Za-z ,']{18,}[.!?]", blob)
        if stray:
            raise AssertionError(f"Day{day} 재서술에 영어문장 혼입: {stray[:2]}")
        write_json(args.out, obj, f"day-{day}.json")
        rows.append(
            {
                "day": day,
                "pages": obj["pages"],
                "sentenceEn": obj["sentenceEn"],
                "hasAudio": obj["hasAudio"],
                "hasImage": obj["hasImage"],
                "audioUrl": obj["audioUrl"],
                "illustration": obj["illustration"],
                "warnings": obj["warnings"],
            }
        )

    output_index = {
        "book": index_source["book"]["title_ko"],
        "bookEn": index_source["book"]["title_en"],
        "author": index_source["book"]["author"],
        "totalDays": index_source["book"]["total_days"],
        "productionStatus": index_source.get("_productionStatus"),
        "releaseStatus": index_source.get("_releaseStatus"),
        "days": rows,
    }
    write_json(args.out, output_index, "index.json")

    print(f"✅ {len(rows)}일치 안전 빌드 → {args.out}")
    print(
        f"   audio={sum(row['hasAudio'] for row in rows)} "
        f"image={sum(row['hasImage'] for row in rows)} "
        "(null media URL 합성 없음)"
    )


if __name__ == "__main__":
    main()

