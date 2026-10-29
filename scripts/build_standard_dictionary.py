#!/usr/bin/env python3
"""Build the full pinned Jitendex snapshot, with verified textbook overlays.

Identical senses are interned to keep alternate spellings/readings inexpensive.
Only previously curated (word, reading, JMdict ID) matches receive lesson tags.
"""
import hashlib
import json
import zipfile

from build_vocabulary import ROOT, raw_senses, applies
from check_zhwiktionary_coverage import hira, sha256


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def main():
    inputs = [ROOT / p for p in (
        "data/vocabulary/vocabulary.json", "data/jitendex-en/dictionary.zip",
        "data/jitendex-zh/dictionary.zip", "scripts/build_standard_dictionary.py",
        "scripts/build_vocabulary.py", "scripts/check_zhwiktionary_coverage.py",
        "scripts/check_jitendex_coverage.py",
    )]
    digest = hashlib.sha256("".join(sha256(p) for p in inputs).encode()).hexdigest()
    dest = ROOT / "data/vocabulary/standard.json"
    stamp = dest.with_suffix(".sha256")
    if dest.exists() and stamp.exists() and stamp.read_text() == digest:
        print("Full dictionary cache is current.", flush=True)
        return
    curated = json.loads(inputs[0].read_text())
    overlays = {}
    for entry in curated["entries"]:
        overlays.setdefault((entry["word"], entry["reading_hiragana"], entry["jmdict_id"]), []).append(entry)
    entries, pool, interned, seen, used = [], [], {}, set(), set()
    fallbacks = 0

    def intern(sense):
        key = encode(sense)
        if key not in interned:
            interned[key] = len(pool)
            pool.append(sense)
        return interned[key]

    def add_curated(e, priority=0):
        sources = [{
            "level": s["level"], "lessons": s.get("corrected_lessons", s["lessons"]),
            "original_lessons": s["lessons"], "original_word": s["original_word"],
            "raw_line": s["raw_line"], "pdf_page": s["pdf_page"], "book_page": s["book_page"],
            **({"correction_note": s["correction_note"]} if "correction_note" in s else {}),
        } for s in e["sources"]]
        item = {"id": e["id"], "word": e["word"], "reading_hiragana": e["reading_hiragana"],
                "jmdict_id": e["jmdict_id"], "sense_ids": [intern({k: s[k] for k in
                    ("id", "zh", "en", "pos", "labels", "notes_zh", "notes_en")}) for s in e["senses"]],
                "sources": sources, "priority": priority}
        if e.get("inflection"):
            item.update(inflection=e["inflection"], meanings_scope="lemma")
        entries.append(item)
        used.add(e["id"])

    with zipfile.ZipFile(inputs[1]) as en, zipfile.ZipFile(inputs[2]) as zh:
        for directory, archive in (("jitendex-en", en), ("jitendex-zh", zh)):
            metadata = json.loads((ROOT / "data" / directory / "metadata.json").read_text())
            assert sha256(ROOT / "data" / directory / "dictionary.zip") == metadata["sha256"]
            assert archive.testzip() is None
        banks = sorted((n for n in en.namelist() if n.startswith("term_bank_") and n.endswith(".json")),
                       key=lambda n: int(n[10:-5]))
        for bank_index, bank in enumerate(banks):
            english, chinese = json.loads(en.read(bank)), json.loads(zh.read(bank))
            assert len(english) == len(chinese), bank
            for et, zt in zip(english, chinese):
                assert (et[0], et[1], et[6]) == (zt[0], zt[1], zt[6]), bank
                if et[6] <= 0:
                    continue  # Redirect rows are not independent dictionary definitions.
                word, reading, sequence = et[0], hira(et[1] or et[0]), et[6]
                key = (word, reading, sequence)
                if key in seen:
                    continue
                seen.add(key)
                priority = et[4]
                if key in overlays:
                    for e in overlays[key]:
                        if e["id"] not in used:
                            add_curated(e, priority)
                    continue
                es, zs = raw_senses(et[5]), raw_senses(zt[5])
                aligned = len(es) == len(zs) and all(
                    (e["pos"], e["restrictions"], e["display_number"]) ==
                    (z["pos"], z["restrictions"], z["display_number"]) for e, z in zip(es, zs))
                ids = []
                for index, sense in enumerate(es):
                    permitted, unsupported = applies(sense["restrictions"], word, et[1] or word)
                    if not permitted or not sense["glosses"]:
                        continue
                    # An unsupported restriction is retained visibly for manual inspection.
                    notes = sense["notes"] + (["词形／读音限制：" + "；".join(unsupported)] if unsupported else [])
                    ids.append(intern({"id": f"jmdict:{sequence}:sense:{sense['number']}",
                        "zh": zs[index]["glosses"] if aligned else [], "en": sense["glosses"],
                        "pos": sense["pos"], "labels": sense["labels"],
                        "notes_zh": zs[index]["notes"] if aligned else [], "notes_en": notes}))
                if not ids:
                    continue
                fallbacks += int(not aligned)
                entries.append({"id": f"jmdict:{sequence}:{word}:{reading}", "word": word,
                    "reading_hiragana": reading, "jmdict_id": sequence, "sense_ids": ids,
                    "priority": priority})
            if bank_index % 25 == 0:
                print(f"Full dictionary: {bank_index + 1}/{len(banks)} banks", flush=True)
    for e in curated["entries"]:
        if e["id"] not in used:
            add_curated(e)  # Verified inflections and textbook spellings remain available.
    assert used == {e["id"] for e in curated["entries"]}
    assert len(entries) == len({e["id"] for e in entries})
    metadata = {"entryCount": len(entries), "dictionaryEntries": len({e["jmdict_id"] for e in entries}),
        "textbookEntries": len(used), "textbookWords": len({e["word"] for e in entries if e.get("sources")}),
        "pendingGroups": curated["metadata"]["summary"]["unmatched_groups"] + curated["metadata"]["summary"]["ambiguous_groups"],
        "sourceHash": digest, "chineseVersion": "Jitendex 非官方中文版 v2026.08.11-zh.4",
        "englishVersion": "Jitendex 2026.08.11.0 / JMdict", "englishOnlyEntries": fallbacks}
    result = {"version": 2, "metadata": metadata, "senses": pool, "entries": entries}
    temporary = dest.with_suffix(".json.part")
    temporary.write_text(encode(result))
    temporary.replace(dest)
    stamp.write_text(digest)
    print(encode(metadata), flush=True)


if __name__ == "__main__":
    main()
