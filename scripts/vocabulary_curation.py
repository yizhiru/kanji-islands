"""Conservative, explicitly scoped form handling for the textbook index.

These mappings identify grammar, not the textbook's intended lexical sense.
Glosses remain those of the lemma and are labelled accordingly in the output.
"""

INFLECTIONS = {
    # surface: (lemma, lemma reading, surface reading, form, required POS)
    "歩いて": ("歩く", "あるく", "あるいて", "te", "v5k"),
    "ちがいます": ("違う", "ちがう", "ちがいます", "polite_nonpast", "v5u"),
    "分かりました": ("分かる", "わかる", "わかりました", "polite_past", "v5r"),
    "分かりません": ("分かる", "わかる", "わかりません", "polite_negative", "v5r"),
    "参りました": ("参る", "まいる", "まいりました", "polite_past", "v5r"),
    "おります": ("居る", "おる", "おります", "polite_nonpast", "v5r"),
    "よかった": ("良い", "よい", "よかった", "past", "adj-i"),
    "よかったです": ("良い", "よい", "よかったです", "polite_past", "adj-i"),
    "おいしく": ("美味しい", "おいしい", "おいしく", "adverbial_ku", "adj-i"),
    "おいしさ": ("美味しい", "おいしい", "おいしさ", "nominal_sa", "adj-i"),
    "小さく": ("小さい", "ちいさい", "ちいさく", "adverbial_ku", "adj-i"),
    "楽しく": ("楽しい", "たのしい", "たのしく", "adverbial_ku", "adj-i"),
    "短く": ("短い", "みじかい", "みじかく", "adverbial_ku", "adj-i"),
    "長く": ("長い", "ながい", "ながく", "adverbial_ku", "adj-i"),
    "太さ": ("太い", "ふとい", "ふとさ", "nominal_sa", "adj-i"),
    "甘さ": ("甘い", "あまい", "あまさ", "nominal_sa", "adj-i"),
    "重要さ": ("重要", "じゅうよう", "じゅうようさ", "nominal_sa", "adj-na"),
    "きれいに": ("綺麗", "きれい", "きれいに", "adverbial_ni", "adj-na"),
    "にぎやかに": ("賑やか", "にぎやか", "にぎやかに", "adverbial_ni", "adj-na"),
    "丁寧に": ("丁寧", "ていねい", "ていねいに", "adverbial_ni", "adj-na"),
    "上手に": ("上手", "じょうず", "じょうずに", "adverbial_ni", "adj-na"),
    "元気に": ("元気", "げんき", "げんきに", "adverbial_ni", "adj-na"),
    "簡単に": ("簡単", "かんたん", "かんたんに", "adverbial_ni", "adj-na"),
    "自然に": ("自然", "しぜん", "しぜんに", "adverbial_ni", "adj-na"),
}


def inflection_for(word):
    if word not in INFLECTIONS:
        return None
    lemma, reading, surface_reading, form, pos = INFLECTIONS[word]
    return {"lemma": lemma, "lemma_reading_hiragana": reading,
            "surface_reading_hiragana": surface_reading, "form": form,
            "required_pos": pos, "meanings_scope": "lemma",
            "note": "保留教材活用词形；双语释义来自词典原形，并非整句或活用形式的译文"}
