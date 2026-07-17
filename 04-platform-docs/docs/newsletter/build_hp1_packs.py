# -*- coding: utf-8 -*-
r"""HP 1권 뉴스레터 샘플(Day01~04) → 콘텐츠팩 JSON.
정본 = 콘텐츠팩 JSON(아키텍처 원칙 #1). HTML/PDF/오디오대본/앱 리더는 이 JSON의 렌더.
원문 = 운영자 제공 뉴스레터 HTML(스텔라 강독 콘텐츠). 텍스트 무손실 보존.

⚠️ HP 상표/저작권: 영어 인용은 '오늘의 한 문장' 등 짧은 발췌만. 본문 전문 재현 금지(본문0%·강의100%).
⚠️ 금지어(완주·여정·도반·대장정) 자동 스캔 → _warnings 에 기록(운영자 카피 결정 영역이라 자동 치환 안 함).
"""
import os, io, sys, json, re

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "content-packs")
os.makedirs(OUT, exist_ok=True)

BANNED = ["완주", "여정", "도반", "대장정"]

BOOK = {
    "id": "hp1",
    "series_no": 1,
    "title_en": "Harry Potter and the Sorcerer's Stone",
    "title_ko": "해리포터와 마법사의 돌",
    "author": "J.K. Rowling",
    "year": 1997,
    "total_days": 100,
    "media_type": "live",  # 실사 원서(강사 실물 녹음 있음) — 강사 육성 오디오
    "brand_note": "HP 상표=유료 상품명 사용 금지. 본문0%·강의100%. 1권=5년 전 강독(품질 주의).",
    "free_reading_playlist": "https://youtube.com/playlist?list=PLARsitvDhfaKdd7XctJriviiskDgGXHxI",
    "club_url": "https://cafe.naver.com/literenglish/25286",
    "workbook_url": "https://drive.google.com/file/d/1xNOPkGLXnOskmILbIZThoQbPwVztHXxU/view",
    "class_5step_url": "https://class.literstella.co.kr/p/new-5",
    "cafe_url": "https://cafe.naver.com/literenglish",
}

DAYS = [
    # ---------------- DAY 01 ----------------
    {
        "day": 1, "pages": "p.1-3", "season": "Spring 2026",
        "chapter": {"no": "I", "title_en": "The Boy Who Lived", "title_ko": "이야기의 시작 — 프리벳가 4번지의 비밀"},
        "intro": "오늘부터 프리벳가 4번지에서 시작되는 마법 같은 100일, 해리포터와 마법사의 돌의 첫 장이 도착합니다. 하루 10분 — 원서 그대로, 스토리 맥락 그대로. 자 시작합니다.!",
        "scenes": [
            {"no": 1, "title": "대단히 정상적인 가족",
             "body": "프리벳가 4번지에 사는 더즐리 부부는 자신들이 아주 '정상적'이라는 사실을 더없이 자랑스럽게 여깁니다. 목이 거의 없고 뚱뚱한 더즐리 씨와, 남들보다 목이 두 배나 길어 담장 너머 이웃을 훔쳐보기 좋아하는 더즐리 부인에게는 세상에서 가장 착한 아들 '더들리'가 있습니다.",
             "quote": "They were the last people you'd expect to be involved in anything strange or mysterious...",
             "after": "이들에게는 이상하고 신비로운 일은 요만큼도 얽히고 싶지 않은, 한 가지 큰 비밀이 숨겨져 있습니다. 바로 더즐리 부인의 동생인 '포터 부부'의 존재입니다."},
            {"no": 2, "title": "기이한 화요일의 시작",
             "body": "우중충한 화요일 아침. 아기 의자에 앉기 싫어 떼를 쓰는 아들 더들리와 씨름하는 평범한 출근길. 하지만 길모퉁이에 다다랐을 때 더즐리 씨는 첫 번째 이상한 징조를 발견합니다.",
             "quote": "A tabby cat reading a map... he jerked his head around to look again.",
             "note": "지도를 읽는 얼룩 고양이? 더즐리 씨는 자신이 빛의 착시(trick of the light)를 보았다며 서둘러 고양이의 존재를 머릿속에서 지워버립니다."},
            {"no": 3, "title": "에메랄드빛 망토의 사람들",
             "body": "간신히 마음을 진정시키고 시내로 진입한 더즐리 씨. 그러나 꽉 막힌 교통체증 속에서 그는 또다시 참을 수 없는 광경을 목격합니다. 바로 희한한 망토를 입고 수군거리는 사람들!",
             "after": "자신보다 나이도 많은 사람이 에메랄드빛 망토를 입고 있다니! 더즐리 씨는 기금 마련을 위한 바보 같은 스턴트일 거라고 애써 합리화합니다. 과연 이 기이한 일들은 정말 착각일 뿐일까요?"},
        ],
        "one_sentence": {"en": "Mr. and Mrs. Dursley, of number four, Privet Drive, were proud to say that they were perfectly normal, thank you very much.",
                          "source": "Harry Potter and the Sorcerer's Stone, Chapter I · p.1"},
        "one_line_translation": "프리벳가 4번지에 사는 더즐리 부부는 자신들이 아주 평범하다는 사실을 자랑스럽게 여겼다, thank you very much (\"프리벳가 4번지에 사는 더즐리 부부는 자신들이 지극히 정상이라는 사실을 자랑스러워했다. 누가 묻지도 않았지만, 대단히 감사하게도 말이다.\")",
        "sentence_reading": [
            "이 문장은 해리포터라는 거대한 세계관의 막을 여는 아주 상징적인 첫 문장입니다. 작가는 영국에서 처음 출간될 때 'Philosopher's Stone(철학자의 돌)'으로 냈지만, 미국 출판사에서는 아이들에게 마법사의 느낌을 더 직관적으로 전달하기 위해 'Sorcerer's Stone(마법사의 돌)'으로 수정했습니다. 이 차이점을 알고 읽으면 두 판본의 미묘한 재미를 느낄 수 있습니다.",
            "이 첫 문장에서 가장 재미있는 부분은 \"perfectly normal(지극히 정상)\"이라는 단어 뒤에 붙은 \"Thank you very much(대단히 감사합니다)\"입니다. 평범한 건 평범한 건데, 왜 그걸 굳이 자랑스러워하며 누가 칭찬이라도 한 듯 인사까지 할까요?",
            {"pullquote": "바로 이 지나친 '평범함에 대한 집착'이 앞으로 들이닥칠 '비정상적이고 마법 같은 일들'과 강력한 대비를 이룹니다."},
            "해리포터 원서를 읽다 보면, wrestle(씨름하다), jerk(휙 돌리다) 같은 특정 동작 동사나 전치사 활용이 어떻게 장면을 눈앞에 그리듯 묘사하는지 깨닫게 됩니다. 우리말의 회로가 아닌, 영어 고유의 회로를 만들어 가는 과정입니다.",
        ],
        "essay": [
            "가장 지루하고 현실적인 일상 한가운데로 불쑥 찾아오는 마법. 이 첫 페이지는 지루한 화요일 아침의 출근길과 우는 아이, 넥타이를 고르는 가장 평범한 풍경을 그립니다.",
            "하지만 모퉁이를 도는 순간, 지도를 읽는 얼룩 고양이처럼 우리의 일상에도 무언가 설명할 수 없는 기이한 징조가 도사리고 있을지 모릅니다.",
            "100일의 여정을 통해 해리포터의 마법이 여러분의 영어 회로를 어떻게 바꿔 놓을지 기대해 보세요.",
        ],
        "vocab": [
            {"word": "crane", "meaning": "(무엇을 보려고) 목을 길게 빼다 (크레인처럼 목을 늘이는 모습)"},
            {"word": "shudder", "meaning": "몸서리치다, 진저리치다 (생각만 해도 끔찍할 때)"},
            {"word": "peculiar", "meaning": "기이한, 이상한, 독특한"},
        ],
        "teaser": {"day": 2, "text": "더즐리 씨의 머릿속을 맴도는 불길한 단어 하나. \"포터라는 사람, 아이 이름이 해리... 맞지?\""},
        "media": {
            "story_video": {"title": "오늘을 여는 3분 스토리 영상", "desc": "DAY01 완벽하게 정상적인 더즐리 가족의 아침",
                            "url": "https://youtu.be/Ouv2ZR996bU"},
            "intro_audio": {"title": "오늘을 여는 1분 소개 오디오", "desc": "Day01 해리포터로 암기 없이 실전 영어가 터지는 비결",
                            "url": "https://drive.google.com/file/d/1KEcy69GCiuV4RvockpmAWRzb9tnTu8wD/view"},
            "detail_audio": {"title": "20분 상세 해설 오디오", "desc": "Day01 해리포터 첫 3쪽 속 치밀한 언어적 설계도",
                             "url": "https://drive.google.com/file/d/14lUNHDHU0PPF5QS1_aKOnqY34G0U9-7u/view"},
            "pdf": {"desc": "DAY01 PDF", "url": "https://drive.google.com/file/d/1PMMQSgjmeqsRT_sAPKGFGVgYgpnE2mS3/view"},
            "free_reading_video": {"desc": "리터스텔라 스토리텔링 원서 무료 강독 - 해리포터 1권 DAY01",
                                    "url": "https://youtu.be/KInBE69u4aw"},
        },
    },
    # ---------------- DAY 02 ----------------
    {
        "day": 2, "pages": "p.4-6", "season": "Spring 2026",
        "chapter": {"no": "I", "title_en": "The Boy Who Lived", "title_ko": "이야기의 전개 — 빗나간 더즐리 씨의 일상"},
        "intro": "어제에 이어 프리벳가 4번지의 기묘한 화요일이 계속됩니다. 해리포터와 마법사의 돌의 두 번째 이야기가 도착합니다. 하루 10분 — 원서 그대로, 스토리 맥락 그대로. 자 시작합니다.!",
        "scenes": [
            {"no": 1, "title": "백주대낮의 올빼미와 망토 입은 사람들",
             "body": "더즐리 씨가 사람들에게 소리치고 업무 전화를 거는 동안, 거리에 있는 사람들은 입을 떡 벌리고 하늘을 바라봅니다. 환한 백주대낮에 올빼미 떼가 열을 지어 머리 위로 휙휙 날아가고 있었기 때문이죠. 하지만 완벽하게 정상적인 더즐리 씨만은 이 기이한 풍경을 애써 외면합니다.",
             "quote": "Mr. Dursley, however, had a perfectly normal, owl-free morning.",
             "after": "오후가 되어 도넛을 사러 나선 그는 빵집 옆에서 또다시 수상하게 속닥거리는 망토 입은 무리를 마주치고, 극도의 불편함을 느낍니다."},
            {"no": 2, "title": "귓가를 스치는 이름, \"Harry\"",
             "body": "그들 곁을 무심히 지나치려던 순간, 몇 마디 단어들이 더즐리 씨의 귀에 날아와 꽂힙니다. \"포터 부부 말이야...\", \"맞아, 아들 해리가...\" 그 순간, 그는 얼음처럼 멈춰 섰고 거대한 공포가 그를 확 덮칩니다.",
             "quote": "Mr. Dursley stopped dead. Fear flooded him.",
             "note": "아내가 세상에서 가장 꺼리는 이름. 그는 집 전화의 번호를 누르다 말고 생각합니다. '포터가 그렇게 희귀한 성은 아니잖아? 조카 이름이 하비였던 것 같기도 하고...' 애써 현실을 부정해 봅니다."},
            {"no": 3, "title": "낯선 노인의 포옹과 \"머글\"",
             "body": "퇴근길, 생각에 잠긴 채 걷다 보라색 망토를 입은 노인과 부딪힌 더즐리 씨. 하지만 그 노인은 넘어져서도 화를 내기는커녕 오히려 얼굴이 쫙 갈라지도록 미소를 지으며 외칩니다.",
             "after": "\"그 사람이 마침내 사라졌으니까요! 머글들도 기뻐해야 할 날입니다!\" 노인에게 얼떨결에 안긴 채 꼼짝 못 하고 서 있는 더즐리 씨. 그의 완벽한 일상은 이제 완전히 박살 났습니다."},
        ],
        "one_sentence": {"en": "Even Muggles like yourself should be celebrating, this happy, happy day!",
                          "source": "Harry Potter and the Sorcerer's Stone, Chapter I · p.6"},
        "one_line_translation": "\"심지어 당신 같은 머글들도 축하해야 한답니다. 이 행복하고 행복한 날을 말이죠!\"",
        "sentence_reading": [
            "드디어 '머글(Muggle)'이라는 상징적인 단어가 현실 세계에 처음 등장하는 순간입니다. 평범함을 신앙처럼 여기는 더즐리 씨에게, 알지도 못하는 단어로 불리며 낯선 이에게 포옹을 당하는 이 장면은 문자 그대로의 낭패(rattled)이자 재앙이었을 것입니다.",
            "원서를 읽다 보면 작가가 인물의 불안과 당혹감을 설명하기 위해 '어떤 동사'를 선택했는지 유심히 보게 됩니다. 조카의 이름이 '해리'라는 말을 엿들었을 때 그는 그저 놀란 것이 아니라, 발이 묶인 듯 얼어붙었고(stopped dead) 공포가 그를 범람하듯 덮쳤으며(fear flooded him), 사무실로 쏜살같이 도망쳤습니다(dashed back).",
            {"pullquote": "우리말로는 모두 그저 '놀랐다'거나 '돌아갔다'로 번역될 수 있는 상황들이, 동적이고 입체적인 영단어들을 만나 한 편의 선명한 씬(Scene)으로 완성됩니다."},
            "억지로 암기하려 하지 마세요. 더즐리 씨가 겪은 우중충하고 당황스러운 화요일의 풍경을 머릿속에 그리며 함께 호흡하다 보면, 이 단어들은 자연스럽게 여러분의 것이 될 것입니다.",
        ],
        "essay": [
            "우리는 종종 삶에 찾아오는 변화의 징조들을 외면하려 애씁니다. 더즐리 씨가 지도를 보는 고양이를 빛의 착시라 치부하고, 귀에 꽂힌 조카의 이름을 어떻게든 다른 이름으로 합리화하려 했던 것처럼요.",
            "하지만 낯선 노인이 기쁨에 차서 내뱉은 이 외침은, 우리가 아무리 평범함을 방패 삼아 숨으려 해도 피할 수 없는 '거대한 사건'이 이미 시작되었음을 예고합니다.",
        ],
        "vocab": [
            {"word": "swoop", "meaning": "(새가 먹이를 낚아채듯) 휙 날아들다, 급강하하다"},
            {"word": "rattle", "meaning": "(딸그락 소리를 내며) 당황하게 하다, 낭패를 겪게 하다"},
            {"word": "flood", "meaning": "(감정, 두려움 등이 홍수처럼) 확 덮치다, 밀려들다"},
        ],
        "teaser": {"day": 3, "text": "한밤중, 프리벳가 4번지에 나타난 기묘한 노신사. \"그가 가로등 불빛을 하나씩 끄기 시작할 때, 마침내 진짜 마법이 시작됩니다.\""},
        "media": {
            "story_video": {"title": "오늘을 여는 스토리 영상", "desc": "DAY02 머글의 눈에 띄기 시작한 마법 세계의 흔적들",
                            "url": "https://youtu.be/NzYziWqTwR8"},
            "intro_audio": {"title": "오늘을 여는 1분 오디오", "desc": "Day02 더즐리의 일상을 박살낸 낯선 징조들",
                            "url": "https://drive.google.com/file/d/1mTb0pVNc-hgqkY8cUEoPv_DJa7HY2EBv/view"},
            "detail_audio": {"title": "오늘의 해설 오디오", "desc": "Day02 일상을 덮친 불안의 묘사",
                             "url": "https://drive.google.com/file/d/1mg9ByrK6J35mnvXtU29HthHDO5LH8Yh3/view"},
            "pdf": {"desc": "DAY02 PDF", "url": "https://drive.google.com/file/d/1PiT9J0qgauYy6qsW_tVEZfjU23ZE6kLn/view"},
            "free_reading_video": {"desc": "리터스텔라 스토리텔링 원서 무료 강독 - 해리포터 1권 DAY02",
                                    "url": "https://youtu.be/KInBE69u4aw"},
        },
    },
    # ---------------- DAY 03 ----------------
    {
        "day": 3, "pages": "p.7-9", "season": "Spring 2026",
        "chapter": {"no": "I", "title_en": "The Boy Who Lived", "title_ko": "이야기의 전개 — 프리벳가에 내린 마법의 밤"},
        "intro": "평범함을 사수하려는 더즐리 씨의 바람과 달리, 해리포터와 마법사의 돌의 세 번째 이야기에서는 진짜 마법사들이 프리벳가 4번지 앞에 당도합니다. 자, 신비로운 밤을 시작합니다!",
        "scenes": [
            {"no": 1, "title": "불안에 잠 못 드는 더즐리 부부",
             "body": "집으로 돌아온 더즐리 씨는 참다못해 아내에게 포터 부부의 소식을 묻습니다. 포터라는 이름만 나와도 날카롭게 반응하는 아내를 보며, 그는 침대에 누워서도 머릿속으로 수많은 끔찍한 경우의 수를 뒤척입니다(turning it all over in his mind).",
             "quote": "He laid awake turning it all over in his mind... How very wrong he was.",
             "after": "마침내 잠이 들며 \"우리한테 올 이유는 없겠지\"라고 안심하지만, 작가는 자비 없이 \"그가 얼마나 단단히 틀렸는지\"를 예고합니다."},
            {"no": 2, "title": "어둠 속에 나타난 알버스 덤블도어",
             "body": "자정 무렵, 얼룩 고양이가 하루 종일 뚫어져라 지켜보던 프리벳가 길모퉁이에 한 남자가 나타납니다. 땅에서 솟아난 듯 너무나 갑작스럽고 고요한 등장.",
             "quote": "A man appeared on the corner... so suddenly and silently you'd have thought he'd just popped out of the ground.",
             "note": "보라색 망토, 허리띠에 꽂힐 만큼 긴 은빛 수염, 그리고 반달 안경 너머로 반짝이는 파란 눈. 그 어떤 것도 이 거리에 어울리지 않는 이 남자는 바로 호그와트의 교장 알버스 덤블도어입니다."},
            {"no": 3, "title": "딜루미네이터와 맥고나걸 교수의 변신",
             "body": "덤블도어는 주머니에서 은색 라이터(딜루미네이터)를 꺼내 찰칵 소리와 함께 가로등 불빛을 하나씩 모두 꺼버립니다. 완벽한 어둠 속, 그가 담장 위의 얼룩 고양이에게 인사를 건네자 놀라운 일이 벌어집니다.",
             "after": "고양이는 어느새 사각 안경을 끼고 심란한 표정(ruffled)을 지은 마녀, 맥고나걸 교수로 변해있었습니다. 마침내 두 마법사가 프리벳가 4번지에 모였습니다."},
        ],
        "one_sentence": {"en": "A man appeared on the corner the cat had been watching, appeared so suddenly and silently you'd have thought he'd just popped out of the ground.",
                          "source": "Harry Potter and the Sorcerer's Stone, Chapter I · p.8"},
        "one_line_translation": "고양이가 줄곧 지켜보던 코너에 한 남자가 나타났다. 너무나 갑작스럽고 조용하게 나타나서, 마치 그가 땅에서 불쑥 솟아난 것처럼 보일 정도였다.",
        "sentence_reading": [
            "드디어 본격적인 마법 세계의 인물들, 덤블도어와 맥고나걸 교수가 프리벳가에 등장했습니다. 재미있는 점은 조앤 K. 롤링이 이들의 비범한 등장을 묘사하는 방식입니다.",
            "작가는 덤블도어가 그저 '나타났다'라고만 하지 않고, '마치 땅에서 툭 튀어나온(popped out of the ground) 것처럼 갑작스럽고 고요했다'고 시각적으로 그려냅니다. 평범함의 극치인 프리벳가 거리와 극명한 대비를 이루는 장면이죠.",
            {"pullquote": "또한 머릿속에 온갖 생각이 많아 뒤척이는 더즐리 씨의 모습은 'turning it all over in his mind'라는 표현으로 생생하게 와닿습니다."},
            "물리적으로 침대에서 몸을 뒤척이는 것과, 머릿속에서 생각을 굴려보는 것을 같은 'turn over'로 표현하되 'in his mind'를 붙여 완성한 멋진 문장입니다. 번역에 얽매이지 않고 이런 영어 고유의 회로를 스스로 발견해 나가는 기쁨을 누려보세요.",
        ],
        "essay": [
            "평범함을 신봉하던 더즐리 부부가 드디어 잠든 사이, 집 밖의 어두운 길모퉁이에서는 가장 기이하고 마법 같은 일들이 펼쳐지기 시작합니다. 딜루미네이터의 찰칵거리는 소리와 함께 가로등 빛이 어둠 속으로 빨려 들어가고, 고양이가 깐깐한 표정의 마녀로 변신하는 밤.",
            "우리가 잠든 사이, 혹은 우리가 외면하려 했던 일상 이면에도 이런 기적 같은 비밀들이 일어나고 있지는 않을까요? 어둠 속에서 호그와트의 두 교수가 간절히 기다리고 있는 '그 아이'는 과연 어떤 모습으로 나타날까요?",
        ],
        "vocab": [
            {"word": "turn over in one's mind", "meaning": "머릿속으로 이 생각 저 생각 뒤척여보다, 곰곰이 생각하다"},
            {"word": "pop out of the ground", "meaning": "땅에서 불쑥 솟아나다 (마법처럼 갑자기 나타난 모습)"},
            {"word": "ruffled", "meaning": "심란해하는, (새의 깃털이나 옷매무새 등이) 흐트러진"},
        ],
        "teaser": {"day": 4, "text": "어둠이 내린 밤하늘에서 거대한 엔진 소리가 들려옵니다. \"하늘을 나는 오토바이를 타고, 거인 해그리드가 아기를 안고 내려옵니다!\""},
        "media": {
            "story_video": {"title": "오늘을 여는 스토리 영상", "desc": "DAY03 마침내 모습을 드러낸 알버스 덤블도어",
                            "url": "https://youtu.be/JolkbrpFbdA"},
            "intro_audio": {"title": "오늘을 여는 1분 오디오", "desc": "Day03 마법사들의 비범한 등장을 묘사하는 법",
                            "url": "https://drive.google.com/file/d/1bC5mILFguo570ra9tGOc9eJnvS9AKWuq/view"},
            "detail_audio": {"title": "상세 해설 오디오", "desc": "Day03 진짜 마법의 등장을 알리는 놀라운 묘사들",
                             "url": "https://drive.google.com/file/d/1oUyPH5E8ssDSQWR8-t_ZeNWFnlbxLXjt/view"},
            "pdf": {"desc": "DAY03 PDF", "url": "https://drive.google.com/file/d/1kgfQqQTfRH-Bvv_e6EFdpCjFiBZozr6V/view"},
            "free_reading_video": {"desc": "리터스텔라 스토리텔링 원서 무료 강독 - 해리포터 1권 DAY03",
                                    "url": "https://youtu.be/KInBE69u4aw"},
        },
    },
    # ---------------- DAY 04 ----------------
    {
        "day": 4, "pages": "p.10-12", "season": "Spring 2026",
        "chapter": {"no": "I", "title_en": "The Boy Who Lived", "title_ko": "이야기의 전개 — 마법사들의 대화"},
        "intro": "오늘부터 프리벳가 4번지에서 시작되는 마법 같은 100일, 해리포터와 마법사의 돌의 네 번째 이야기가 도착합니다. 하루 10분 — 원서 그대로, 스토리 맥락 그대로. 자 시작합니다.!",
        "scenes": [
            {"no": 1, "title": "서로 다른 두 마법사의 대화",
             "body": "어둠 속 프리벳가에서 만난 덤블도어와 맥고나걸 교수는 머글들이 알아차릴 정도로 부주의했던 마법 세계의 축제 분위기에 대해 대화를 나눕니다. 매사 차분하고 느긋한 덤블도어와 달리, 맥고나걸 교수는 날카롭고 조급한(impatiently) 태도를 보입니다."},
            {"no": 2, "title": "볼드모트, 그 이름을 부르다",
             "body": "맥고나걸 교수가 \"그 사람(You-Know-Who)\"이라 부르며 두려워하는 존재. 하지만 덤블도어는 그의 진짜 이름인 '볼드모트(Voldemort)'를 똑바로 부르라고 설득하며 평온하게 레몬 드롭 사탕을 권합니다."},
            {"no": 3, "title": "충격적인 슬픈 소식",
             "body": "마침내 대화는 가장 무거운 주제로 향합니다. 볼드모트가 릴리와 제임스 포터 부부를 살해했다는 소문. 숨이 턱 막힌(gasped) 맥고나걸 교수에게 덤블도어는 슬프게 고개를 끄덕입니다. 하지만 더 놀라운 사실은, 볼드모트가 그들의 아들인 아기 '해리 포터'를 죽이려다 실패하고 오히려 자신의 힘을 잃은 채 사라졌다는 믿기 힘든(astounding) 이야기입니다."},
        ],
        "one_sentence": {"en": "It's lucky it's dark. I haven't blushed so much since Madam Pomfrey told me she liked my new earmuffs.",
                          "source": "Harry Potter and the Sorcerer's Stone, Chapter I · p.11"},
        "one_line_translation": "\"어두워서 다행이네요. 폼프리 부인이 내 새 귀마개가 마음에 든다고 한 이후로 이렇게 얼굴이 붉어진(blushed) 적이 없었거든요.\"",
        "sentence_reading": [
            "자신이 유일하게 볼드모트가 두려워하는 마법사라는 맥고나걸의 칭찬(flatter)에 대한 덤블도어의 대답입니다. 세계관 최고 마법사의 입에서 나오는 대답치고는 참 엉뚱하면서도 유머러스하죠.",
            "작가는 두 인물의 성격을 묘사할 때 '어떤 부사'를 사용하는지 세밀하게 설계했습니다. 맥고나걸 교수의 대사 뒤에는 impatiently(조급하게), coldly(차갑게), sharply(날카롭게)가 붙지만, 덤블도어의 행동은 calmly(차분하게), gently(부드럽게) 묘사됩니다. 이러한 부사의 대비를 통해 우리는 인물의 심리와 성격을 더욱 입체적으로 느낄 수 있습니다.",
        ],
        "essay": [
            "엄청난 비극과 놀라운 소식이 교차하는 순간에도 덤블도어 교수는 평정을 잃지 않습니다. 두려운 이름을 똑바로 부르고, 레몬 사탕을 권하며, 칭찬 앞에서는 농담으로 받아넘기는 그의 여유로움.",
            "우리는 종종 두려움에 사로잡혀 문제를 직시하지 못할 때가 있습니다(마치 You-Know-Who라고 부르는 것처럼 말이죠). 진짜 힘은 상황에 압도되지 않고 유머를 잃지 않는 단단한 마음에서 나오는 것 아닐까요?",
        ],
        "vocab": [
            {"word": "flatter", "meaning": "치켜세우다, 비행기 태우다 (아첨하다)"},
            {"word": "blush", "meaning": "(부끄럽거나 쑥스러워서) 얼굴을 붉히다"},
            {"word": "astounding", "meaning": "믿기 어려운, 경악할 만한"},
        ],
        "teaser": {"day": 5, "text": "마침내 하늘을 나는 오토바이를 타고 아기 해리가 도착합니다. \"흉터가 남은 아기를 문가에 둔 채, 그들은 조용히 밤 속으로 사라집니다.\""},
        "media": {
            "story_video": {"title": "오늘을 여는 3분 스토리 영상", "desc": "DAY04 마법사들의 대화 그리고 슬픈 소식",
                            "url": "https://youtu.be/sKaMdjgHo_A"},
            "intro_audio": {"title": "오늘을 기억하는 1분 영어 오디오", "desc": "Day04 해리포터로 암기 없이 실전 영어가 터지는 비결",
                            "url": "https://drive.google.com/file/d/1a_PG4_LGewTLEFGfvWbfOQ92W2tQxgTX/view"},
            "detail_audio": {"title": "10분 상세 해설 오디오", "desc": "Day04 인물의 성격을 드러내는 영어 부사의 힘",
                             "url": "https://drive.google.com/file/d/16c_6q400FVHnwWXUSdj7mzEmi21nXALg/view"},
            "pdf": {"desc": "DAY04 PDF", "url": "https://drive.google.com/file/d/1NZp7xqKHv9jABHKABeW6wnn68jCyVrOi/view"},
            "free_reading_video": {"desc": "리터스텔라 스토리텔링 원서 무료 강독 - 해리포터 1권 DAY04",
                                    "url": "https://youtu.be/KInBE69u4aw"},
        },
    },
]


def scan_banned(day):
    hits = []
    blob = json.dumps(day, ensure_ascii=False)
    for w in BANNED:
        n = blob.count(w)
        if n:
            hits.append(f"{w}×{n}")
    return hits


def main():
    index = []
    for d in DAYS:
        pack = {"book": BOOK, **d}
        warnings = []
        banned = scan_banned(d)
        if banned:
            warnings.append("금지어 발견(발송 전 운영자 카피 교체 필요): " + ", ".join(banned))
        pack["_warnings"] = warnings
        fn = f"hp1-day{d['day']:02d}.json"
        json.dump(pack, open(os.path.join(OUT, fn), "w", encoding="utf-8"),
                  ensure_ascii=False, indent=1)
        index.append({"day": d["day"], "pages": d["pages"], "file": fn,
                      "one_sentence": d["one_sentence"]["en"], "warnings": warnings})
        print(f"  wrote {fn}  (warnings: {warnings or 'none'})")
    json.dump({"book": BOOK, "days": index},
              open(os.path.join(OUT, "hp1-index.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    print(f"\n총 {len(DAYS)}편 콘텐츠팩 + 인덱스 → {OUT}")


if __name__ == "__main__":
    main()
