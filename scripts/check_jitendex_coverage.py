#!/usr/bin/env python3
"""Audit Jitendex Chinese candidate coverage without approving textbook senses."""

import csv
import json
import re
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timezone
from urllib.parse import parse_qs, urlparse

from check_zhwiktionary_coverage import (
    ROOT, SOURCES, HAN_RE, KANA_RE, extract_pdfs, hira, norm, sha256,
    statistics, write_json,
)

DATA = ROOT / "data/jitendex-zh"
OUT = ROOT / "output/jitendex-coverage"
ARCHIVE = DATA / "dictionary.zip"


def walk(value, skip=()):
    if isinstance(value, list):
        for item in value:
            yield from walk(item, skip)
    elif isinstance(value, dict):
        if value.get("data", {}).get("content") in skip:
            return
        yield value
        yield from walk(value.get("content"), skip)


def text(value):
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "".join(text(item) for item in value)
    if isinstance(value, dict):
        if value.get("tag") in {"rt", "rp"}:
            return ""
        return text(value.get("content")) or value.get("alt", "")
    return ""


def data_kind(node):
    return node.get("data", {}).get("content")


def restrictions(node, skip):
    return list(dict.fromkeys(text(n).strip() for n in walk(node, skip)
        if n.get("title") == "valid only for these forms and/or readings"))


def permits_simple_restrictions(limits, expression, reading):
    for limit in limits:
        value = limit.replace("〔", "").replace("〕", "")
        if not value.endswith(" only"):
            continue
        value = value[:-5].strip()
        # Enforce simple explicit limits; retain complex annotations for review.
        if re.fullmatch(r"[\u3400-\u9fffぁ-ゖァ-ヺー々]+", value):
            if norm(value) != norm(expression) and hira(value) != hira(reading):
                return False
    return True


def chinese_senses(glossary, expression, reading):
    # Never mine Chinese examples, cross-references or attribution as definitions.
    skip = {"extra-info", "forms", "attribution"}
    groups = [n for n in walk(glossary, skip) if data_kind(n) == "sense-group"]
    senses = []
    for group in groups:
        group_limits = restrictions(group, skip | {"sense"})
        if not permits_simple_restrictions(group_limits, expression, reading):
            continue
        codes = sorted({n["data"]["code"] for n in walk(group, skip)
                        if data_kind(n) == "part-of-speech-info" and n["data"].get("code")})
        for sense in (n for n in walk(group, skip) if data_kind(n) == "sense"):
            sense_limits = restrictions(sense, skip)
            if not permits_simple_restrictions(sense_limits, expression, reading):
                continue
            glosses = []
            for node in walk(sense, skip):
                if data_kind(node) != "glossary":
                    continue
                items = node.get("content", [])
                if not isinstance(items, list):
                    items = [items]
                glosses.extend(g for item in items if (g := text(item).strip()) and HAN_RE.search(g))
            if glosses:
                senses.append({"pos_codes": codes, "glosses": list(dict.fromkeys(glosses)),
                    "form_reading_limits": group_limits + sense_limits,
                    "notes": list(dict.fromkeys(text(n).strip() for n in walk(sense)
                        if data_kind(n) == "sense-note-content")),
                    "field_codes": sorted({n["data"]["code"] for n in walk(sense, skip)
                        if data_kind(n) == "field-info" and n["data"].get("code")})})
    return senses


def load_dictionary(rows):
    queries = {key.strip("~") for row in rows for key in row["lookup_key"].split("/")}
    kana_queries = {hira(q) for q in queries if KANA_RE.fullmatch(q)}
    records, direct, reading = [], defaultdict(list), defaultdict(list)
    aliases = defaultdict(list)
    bank_counts, sequences, expressions = {}, set(), set()
    total = 0
    with zipfile.ZipFile(ARCHIVE) as z:
        banks = sorted((n for n in z.namelist() if n.startswith("term_bank_") and n.endswith(".json")),
                       key=lambda n: int(n.removeprefix("term_bank_").removesuffix(".json")))
        # Redirects carry negative synthetic sequence IDs and no definitions.
        # Read their explicit destination before selecting relevant lexical rows.
        for bank in banks:
            for offset, term in enumerate(json.loads(z.read(bank))):
                if term[6] >= 0:
                    continue
                for node in walk(term[5]):
                    if data_kind(node) != "redirect-glossary":
                        continue
                    for link in walk(node):
                        if link.get("tag") != "a":
                            continue
                        params = parse_qs(urlparse(link.get("href", "")).query)
                        if params.get("query"):
                            aliases[norm(term[0])].append({
                                "target": norm(params["query"][0]),
                                "target_reading": params.get("primary_reading", [""])[0],
                                "source_member": bank, "source_offset": offset,
                            })
        relevant_targets = set()
        frontier = queries | {q[:-2] for q in queries if q.endswith("する")}
        for _ in range(10):
            frontier = {a["target"] for key in frontier for a in aliases.get(key, [])} - relevant_targets
            if not frontier:
                break
            relevant_targets.update(frontier)
        for bank in banks:
            terms = json.loads(z.read(bank))
            bank_counts[bank] = len(terms)
            for offset, term in enumerate(terms):
                assert len(term) == 8, (bank, offset)
                expression, kana, tags, rules, score, glossary, sequence, term_tags = term
                total += 1
                if sequence > 0:
                    sequences.add(sequence)
                expressions.add(expression)
                key, rkey = norm(expression), hira(kana or expression)
                if not (key in queries or key in relevant_targets or rkey in kana_queries or key + "する" in queries
                        or (rkey + "する" in kana_queries)):
                    continue
                senses = chinese_senses(glossary, expression, kana or expression)
                if not senses:
                    continue
                rid = len(records)
                record = {
                    "id": rid, "word": expression, "reading": kana or expression,
                    "jmdict_id": sequence, "definition_tags": tags, "rule_codes": rules,
                    "term_tags": term_tags, "score": score, "senses": senses,
                    "source_member": bank, "source_offset": offset,
                    "url": f"https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&q={sequence}",
                }
                records.append(record)
                direct[key].append(rid)
                reading[rkey].append(rid)
    assert total == 435448 and len(sequences) == 211107, (total, len(sequences))
    return records, direct, reading, aliases, {
        "term_banks": len(banks), "term_records": total, "unique_jmdict_ids": len(sequences),
        "distinct_expressions": len(expressions), "indexed_relevant_records_with_chinese_glosses": len(records),
        "bank_record_counts": bank_counts,
    }


def eligible_senses(row, key, record, method):
    expected_readings = [hira(n[1:-1]) for n in row["annotations"] if KANA_RE.fullmatch(n[1:-1])]
    matched_reading = record["reading"] + ("する" if method.startswith("suru") else "")
    if expected_readings and hira(matched_reading) not in expected_readings:
        return []
    eligible = []
    for index, sense in enumerate(record["senses"]):
        codes = set(sense["pos_codes"])
        if key.startswith("~") and not codes.intersection({"suf", "n-suf", "ctr", "prt"}):
            continue
        if key.endswith("~") and not codes.intersection({"pref", "n-pref"}):
            continue
        if method.startswith("suru") and "vs" not in codes:
            continue
        if any("叹词" in n for n in row["annotations"]) and "int" not in codes:
            continue
        if any(n in {"[姓]", "[人名]"} for n in row["annotations"]) and "pn" not in codes:
            continue
        if any("助词" in n for n in row["annotations"]) and not codes.intersection({"prt", "suf"}):
            continue
        eligible.append(index)
    return eligible


def match_rows(rows, records, direct, reading, aliases):
    def redirected(key, seen=None):
        seen = set() if seen is None else seen
        if key in seen or len(seen) >= 10:
            return set()
        seen = seen | {key}
        ids = set()
        for alias in aliases.get(key, []):
            targets = set(direct.get(alias["target"], [])) | redirected(alias["target"], seen)
            ids.update(rid for rid in targets if not alias["target_reading"] or
                       hira(records[rid]["reading"]) == hira(alias["target_reading"]))
        return ids

    for row in rows:
        matches = []
        for key in row["lookup_key"].split("/"):
            query = key.strip("~")
            lookups = {query}
            if key.startswith("~"):
                lookups.add("-" + query)
            if key.endswith("~"):
                lookups.add(query + "-")
            methods = [("direct", {rid for lookup in lookups for rid in direct.get(lookup, [])})]
            methods.append(("explicit_redirect", {rid for lookup in lookups for rid in redirected(lookup)}))
            if KANA_RE.fullmatch(query):
                methods.append(("reading", set(reading.get(hira(query), []))))
            if query.endswith("する") and len(query) > 2:
                base = query[:-2]
                methods.append(("suru_explicit_pos", set(direct.get(base, [])) | redirected(base)))
                if KANA_RE.fullmatch(base):
                    methods.append(("suru_reading_explicit_pos", set(reading.get(hira(base), []))))
            match = {"query": key, "method": "unmatched", "hits": []}
            for method, candidates in methods:
                hits = []
                for rid in sorted(candidates):
                    senses = eligible_senses(row, key, records[rid], method)
                    if senses:
                        hits.append({"record_id": rid, "sense_indexes": senses,
                                     "matched_reading": records[rid]["reading"] +
                                     ("する" if method.startswith("suru") else "")})
                if hits:
                    match.update(method=method, hits=hits)
                    break
            matches.append(match)
        methods = {m["method"] for m in matches}
        if "unmatched" in methods:
            status = "partial" if len(methods) > 1 else "unmatched"
        elif methods == {"direct"}:
            status = "direct_or_canonical"
        else:
            status = "additional_variant_or_reading"
        row.update(coverage_status=status, matches=matches, structure_warning=False,
                   sense_verified_against_textbook=False)


def write_details(rows, records):
    with (OUT / "pdf_records.jsonl").open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    used = {h["record_id"] for r in rows for m in r["matches"] for h in m["hits"]}
    with (OUT / "matched_dictionary_records.jsonl").open("w", encoding="utf-8") as f:
        for rid in sorted(used):
            f.write(json.dumps(records[rid], ensure_ascii=False) + "\n")
    fields = ["level", "surface", "lookup_key", "raw_references", "coverage_status", "methods",
              "matched_words_readings", "chinese_glosses", "source_pdf", "pdf_page", "original_book_page", "warnings"]
    with (OUT / "coverage.csv").open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            hits = [h for m in row["matches"] for h in m["hits"]]
            output = {k: row[k] for k in fields if k in row}
            output.update(
                methods=";".join(m["method"] for m in row["matches"]),
                matched_words_readings=";".join(dict.fromkeys(
                    records[h["record_id"]]["word"] + "【" + h["matched_reading"] + "】" for h in hits)),
                chinese_glosses=" | ".join(dict.fromkeys(g for h in hits
                    for i in h["sense_indexes"] for g in records[h["record_id"]]["senses"][i]["glosses"])),
                warnings=";".join(row["warnings"]))
            writer.writerow(output)
    with (OUT / "unmatched.csv").open("w", encoding="utf-8-sig", newline="") as f:
        fields = ["level", "surface", "lookup_key", "raw_references", "coverage_status", "source_pdf", "pdf_page"]
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            if row["coverage_status"] in {"unmatched", "partial"}:
                writer.writerow({k: row[k] for k in fields})


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    rows, audits = extract_pdfs()
    records, direct, reading, aliases, dictionary_stats = load_dictionary(rows)
    match_rows(rows, records, direct, reading, aliases)
    stats = {level: statistics([r for r in rows if r["level"] == level]) for level, _ in SOURCES}
    stats["合并"] = statistics(rows)
    summary = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "dictionary": {**dictionary_stats, "metadata": json.loads((DATA / "metadata.json").read_text())},
        "input_sha256": {name: sha256(ROOT / name) for _, name in SOURCES},
        "statistics": stats, "page_audits": audits,
        "query_method_counts": dict(Counter(m["method"] for r in rows for m in r["matches"])),
        "methodology": [
            "复用中文维基词典检查脚本的 PDF 提取、括注清理、NFKC、前后缀标记和不同词形分母。",
            "只从 Yomitan 结构化内容的 sense/glossary 字段取中文释义，不把例句、交叉引用、标签或署名计入释义。",
            "直接覆盖要求 expression 整词匹配且有中文义项；保留对应读音和 JMdict ID。",
            "追加候选包括追踪词典明确跳转、平片假名读音匹配，以及词典明确标注 vs 的词形加する；三种补充方式分别标记。",
            "する 补充不计为直接匹配；只借用带 vs 标记义项的原始中文，不生成新的译文。",
            "前后缀/量词、叹词、助词、人名按词典词性限制；PDF 明示读音必须匹配。",
            "斜线分隔的多个写法须全部找到候选才计完整覆盖；不改疑似 OCR，不拆复合词，不作模糊匹配。",
            "去重单位为清理后的查询词形；不同读音和用法的原始 PDF 行及来源分别保留。",
            "这是中文释义候选检索覆盖率；词条中的各义项及适用限制尚未与教材逐条核对。",
        ],
        "previous_zhwiktionary_statistics": json.loads((ROOT / "output/coverage/summary.json").read_text())["statistics"],
    }
    write_json(OUT / "summary.json", summary)
    write_details(rows, records)
    examples = []
    for key, kana, sequence, sense_no in [
        ("開ける", "あける", 1202450, 0),
        ("環境保護", "かんきょうほご", 1666040, 0),
        ("技術開発", "ぎじゅつかいはつ", 2451130, 0),
        ("育児", "いくじ", 1160630, 0),
        ("安心する", "あんしんする", 1153890, 0),
        ("発表", "はっぴょう", 1477840, 0),
    ]:
        sources = [r for r in rows if r["lookup_key"] == key]
        candidates = [(records[h["record_id"]], h, m["method"]) for r in sources
            for m in r["matches"] for h in m["hits"]
            if records[h["record_id"]]["jmdict_id"] == sequence and hira(h["matched_reading"]) == kana]
        assert candidates, (key, kana, sequence)
        record, hit, method = candidates[0]
        sense = record["senses"][hit["sense_indexes"][sense_no]]
        examples.append({"word": key, "reading": kana, "method": method,
            "chinese_glosses_original": sense["glosses"], "selected_sense_index": sense_no,
            "dictionary_record": record,
            "references": [ref for row in sources for ref in row["references"]],
            "source_rows": sources, "verified_against_textbook": False})
    write_json(OUT / "examples.json", examples)
    print(json.dumps({"dictionary": {k: v for k, v in dictionary_stats.items() if k != "bank_record_counts"},
                      "statistics": stats, "query_method_counts": summary["query_method_counts"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
