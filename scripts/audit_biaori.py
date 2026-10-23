#!/usr/bin/env python3
"""Audit a biaori snapshot; retrieve candidates, never approve textbook answers."""

import gzip
import hashlib
import json
import re
import unicodedata
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data/biaori/words.json"
OUT = ROOT / "output/biaori"
LEVELS = ("初级", "中级", "高级")
HAN = re.compile(r"[\u3400-\u9fff\U00020000-\U0003134f]")
KANA = re.compile(r"[ぁ-ゖァ-ヺー・]+")


def norm(text):
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", text)).replace("〜", "~")


def hira(text):
    return "".join(chr(ord(c) - 0x60) if "ァ" <= c <= "ヶ" else c for c in norm(text))


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_lines(path, rows):
    with path.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


class RubyText(HTMLParser):
    """Upstream uses span superscript=... rather than standard ruby elements."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.surface, self.reading, self.stack = [], [], []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        ruby = attrs.get("superscript") if tag == "span" else None
        self.stack.append(ruby is not None)
        if ruby is not None:
            self.reading.append(ruby)

    def handle_endtag(self, tag):
        if self.stack:
            self.stack.pop()

    def handle_data(self, text):
        self.surface.append(text)
        if not any(self.stack):
            self.reading.append(text)


def split_outside_parentheses(text):
    parts, start, depth = [], 0, 0
    for i, char in enumerate(text):
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
        elif char == "/" and depth == 0:
            parts.append(text[start:i])
            start = i + 1
    parts.append(text[start:])
    return parts


def paired_variants(reading, surface):
    readings, surfaces = reading.split("/"), surface.split("/")
    if len(readings) == len(surfaces):
        return list(zip(readings, surfaces))
    if len(readings) == 1:
        return [(reading, s) for s in surfaces]
    if len(surfaces) == 1:
        return [(r, surface) for r in readings]
    return []


def parse_rows(raw):
    rows = []
    for index, item in enumerate(raw):
        assert len(item) == 5 and isinstance(item[0], int), (index, item)
        code, pos, meaning, word, timing = item
        assert all(isinstance(s, str) and s for s in (pos, meaning, word))
        assert len(timing) == 2 and all(isinstance(t, (float, int)) for t in timing)
        book, unit, lesson = code // 10000, (code % 10000) // 100 + 1, code % 100 + 1
        assert 0 <= book < 3 and 1 <= lesson <= (48, 32, 24)[book]
        assert unit == (lesson - 1) // 4 + 1
        flags, variants = [], []
        if "<" in word:
            flags.append("embedded_html")
            parser = RubyText()
            parser.feed(word)
            surfaces = norm("".join(parser.surface)).split("/")
            readings = norm("".join(parser.reading)).split("/")
            if len(surfaces) == len(readings):
                variants = list(zip(readings, surfaces))
            else:
                flags.append("html_multiple_readings_needs_review")
                # Keep the surface searchable without inventing reading alignment.
                variants = [("", s) for s in surfaces]
        else:
            text = norm(word)
            # A single pair may contain parallel alternatives on both sides.
            whole = re.fullmatch(r"([^()]*)\(([^()]*)\)(\[[^\]]*\])?", text)
            parts = [text] if whole else split_outside_parentheses(text)
            for part in parts:
                m = re.fullmatch(r"([^()]*)\(([^()]*)\)(\[[^\]]*\])?", part)
                if m:
                    paired = paired_variants(m[1], m[2])
                    variants.extend(paired)
                    if not paired:
                        flags.append("unparsed_alternatives")
                    if m[3]:
                        flags.append("pos_embedded_in_word")
                elif "(" in part or ")" in part:
                    flags.append("unparsed_parentheses")
                else:
                    variants.append((part if KANA.fullmatch(part) else "", part))
        candidates = []
        for reading, surface in variants:
            if "~" in surface or "~" in reading:
                flags.append("placeholder")
            if not reading or not KANA.fullmatch(reading):
                flags.append("reading_not_plain_kana")
            candidates.append({"surface": surface, "reading": reading, "method": "source"})
            # Only explicit suru abbreviations, never guess arbitrary omitted text.
            if surface.endswith("~") and "动3" in norm(pos):
                ending = next((s for s in ("します", "する") if reading.endswith(s)), None)
                if ending:
                    stem = surface[:-1]
                    candidates.append({"surface": stem + ending, "reading": reading,
                                       "method": "explicit_suru_expansion"})
                    candidates.append({"surface": stem, "reading": reading[:-len(ending)],
                                       "method": "suru_stem_candidate"})
        if pos == "/":
            flags.append("pos_unspecified")
        if meaning == "/":
            flags.append("meaning_unspecified")
        if timing == [0, 0]:
            flags.append("audio_missing_marker")
        elif timing[1] <= timing[0]:
            flags.append("audio_nonpositive_duration")
        rows.append({"source_row": index, "level": LEVELS[book], "unit": unit,
                     "lesson": lesson, "pos_raw": pos, "pos_normalized": norm(pos),
                     "meaning_zh": meaning, "word_raw": word, "audio_seconds": timing,
                     "candidates": candidates, "flags": sorted(set(flags))})
    return rows


def dictionary_audit(rows):
    pairs = {(c["surface"], hira(c["reading"])) for row in rows for c in row["candidates"]
             if c["method"] == "source" and KANA.fullmatch(c["reading"])
             and HAN.search(c["surface"]) and "~" not in c["surface"]}
    by_surface = defaultdict(set)
    for surface, reading in pairs:
        by_surface[surface].add(reading)
    valid, present = set(), set()
    with gzip.open(ROOT / "data/jmdict/JMdict.gz", "rb") as f:
        for _, entry in ET.iterparse(f, events=("end",)):
            if entry.tag != "entry":
                continue
            surfaces = {norm(v.text) for v in entry.findall("k_ele/keb")}
            relevant = surfaces & by_surface.keys()
            present.update(relevant)
            for r in entry.findall("r_ele"):
                if r.find("re_nokanji") is not None:
                    continue
                restrictions = {norm(v.text) for v in r.findall("re_restr")}
                reading = hira(r.findtext("reb"))
                for surface in relevant & (restrictions or relevant):
                    if reading in by_surface[surface]:
                        valid.add((surface, reading))
            entry.clear()
    absent = sorted(pairs - valid)
    return {"unique_full_kanji_surface_reading_pairs": len(pairs),
            "jmdict_confirmed_pairs": len(valid),
            "surface_found_but_reading_not_confirmed": sum(s in present for s, _ in absent),
            "surface_not_found": sum(s not in present for s, _ in absent),
            "unconfirmed_pairs": [{"surface": s, "reading": r,
                                   "surface_in_jmdict": s in present} for s, r in absent],
            "note": "未命中不等于错误；包含敬体、专名、短语和新词。不作活用还原。"}


def match_pdfs(rows):
    indexes = [defaultdict(list), defaultdict(list)]
    for row in rows:
        for c in row["candidates"]:
            key = (row["level"], norm(c["surface"]))
            indexes[0][key].append((row, c))
            if KANA.fullmatch(c["reading"]):
                indexes[1][(row["level"], hira(c["reading"]))].append((row, c))
    matches = []
    for line in (ROOT / "output/coverage/pdf_records.jsonl").read_text().splitlines():
        pdf = json.loads(line)
        lessons = {v["lesson"] for v in pdf["references"]}
        annotations = [hira(a[1:-1]) for a in pdf["annotations"] if KANA.fullmatch(norm(a[1:-1]))]
        queries = []
        for query in norm(pdf["lookup_key"]).split("/"):
            found = list(indexes[0].get((pdf["level"], query), []))
            if KANA.fullmatch(query):
                found.extend(indexes[1].get((pdf["level"], hira(query)), []))
            if annotations:
                found = [(r, c) for r, c in found if hira(c["reading"]) in annotations]
            hits = {(r["source_row"], c["surface"], c["reading"], c["method"]): (r, c)
                    for r, c in found}
            queries.append({"query": query, "candidates": [
                {"source_row": r["source_row"], "lesson": r["lesson"],
                 "same_lesson": r["lesson"] in lessons, **c} for r, c in hits.values()]})
        matches.append({"pdf_id": pdf["id"], "level": pdf["level"], "surface": pdf["surface"],
                        "lessons": sorted(lessons), "queries": queries,
                        "source_match": all(any(c["method"] == "source" for c in q["candidates"])
                                            for q in queries),
                        "with_suru_candidates": all(q["candidates"] for q in queries),
                        "same_lesson_source_match": all(any(c["same_lesson"] and c["method"] == "source"
                                                             for c in q["candidates"]) for q in queries),
                        "same_lesson_with_suru": all(any(c["same_lesson"] for c in q["candidates"])
                                                     for q in queries),
                        "previous_zhwiktionary_candidate": pdf["coverage_status"] in
                        {"direct_or_canonical", "additional_variant_or_reading"},
                        "sense_verified_against_textbook": False})
    return matches


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    raw = json.loads(SOURCE.read_text())
    rows = parse_rows(raw)
    matches = match_pdfs(rows)
    coverage = {}
    for level in (*LEVELS[:2], "合并"):
        subset = [r for r in matches if level == "合并" or r["level"] == level]
        counts = {key: sum(r[key] for r in subset) for key in
                  ("source_match", "with_suru_candidates", "same_lesson_source_match", "same_lesson_with_suru")}
        coverage[level] = {"pdf_records": len(subset), **counts,
                           "source_match_percent": round(counts["source_match"] / len(subset) * 100, 2),
                           "with_suru_percent": round(counts["with_suru_candidates"] / len(subset) * 100, 2),
                           "additional_over_previous_zhwiktionary": sum(r["with_suru_candidates"] and not
                               r["previous_zhwiktionary_candidate"] for r in subset),
                           "union_with_previous_zhwiktionary": sum(r["with_suru_candidates"] or
                               r["previous_zhwiktionary_candidate"] for r in subset)}
    duplicate_keys = defaultdict(list)
    for r in rows:
        for c in r["candidates"]:
            if c["method"] == "source":
                duplicate_keys[(r["level"], c["surface"], hira(c["reading"]))].append(r["source_row"])
    duplicates = [{"level": k[0], "surface": k[1], "reading": k[2], "source_rows": sorted(set(v))}
                  for k, v in duplicate_keys.items() if len(set(v)) > 1]
    summary = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_url": "https://raw.githubusercontent.com/smartsl/biaori/main/words.json",
        "source_sha256": sha(SOURCE), "source_bytes": SOURCE.stat().st_size,
        "source_commit": None, "version_note": "按内容 SHA-256 固定审计快照；未获取提交号。",
        "pdf_records_sha256": sha(ROOT / "output/coverage/pdf_records.jsonl"),
        "jmdict_sha256": sha(ROOT / "data/jmdict/JMdict.gz"),
        "rows": len(rows),
        "books": {level: {"records": len([r for r in rows if r["level"] == level]),
                           "lessons": sorted({r["lesson"] for r in rows if r["level"] == level}),
                           "flags": dict(Counter(f for r in rows if r["level"] == level for f in r["flags"]))}
                  for level in LEVELS},
        "field_types": ["integer", "string", "string", "string", "[number, number]"],
        "flags": dict(Counter(f for r in rows for f in r["flags"])),
        "raw_pos_variants": len({r["pos_raw"] for r in rows}),
        "nfkc_pos_variants": len({r["pos_normalized"] for r in rows}),
        "exact_duplicate_rows": len(raw) - len({json.dumps(r, ensure_ascii=False) for r in raw}),
        "duplicate_surface_reading_groups_within_level": len(duplicates),
        "pdf_candidate_coverage": coverage,
        "dictionary_cross_check": dictionary_audit(rows),
        "methodology": [
            "仅审计，不把候选写入正式词库；不生成词义或自动核准教材读音。",
            "NFKC、去空白、统一波浪线；拆括号与斜线变体；span superscript 提取为读音。",
            "保留原始字段、原始行号（从0开始）、级别、单元、课次和告警。",
            "PDF 匹配限定同级别；假名允许平片假名统一；PDF 纯假名括注限制候选读音。",
            "斜线分隔的全部词形均检索到才计覆盖；另报同课候选覆盖。",
            "source_match 只用拆分后的原字段；with_suru_candidates 另加明示的サ变～展开及词干。",
            "不推断其他～省略、不把敬体自动还原辞书形、不作模糊匹配。",
            "覆盖率是候选检索率，尚未按所有词性/义项逐条核准，也不是教材完整率。",
            "JMdict 仅核对完整含汉字词形与假名配对，遵守 re_restr 和 re_nokanji。"]}
    write_lines(OUT / "normalized_candidates.jsonl", rows)
    write_lines(OUT / "pdf_matches.jsonl", matches)
    write_json(OUT / "duplicate_groups.json", duplicates)
    write_json(OUT / "summary.json", summary)
    print(json.dumps({k: v for k, v in summary.items() if k not in {"dictionary_cross_check", "books"}},
                     ensure_ascii=False, indent=2))
    print("dictionary_cross_check", json.dumps({k: v for k, v in summary["dictionary_cross_check"].items()
                                               if k != "unconfirmed_pairs"}, ensure_ascii=False))


if __name__ == "__main__":
    main()
