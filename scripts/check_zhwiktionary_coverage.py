#!/usr/bin/env python3
"""Measure PDF vocabulary lookup coverage; do not select textbook senses automatically."""

import csv
import gzip
import hashlib
import json
import re
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data/zhwiktionary"
OUT = ROOT / "output/coverage"
SOURCES = [("初级", "初级词汇表_完整校对文字版.pdf"),
           ("中级", "中级词汇表_完整校对文字版.pdf")]
ARCHIVE = DATA / "ja.jsonl.gz"
DOWNLOAD_URL = ("https://kaikki.org/zhwiktionary/%E6%97%A5%E8%AA%9E/"
                "kaikki.org-dictionary-%E6%97%A5%E8%AA%9E.jsonl.gz")
ENTRY_RE = re.compile(r"(.+?)(\d+[※▼ス]?(?:\s*[,，、]\s*\d+[※▼ス]?)*\s*)")
ANNOTATION_RE = re.compile(r"[\[［(（〈<【][^\]］)）〉>】]*[\]］)）〉>】]")
HAN_RE = re.compile(r"[\u3400-\u9fff\U00020000-\U0003134f]")
KANA_RE = re.compile(r"[ぁ-ゖァ-ヺー・\s]+")


def norm(text):
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", text))


def hira(text):
    return "".join(chr(ord(c) - 0x60) if "ァ" <= c <= "ヶ" else c
                   for c in norm(text))


def canonical_surface(surface):
    # Remove textbook annotations, not Japanese spelling/inflections.
    return norm(ANNOTATION_RE.sub("", surface)).replace("〜", "~")


def sha256(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def extract_pdfs():
    rows, audits = [], []
    for level, filename in SOURCES:
        path = ROOT / filename
        reader = PdfReader(path)
        for page_no, page in enumerate(reader.pages, 1):
            lines = page.extract_text().splitlines()
            footer = next(line for line in lines if line.startswith("本页"))
            expected = int(re.search(r"本页\s*(\d+)\s*条", footer)[1])
            book_page = int(re.search(r"原书页码\s*(\d+)", lines[1])[1])
            page_rows = []
            for line in lines[2:]:
                if line.startswith(("◆", "本页")):
                    continue
                m = ENTRY_RE.fullmatch(line)
                if not m:
                    continue
                surface, refs_text = m[1].strip(), m[2].strip()
                refs, warnings = [], []
                for ref in re.split(r"[,，、]\s*", refs_text):
                    r = re.fullmatch(r"(\d+)(.*)", ref.strip())
                    lesson, symbol = int(r[1]), r[2]
                    assert 1 <= lesson <= (48 if level == "初级" else 32), line
                    if symbol not in ("", "※", "▼"):
                        warnings.append(f"原文课次符号异常：{ref}，未自动改正")
                    refs.append({"level": level, "lesson": lesson, "symbol": symbol})
                key = canonical_surface(surface)
                assert key, line
                page_rows.append({
                    "id": len(rows) + len(page_rows) + 1,
                    "level": level, "surface": surface, "lookup_key": key,
                    "annotations": ANNOTATION_RE.findall(surface),
                    "references": refs, "raw_references": refs_text,
                    "source_pdf": filename, "pdf_page": page_no,
                    "original_book_page": book_page, "raw_line": line,
                    "warnings": warnings,
                })
            assert len(page_rows) == expected, (filename, page_no, len(page_rows), expected)
            rows.extend(page_rows)
            audits.append({"source_pdf": filename, "pdf_page": page_no,
                           "expected": expected, "extracted": len(page_rows)})
    assert Counter(r["level"] for r in rows) == {"初级": 2980, "中级": 4707}
    return rows, audits


def ruby_reading(form):
    text, offset, parts = form.get("form", ""), 0, []
    for surface, reading in form.get("ruby", []):
        i = text.find(surface, offset)
        if i < 0:
            return None
        parts.extend((text[offset:i], reading))
        offset = i + len(surface)
    parts.append(text[offset:])
    result = "".join(parts)
    return hira(result) if form.get("ruby") and KANA_RE.fullmatch(result) else None


def load_dictionary():
    records = []
    direct, canonical, alternative, reading = [defaultdict(set) for _ in range(4)]
    present = set()
    all_records = 0
    all_words = set()
    with gzip.open(ARCHIVE, "rt", encoding="utf-8") as f:
        for line_no, line in enumerate(f, 1):
            entry = json.loads(line)
            all_records += 1
            assert entry.get("lang_code") == "ja", (line_no, entry.get("lang_code"))
            word = entry["word"]
            all_words.add(word)
            present.add(norm(word))
            # A kanji character page or a redirect alone is not a lexical definition.
            if entry.get("pos") in {"character", "romanization", "syllable", "soft-redirect", "hard-redirect"}:
                continue
            senses = []
            for sense in entry.get("senses", []):
                if sense.get("alt_of") or sense.get("form_of") or "no-gloss" in sense.get("tags", []):
                    continue
                glosses = [g for g in sense.get("glosses", []) if HAN_RE.search(g)]
                if glosses:
                    senses.append({"id": sense.get("id"), "glosses": glosses,
                                   "tags": sense.get("tags", [])})
            if not senses:
                continue
            forms = entry.get("forms", [])
            canonical_forms = [v for v in forms if "canonical" in v.get("tags", [])]
            readings = sorted({v for form in canonical_forms if (v := ruby_reading(form))})
            rid = len(records)
            record = {"id": rid, "word": word, "pos": entry.get("pos"),
                      "readings": readings, "senses": senses,
                      "url": "https://zh.wiktionary.org/wiki/" + quote(word, safe="") + "#日語",
                      "structure_warning": any("\n" in g or "===" in g
                                               for s in senses for g in s["glosses"])}
            records.append(record)
            direct[norm(word)].add(rid)
            for form in canonical_forms:
                canonical[norm(form["form"])].add(rid)
            for form in forms:
                if "alternative" in form.get("tags", []):
                    alternative[norm(form["form"])].add(rid)
            for value in readings:
                reading[value].add(rid)
    return records, (direct, canonical, alternative, reading), present, {
        "records": all_records, "distinct_words": len(all_words),
        "records_with_lexical_chinese_glosses": len(records),
        "headwords_with_lexical_chinese_glosses": len(direct),
    }


def match_rows(rows, records, indexes, present):
    direct, canonical, alternative, reading = indexes
    for row in rows:
        keys = row["lookup_key"].split("/")
        matches = []
        for key in keys:
            query = key.strip("~")
            suffix = key.startswith("~")
            prefix = key.endswith("~")
            explicit_readings = [hira(note[1:-1]) for note in row["annotations"]
                                 if KANA_RE.fullmatch(note[1:-1])]

            def eligible(rid):
                record = records[rid]
                # A normal noun definition does not establish a counter/affix use.
                if suffix and record["pos"] not in {"suffix", "affix", "counter", "classifier", "particle"}:
                    return False
                if prefix and record["pos"] not in {"prefix", "affix"}:
                    return False
                if explicit_readings and not set(explicit_readings).intersection(record["readings"]):
                    return False
                if any("叹词" in n for n in row["annotations"]) and record["pos"] != "intj":
                    return False
                if any(n in {"[姓]", "[人名]"} for n in row["annotations"]) and record["pos"] != "name":
                    return False
                if any("助词" in n for n in row["annotations"]) and record["pos"] not in {"particle", "postp", "suffix", "affix"}:
                    return False
                return True

            tier, ids = "unmatched", set()
            for name, index in [("direct", direct), ("canonical", canonical),
                                ("alternative", alternative)]:
                lookups = {query}
                if suffix:
                    lookups.add("-" + query)
                if prefix:
                    lookups.add(query + "-")
                candidates = {rid for lookup in lookups for rid in index.get(lookup, set())
                              if eligible(rid)}
                if candidates:
                    tier, ids = name, candidates
                    break
            if not ids and KANA_RE.fullmatch(query):
                candidates = {rid for rid in reading.get(hira(query), set()) if eligible(rid)}
                if candidates:
                    tier, ids = "reading", candidates
            matches.append({"query": key, "method": tier, "record_ids": sorted(ids)})
        methods = {m["method"] for m in matches}
        if "unmatched" in methods:
            status = "partial" if len(methods) > 1 else "unmatched"
        elif methods <= {"direct", "canonical"}:
            status = "direct_or_canonical"
        else:
            status = "additional_variant_or_reading"
        row["coverage_status"] = status
        row["matches"] = matches
        row["dictionary_headword_present"] = all(key in present for key in keys)
        row["structure_warning"] = any(records[rid]["structure_warning"]
                                       for m in matches for rid in m["record_ids"])
        # Coverage measures candidate retrieval, not verified textbook readings/senses.
        row["sense_verified_against_textbook"] = False


def statistics(rows):
    totals = Counter(r["coverage_status"] for r in rows)
    groups = defaultdict(list)
    for row in rows:
        groups[row["lookup_key"]].append(row)
    direct = sum(any(r["coverage_status"] == "direct_or_canonical" for r in rs)
                 for rs in groups.values())
    total = sum(any(r["coverage_status"] in {"direct_or_canonical", "additional_variant_or_reading"}
                    for r in rs) for rs in groups.values())
    raw_direct = totals["direct_or_canonical"]
    raw_total = raw_direct + totals["additional_variant_or_reading"]
    return {"pdf_records": len(rows), "unique_lookup_keys": len(groups),
            "record_direct_or_canonical": raw_direct,
            "record_total_with_additional_candidates": raw_total,
            "record_direct_percent": round(raw_direct / len(rows) * 100, 2),
            "record_total_percent": round(raw_total / len(rows) * 100, 2),
            "unique_direct_or_canonical": direct,
            "unique_additional_candidates": total - direct,
            "unique_total_with_additional_candidates": total,
            "unique_unmatched": len(groups) - total,
            "unique_direct_percent": round(direct / len(groups) * 100, 2),
            "unique_total_percent": round(total / len(groups) * 100, 2),
            "record_status_counts": dict(totals),
            "matched_records_needing_gloss_structure_cleanup": sum(
                r["structure_warning"] for r in rows if r["coverage_status"] in
                {"direct_or_canonical", "additional_variant_or_reading"}),
            "annotation_warning_records": sum(bool(r["warnings"]) for r in rows)}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    rows, audits = extract_pdfs()
    records, indexes, present, dictionary_stats = load_dictionary()
    match_rows(rows, records, indexes, present)
    summary = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "dictionary": {**dictionary_stats, "source_url": DOWNLOAD_URL,
                       "archive_sha256": sha256(ARCHIVE)},
        "input_sha256": {filename: sha256(ROOT / filename) for _, filename in SOURCES},
        "methodology": [
            "逐页提取并与 PDF 页尾条目数校验；原始条目、课次、符号、页码全部保留。",
            "查询时使用 NFKC、去空白、去词性/用法/读音括注；首尾波浪线保留在去重键中，查询其对应词形时限制前后缀/量词词性；不改正疑似 OCR。",
            "去重单位为清理后的词形；同形不同读音/用法在此覆盖率统计中合并，明细仍分开。",
            "直接覆盖：日语词条标题或 canonical 词形匹配，且有实际中文 gloss。",
            "追加候选：词典明确记录的 alternative 写法或 canonical ruby 假名读音匹配；假名查询允许平片假名转换。",
            "不使用汉语条目、汉字单字页、罗马字页、无释义跳转页、仅异体/活用关系的释义。",
            "不剥除する、不分解复合词、不作模糊匹配、不生成或翻译释义。",
            "PDF 明示的纯假名括注必须在候选读音中出现；叹词、助词、姓氏、人名按明确词性限制候选。",
            "斜线分隔的多个写法须全部找到候选才计覆盖；只找到部分的归入未完整覆盖。",
            "这是词形检索候选覆盖率，不是教材义项/读音核对通过率；长段原始标记混入 gloss 时另作结构告警。",
            "本报告只衡量下载快照；网站实时内容可能多于导出。例如网页有新しい的日语释义，本快照缺少该词记录。",
        ],
        "statistics": {level: statistics([r for r in rows if r["level"] == level])
                       for level, _ in SOURCES},
        "page_audits": audits,
    }
    summary["statistics"]["合并"] = statistics(rows)
    write_json(OUT / "summary.json", summary)
    examples = []
    for key, pos, kana in [("安心する", "verb", "あんしんする"),
                           ("安全", "adj", "あんぜん"),
                           ("研究する", "verb", "けんきゅうする"),
                           ("発表", "noun", "はっぴょう"),
                           ("意識", "noun", "いしき")]:
        sources = [r for r in rows if r["lookup_key"] == key]
        ids = {rid for row in sources for m in row["matches"] for rid in m["record_ids"]}
        candidates = [records[rid] for rid in sorted(ids)
                      if records[rid]["pos"] == pos and kana in records[rid]["readings"]]
        assert candidates, key
        examples.append({"word": key, "reading": kana,
                         "reading_source": "Chinese Wiktionary canonical form ruby",
                         "chinese_glosses_original": list(dict.fromkeys(
                             g for d in candidates for s in d["senses"] for g in s["glosses"])),
                         "dictionary_records": candidates,
                         "references": [ref for row in sources for ref in row["references"]],
                         "source_rows": sources})
    write_json(OUT / "examples.json", examples)
    used_ids = {rid for r in rows for m in r["matches"] for rid in m["record_ids"]}
    with (OUT / "matched_dictionary_records.jsonl").open("w", encoding="utf-8") as f:
        for rid in sorted(used_ids):
            f.write(json.dumps(records[rid], ensure_ascii=False) + "\n")
    with (OUT / "pdf_records.jsonl").open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    fields = ["level", "surface", "lookup_key", "raw_references", "coverage_status",
              "methods", "dictionary_words", "chinese_glosses", "structure_warning",
              "source_pdf", "pdf_page", "original_book_page", "warnings"]
    with (OUT / "coverage.csv").open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            hit_records = [records[rid] for rid in sorted({rid for m in row["matches"] for rid in m["record_ids"]})]
            output = {key: row[key] for key in fields if key in row}
            output.update(methods=";".join(m["method"] for m in row["matches"]),
                          dictionary_words=";".join(dict.fromkeys(r["word"] for r in hit_records)),
                          chinese_glosses=" | ".join(dict.fromkeys(g for r in hit_records
                              for s in r["senses"] for g in s["glosses"])),
                          warnings=";".join(row["warnings"]))
            writer.writerow(output)
    with (OUT / "unmatched.csv").open("w", encoding="utf-8-sig", newline="") as f:
        fields = ["level", "surface", "lookup_key", "raw_references", "coverage_status",
                  "source_pdf", "pdf_page", "original_book_page"]
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            if row["coverage_status"] in {"unmatched", "partial"}:
                writer.writerow({k: row[k] for k in fields})
    print(json.dumps({"dictionary": dictionary_stats, "statistics": summary["statistics"]},
                     ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
