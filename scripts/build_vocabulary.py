#!/usr/bin/env python3
"""Build a bilingual vocabulary and a separate, lossless human review queue."""

import copy
import csv
import hashlib
import json
import re
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

from check_zhwiktionary_coverage import (
    ROOT, SOURCES, HAN_RE, KANA_RE, canonical_surface, extract_pdfs, hira, norm, sha256,
)
from check_jitendex_coverage import data_kind, load_dictionary, match_rows, text, walk
from vocabulary_curation import inflection_for

DEST = ROOT / "data/vocabulary"
MAIN = DEST / "vocabulary.json"
REVIEW = DEST / "review.json"
ZH_DIR = ROOT / "data/jitendex-zh"
EN_DIR = ROOT / "data/jitendex-en"
HIRA_RE = re.compile(r"[ぁ-ゖゝゞー・\u3099\u309a]+")
REASON_NAMES = {
    "unmatched": "主要中文词典中未找到可用候选",
    "multiple_readings": "存在多个平假名读音，教材词汇表未明确指定",
    "multiple_dictionary_entries": "同一词形和读音对应多个独立词条",
    "textbook_usage_context": "原文限定了搭配或用法，需核对教材对应义项",
    "invalid_source_symbol": "PDF 原文的课次符号异常，未自动改正",
    "invalid_hiragana": "无法得到纯假名读音",
    "bilingual_alignment": "中英文条目或义项结构无法可靠对应",
    "missing_bilingual_gloss": "缺少中文或英文释义",
    "complex_restriction": "词典词形或读音限制格式需要人工核对",
    "upstream_translation_issue": "中文版上游已标记此释义待核对",
    "variant_translation_conflict": "同一义项在不同写法记录中的译文不一致",
}


def stable_id(prefix, *parts):
    payload = json.dumps(parts, ensure_ascii=False, separators=(",", ":"))
    return prefix + hashlib.sha256(payload.encode()).hexdigest()[:20]


def dump(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def annotation_info(row):
    readings, context, labels = [], [], []
    for note in row["annotations"]:
        body = note[1:-1].strip()
        if note.startswith(("[", "［", "【")):
            labels.append(note)
        elif (note.startswith(("(", "（")) and note.endswith((")", "）"))
              and KANA_RE.fullmatch(body) and body not in {"ことわざ"}
              and not body.endswith(("を", "が", "へ"))
              and (HAN_RE.search(row["lookup_key"]) or row["lookup_key"] == "@")):
            readings.append(hira(body))
        elif body == "ことわざ":
            labels.append(note)
        else:
            context.append(note)
    return {"readings": readings, "context": context, "labels": labels}


def numbered_style(node):
    value = node.get("style", {}).get("listStyleType", "").strip('"')
    if len(value) == 1 and "①" <= value <= "⑳":
        return ord(value) - ord("①") + 1
    return None


def header_codes(node, kind):
    return sorted({n["data"]["code"] for n in walk(node, {"sense", "extra-info", "forms", "attribution"})
                   if data_kind(n) == kind and n.get("data", {}).get("code")})


def limits(node, skip):
    return list(dict.fromkeys(text(n).strip() for n in walk(node, skip)
        if n.get("title") == "valid only for these forms and/or readings"))


def applies(restrictions, word, reading):
    unsupported = []
    for restriction in restrictions:
        body = restriction.replace("〔", "").replace("〕", "").strip()
        if not body.endswith(" only"):
            unsupported.append(restriction)
            continue
        parts = re.split(r",\s*|、|\s+or\s+", body[:-5].strip())
        if not all(part and not any(c in part for c in "[]{};") for part in parts):
            unsupported.append(restriction)
            continue
        if not any(norm(part) == norm(word) or hira(part) == hira(reading) for part in parts):
            return False, unsupported
    return True, unsupported


def raw_senses(glossary):
    """Keep every original sense ordinal, including ones excluded by restrictions."""
    skip = {"extra-info", "forms", "attribution"}
    result = []
    for group in (n for n in walk(glossary, skip) if data_kind(n) == "sense-group"):
        group_limits = limits(group, skip | {"sense"})
        group_pos = header_codes(group, "part-of-speech-info")
        group_misc = header_codes(group, "misc-info")
        for node in (n for n in walk(group, skip) if data_kind(n) == "sense"):
            glosses = []
            for gloss in (n for n in walk(node, skip) if data_kind(n) == "glossary"):
                items = gloss.get("content", [])
                if not isinstance(items, list):
                    items = [items]
                glosses.extend(value for item in items if (value := text(item).strip()))
            local_pos = [n["data"]["code"] for n in walk(node, skip)
                         if data_kind(n) == "part-of-speech-info" and n.get("data", {}).get("code")]
            result.append({
                "number": len(result) + 1, "display_number": numbered_style(node) or numbered_style(group),
                "glosses": list(dict.fromkeys(glosses)), "pos": sorted(set(group_pos + local_pos)),
                "restrictions": group_limits + limits(node, skip),
                "notes": list(dict.fromkeys(text(n).strip() for n in walk(node)
                              if data_kind(n) == "sense-note-content")),
                "labels": sorted(set(group_misc + [n["data"]["code"] for n in walk(node, skip)
                    if data_kind(n) in {"misc-info", "field-info", "dialect-info"} and n["data"].get("code")])),
            })
    return result


def aligned_records(records):
    by_bank = defaultdict(list)
    for record in records:
        by_bank[record["source_member"]].append(record)
    output = {}
    with zipfile.ZipFile(ZH_DIR / "dictionary.zip") as zh, zipfile.ZipFile(EN_DIR / "dictionary.zip") as en:
        for bank in sorted(by_bank):
            zterms, eterms = json.loads(zh.read(bank)), json.loads(en.read(bank))
            assert len(zterms) == len(eterms), bank
            for record in by_bank[bank]:
                pos = record["source_offset"]
                zt, et = zterms[pos], eterms[pos]
                assert (zt[0], zt[1], zt[6]) == (et[0], et[1], et[6]), (bank, pos)
                assert (zt[0], zt[1] or zt[0], zt[6]) == (record["word"], record["reading"], record["jmdict_id"])
                zs, es = raw_senses(zt[5]), raw_senses(et[5])
                errors, senses = [], []
                if len(zs) != len(es):
                    errors.append("bilingual_alignment")
                else:
                    for z, e in zip(zs, es):
                        if (z["pos"], z["restrictions"], z["display_number"]) != (e["pos"], e["restrictions"], e["display_number"]):
                            errors.append("bilingual_alignment")
                        compatible, unsupported = applies(e["restrictions"], record["word"], record["reading"])
                        if not compatible:
                            continue
                        if unsupported:
                            errors.append("complex_restriction")
                        if not z["glosses"] or not e["glosses"] or not any(HAN_RE.search(g) for g in z["glosses"]):
                            errors.append("missing_bilingual_gloss")
                        senses.append({
                            "id": f"jmdict:{record['jmdict_id']}:sense:{e['number']}",
                            "number": e["number"], "pos": e["pos"],
                            "zh": z["glosses"], "en": e["glosses"], "labels": e["labels"],
                            "restrictions": e["restrictions"], "notes_zh": z["notes"], "notes_en": e["notes"],
                        })
                output[record["id"]] = {"senses": senses, "issues": sorted(set(errors)),
                    "source": {"jmdict_id": record["jmdict_id"], "word": record["word"],
                               "reading": record["reading"], "member": bank, "offset": pos,
                               "definition_tags": record["definition_tags"]}}
    return output


def source_record(row, component):
    source = {"row_id": row["id"], "query": component, "original_word": row["surface"],
            "review_key": row["review_id"],
            "level": row["level"], "lessons": [{"lesson": r["lesson"], "symbol": r["symbol"]} for r in row["references"]],
            "pdf": row["source_pdf"], "pdf_page": row["pdf_page"], "book_page": row["original_book_page"],
            "annotations": row["annotations"], "raw_line": row["raw_line"]}
    if row.get("corrected_lessons") is not None:
        source["corrected_lessons"] = copy.deepcopy(row["corrected_lessons"])
        source["correction_note"] = row["correction_note"]
    return source


def compact_references(sources):
    by_level = defaultdict(set)
    for source in sources:
        for ref in source.get("corrected_lessons", source["lessons"]):
            by_level[source["level"]].add((ref["lesson"], ref["symbol"]))
    return "；".join(level + "、".join(str(n) + symbol for n, symbol in sorted(by_level[level]))
                     for level in ("初级", "中级") if level in by_level)


def add_unique(target, value):
    if value not in target:
        target.append(copy.deepcopy(value))


def allowed_pos(row, component, sense, method):
    pos = set(sense["pos"])
    if component.startswith("~") and not pos.intersection({"suf", "n-suf", "ctr", "prt"}):
        return False
    if component.endswith("~") and not pos.intersection({"pref", "n-pref"}):
        return False
    if method.startswith("suru") and "vs" not in pos:
        return False
    if any("叹词" in n for n in row["annotations"]) and "int" not in pos:
        return False
    if any(n in {"[姓]", "[人名]", "[姓名]"} for n in row["annotations"]) and "pn" not in pos:
        return False
    if any("助词" in n for n in row["annotations"]) and not pos.intersection({"prt", "suf"}):
        return False
    adverbial_form = row.get("inflection", {}).get("form") in {"adverbial_ku", "adverbial_ni"}
    if any("副词" in n for n in row["annotations"]) and not adverbial_form and not pos.intersection({"adv", "adv-to"}):
        return False
    return True


def load_upstream_issues():
    issues = defaultdict(list)
    with (ZH_DIR / "upstream-uncertain.csv").open(encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            if row["kind"] in {"gloss", "info", "note"}:
                issues[int(row["jmdict_id"])].append(row)
    return issues


def candidates_for(row, records, aligned, upstream):
    output = []
    for match in row["matches"]:
        grouped = {}
        for hit in match["hits"]:
            rid, method = hit["record_id"], match["method"]
            record, pair = records[rid], aligned[rid]
            form = row.get("inflection") if method == "verified_inflection_lemma" else None
            if form and not any(form["required_pos"] in s["pos"] for s in pair["senses"]):
                continue
            reading = hira(hit["matched_reading"])
            derived = method.startswith("suru")
            derivation = "inflection:" + form["form"] if form else ("suru" if derived else None)
            key = (record["jmdict_id"], reading, derivation)
            if key not in grouped:
                grouped[key] = {
                    # Keep pre-curation candidate IDs stable for existing manual
                    # choices; the original key used a boolean suru marker.
                    "id": stable_id("candidate-", match["query"], record["jmdict_id"], reading,
                                    derivation if form else derived),
                    "word": match["query"], "reading_hiragana": reading,
                    "jmdict_id": record["jmdict_id"], "derivation": derivation,
                    "matching_methods": [], "meanings_zh": [], "meanings_en": [], "senses": [],
                    "dictionary_matches": [], "issues": [], "upstream_review_notes": [], "sense_variants": [],
                }
                if form:
                    grouped[key]["inflection"] = copy.deepcopy(form)
            candidate = grouped[key]
            add_unique(candidate["matching_methods"], method)
            add_unique(candidate["dictionary_matches"], pair["source"])
            for issue in pair["issues"]:
                add_unique(candidate["issues"], issue)
            if not HIRA_RE.fullmatch(reading):
                add_unique(candidate["issues"], "invalid_hiragana")
            for sense in pair["senses"]:
                if form and form["required_pos"] not in sense["pos"]:
                    continue
                if not allowed_pos(row, match["query"], sense, method):
                    continue
                existing = next((s for s in candidate["senses"] if s["id"] == sense["id"]), None)
                if existing is not None and (existing["zh"], existing["en"]) != (sense["zh"], sense["en"]):
                    add_unique(candidate["issues"], "variant_translation_conflict")
                    add_unique(candidate["sense_variants"], existing)
                    add_unique(candidate["sense_variants"], sense)
                elif existing is None:
                    candidate["senses"].append(copy.deepcopy(sense))
                for gloss in sense["zh"]:
                    add_unique(candidate["meanings_zh"], gloss)
                for gloss in sense["en"]:
                    add_unique(candidate["meanings_en"], gloss)
            if not candidate["meanings_zh"] or not candidate["meanings_en"]:
                add_unique(candidate["issues"], "missing_bilingual_gloss")
        for candidate in grouped.values():
            if not candidate["senses"]:
                continue
            en_texts = {norm(g) for g in candidate["meanings_en"]}
            notes_en = {norm(g) for s in candidate["senses"] for g in s["notes_en"]}
            for issue in upstream.get(candidate["jmdict_id"], []):
                if norm(issue["source_en"]) in en_texts | notes_en:
                    add_unique(candidate["issues"], "upstream_translation_issue")
                    add_unique(candidate["upstream_review_notes"], issue)
            candidate["issues"].sort()
        output.append({"query": match["query"], "candidates": sorted(
            (c for c in grouped.values() if c["senses"] or "bilingual_alignment" in c["issues"]), key=lambda c: c["id"])})
    return output


def row_reasons(row, components):
    reasons = set()
    for component in components:
        cs = component["candidates"]
        if not cs:
            reasons.add("unmatched")
        if len({c["reading_hiragana"] for c in cs}) > 1:
            reasons.add("multiple_readings")
        if len({c["jmdict_id"] for c in cs}) > 1:
            reasons.add("multiple_dictionary_entries")
        for candidate in cs:
            reasons.update(candidate["issues"])
    if row["annotation_info"]["context"]:
        reasons.add("textbook_usage_context")
    if row["warnings"]:
        reasons.add("invalid_source_symbol")
    return sorted(reasons)


def make_entry(candidate):
    fields = ["word", "reading_hiragana", "jmdict_id", "derivation", "meanings_zh", "meanings_en",
              "senses", "dictionary_matches", "matching_methods"]
    entry = {k: copy.deepcopy(candidate[k]) for k in fields}
    if candidate.get("inflection"):
        entry["inflection"] = copy.deepcopy(candidate["inflection"])
        entry["meanings_scope"] = "lemma"
    entry.update(id=stable_id("word-", candidate["word"], candidate["reading_hiragana"], candidate["jmdict_id"], candidate["derivation"]),
                 sources=[], references="", resolution_status="automatic_unique", textbook_verified=False)
    return entry


def variant_signature(sense):
    # Keep approvals scoped to the exact dictionary content, not merely its ID.
    return stable_id("variant-", sense)


def normalize_translations(components, approvals, log):
    for component in components:
        for candidate in component["candidates"]:
            remaining = False
            for sense in candidate["senses"]:
                variants = [s for s in candidate["sense_variants"] if s["id"] == sense["id"]]
                if not variants:
                    continue
                approval = approvals.get(sense["id"])
                if not approval or not all(variant_signature(s) in approval["variant_signatures"] for s in variants):
                    remaining = True
                    continue
                assert approval["note"].strip()
                assert all(s["en"] == approval["english"] for s in variants)
                assert approval["canonical_zh"] == approval["canonical_source"]["zh"]
                assert variant_signature(approval["canonical_source"]) in approval["variant_signatures"]
                original = copy.deepcopy(variants)
                sense["zh"] = copy.deepcopy(approval["canonical_zh"])
                sense["translation_variants"] = original
                sense["normalization_note"] = approval["note"]
                log.append({"kind": "translation_normalization", "query": component["query"],
                            "candidate_id": candidate["id"], "sense_id": sense["id"]})
            if not remaining and "variant_translation_conflict" in candidate["issues"]:
                candidate["issues"].remove("variant_translation_conflict")
            candidate["meanings_zh"] = list(dict.fromkeys(g for s in candidate["senses"] for g in s["zh"]))
            candidate["meanings_en"] = list(dict.fromkeys(g for s in candidate["senses"] for g in s["en"]))


def exclude_obsolete_readings(row, components, log):
    for component in components:
        candidates = component["candidates"]

        def obsolete(c):
            return bool(c["dictionary_matches"]) and all(
                "obsolete reading" in m["definition_tags"].replace("\u00a0", " ")
                for m in c["dictionary_matches"])

        active_ids = {c["jmdict_id"] for c in candidates if not obsolete(c)}
        excluded = [c for c in candidates if obsolete(c) and c["jmdict_id"] in active_ids
                    and c["reading_hiragana"] not in row["annotation_info"]["readings"]
                    and c["id"] not in row.get("protected_candidate_ids", [])]
        if excluded:
            component["excluded_candidates"] = excluded
            component["candidates"] = [c for c in candidates if c not in excluded]
            for c in excluded:
                log.append({"kind": "obsolete_reading_excluded", "query": component["query"],
                            "candidate_id": c["id"], "reading_hiragana": c["reading_hiragana"],
                            "jmdict_id": c["jmdict_id"], "dictionary_matches": c["dictionary_matches"]})


def merge_entry(entries, candidate, row, manual=False):
    proposed = make_entry(candidate)
    entry = entries.setdefault(proposed["id"], proposed)
    for field in ("meanings_zh", "meanings_en", "senses", "dictionary_matches", "matching_methods"):
        for value in candidate[field]:
            add_unique(entry[field], value)
    add_unique(entry["sources"], source_record(row, candidate["word"]))
    for adjustment in row.get("processing_adjustments", []):
        add_unique(entry.setdefault("processing_notes", []), adjustment)
    if manual:
        entry["resolution_status"] = "manual_resolution"
    return entry


def resources():
    result = {}
    for name, directory in [("jitendex_zh", ZH_DIR), ("jitendex_en", EN_DIR)]:
        result[name] = {
            "metadata": json.loads((directory / "metadata.json").read_text()),
            "attribution": json.loads((directory / "index.json").read_text())["attribution"],
        }
    result["jitendex_zh_upstream_review"] = {
        "url": "https://github.com/greyindex/jitendex-yomitan-zh/blob/main/reports/2026-09-27/uncertain.csv",
        "sha256": sha256(ZH_DIR / "upstream-uncertain.csv"),
    }
    result["pdfs"] = [{"level": level, "filename": name, "sha256": sha256(ROOT / name)} for level, name in SOURCES]
    return result


def validate(main, review, rows):
    entries = main["entries"]
    accepted, pending = set(), set()
    row_map = {r["id"]: r for r in rows}
    accepted_parts, pending_counts = defaultdict(set), Counter()

    def validate_source(source):
        row = row_map[source["row_id"]]
        for out, original in [("original_word", "surface"), ("level", "level"), ("pdf", "source_pdf"),
                              ("pdf_page", "pdf_page"), ("book_page", "original_book_page"), ("raw_line", "raw_line")]:
            assert source[out] == row[original], (row["id"], out)
        assert source["lessons"] == [{"lesson": r["lesson"], "symbol": r["symbol"]} for r in row["references"]]
        if "corrected_lessons" in source:
            assert source["corrected_lessons"] == row["corrected_lessons"]
            assert source["correction_note"].strip()
    assert len({e["id"] for e in entries}) == len(entries)
    assert len({(e["word"], e["reading_hiragana"], e["jmdict_id"], e["derivation"]) for e in entries}) == len(entries)
    for entry in entries:
        assert HIRA_RE.fullmatch(entry["reading_hiragana"]), entry["word"]
        assert entry["meanings_zh"] and entry["meanings_en"] and entry["senses"]
        assert all(s["zh"] and s["en"] for s in entry["senses"]), entry["word"]
        if entry.get("inflection"):
            form = entry["inflection"]
            assert entry["reading_hiragana"] == form["surface_reading_hiragana"]
            assert form["meanings_scope"] == "lemma"
            assert all(form["required_pos"] in s["pos"] for s in entry["senses"])
        assert all(r["symbol"] in {"", "※", "▼"} for s in entry["sources"]
                   for r in s.get("corrected_lessons", s["lessons"]))
        assert len({json.dumps(s, sort_keys=True, ensure_ascii=False) for s in entry["sources"]}) == len(entry["sources"])
        assert entry["references"] == compact_references(entry["sources"])
        for source in entry["sources"]:
            validate_source(source)
            accepted_parts[source["row_id"]].add(source["query"])
        accepted.update(s["row_id"] for s in entry["sources"])
    for issue in review["unmatched"] + review["ambiguous"]:
        assert issue["reasons"]
        assert issue["references"] == compact_references(issue["sources"])
        for source in issue["sources"]:
            validate_source(source)
            pending_counts[source["row_id"]] += 1
        pending.update(s["row_id"] for s in issue["sources"])
    assert not accepted & pending, accepted & pending
    assert accepted | pending == {r["id"] for r in rows}
    assert all(count == 1 for count in pending_counts.values())
    assert all(parts == set(row_map[row_id]["lookup_key"].split("/")) for row_id, parts in accepted_parts.items())
    assert len(rows) == 7687
    return accepted, pending


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    for directory in (ZH_DIR, EN_DIR):
        metadata = json.loads((directory / "metadata.json").read_text())
        assert sha256(directory / "dictionary.zip") == metadata["sha256"], directory
    previous = json.loads(REVIEW.read_text()) if REVIEW.exists() else {}
    resolutions = previous.get("resolutions", {})
    normalizations = previous.get("translation_normalizations", {})
    rows, audits = extract_pdfs()
    for row in rows:
        row["review_id"] = stable_id("review-", norm(row["surface"]))
        resolution = resolutions.get(row["review_id"], {})
        row["protected_candidate_ids"] = resolution.get("candidate_ids", [])
        if resolution.get("replacement_word"):
            assert resolution.get("note", "").strip(), "Word corrections require an evidence note"
            row["lookup_key"] = canonical_surface(resolution["replacement_word"])
        correction = resolution.get("source_corrections", {}).get(str(row["id"]))
        if correction:
            assert correction["expected_raw_line"] == row["raw_line"]
            assert correction["note"].strip()
            assert all(r["symbol"] in {"", "※", "▼"} for r in correction["lessons"])
            row["corrected_lessons"] = correction["lessons"]
            row["correction_note"] = correction["note"]
            row["warnings"] = []
        row["annotation_info"] = annotation_info(row)
    lemma_inputs = []
    for row in rows:
        form = inflection_for(row["lookup_key"])
        if form:
            lemma = copy.deepcopy(row)
            lemma["lookup_key"] = form["lemma"]
            lemma["annotations"] = ["(" + form["lemma_reading_hiragana"] + ")"]
            lemma_inputs.append(lemma)
    records, direct, reading, aliases, dictionary_stats = load_dictionary(rows + lemma_inputs)
    # The old coverage parser treated all kana brackets as readings. Only actual
    # reading annotations and word-class labels are passed to its matching stage.
    match_inputs = copy.deepcopy(rows)
    for row in match_inputs:
        row["annotations"] = ["(" + r + ")" for r in row["annotation_info"]["readings"]] + [
            n for n in row["annotation_info"]["labels"] if n.startswith(("[", "［", "【"))]
    match_rows(match_inputs, records, direct, reading, aliases)
    match_rows(lemma_inputs, records, direct, reading, aliases)
    lemmas_by_row = {r["id"]: r for r in lemma_inputs}
    for row, matched in zip(rows, match_inputs):
        row["matches"] = matched["matches"]
        if row["id"] in lemmas_by_row and all(not m["hits"] for m in row["matches"]):
            form = inflection_for(row["lookup_key"])
            hits = copy.deepcopy(lemmas_by_row[row["id"]]["matches"][0]["hits"])
            if hits:
                for hit in hits:
                    hit["matched_reading"] = form["surface_reading_hiragana"]
                row["matches"] = [{"query": row["lookup_key"], "method": "verified_inflection_lemma", "hits": hits}]
                row["inflection"] = form
    aligned = aligned_records(records)
    upstream = load_upstream_issues()
    entries, issue_groups, processing_log = {}, {}, []
    manual_rows = 0
    for row in rows:
        components = candidates_for(row, records, aligned, upstream)
        adjustments = []
        if row.get("inflection"):
            adjustments.append({"kind": "inflection_lemma_link", "inflection": row["inflection"]})
        exclude_obsolete_readings(row, components, adjustments)
        normalize_translations(components, normalizations, adjustments)
        if adjustments:
            processing_log.append({"row_id": row["id"], "review_key": row["review_id"],
                                   "original_word": row["surface"], "adjustments": adjustments})
        row["processing_adjustments"] = adjustments
        reasons = row_reasons(row, components)
        decision = resolutions.get(row["review_id"], {})
        chosen = [c["candidates"][0] for c in components if len(c["candidates"]) == 1]
        manual = bool((decision.get("replacement_word") or decision.get("source_corrections"))
                      and not reasons and len(chosen) == len(components))
        if decision.get("candidate_ids"):
            assert decision.get("note", "").strip(), "Manual resolutions require an evidence note"
            chosen_ids = set(decision["candidate_ids"])
            chosen = [c for part in components for c in part["candidates"] if c["id"] in chosen_ids]
            assert {c["id"] for c in chosen} == chosen_ids, (row["review_id"], "Unknown candidate ID")
            assert all(sum(c["word"] == part["query"] for c in chosen) == 1 for part in components)
            assert all(c["meanings_zh"] and c["meanings_en"] and HIRA_RE.fullmatch(c["reading_hiragana"]) for c in chosen)
            manual = True
        if (not reasons and len(chosen) == len(components)) or manual:
            for candidate in chosen:
                entry = merge_entry(entries, candidate, row, manual)
                if manual:
                    add_unique(entry.setdefault("curation_notes", []), {
                        "review_key": row["review_id"], "note": decision["note"],
                        "replacement_word": decision.get("replacement_word"),
                    })
            manual_rows += int(manual)
        else:
            issue = issue_groups.setdefault(row["review_id"], {
                "id": row["review_id"], "word": row["lookup_key"], "original_word": row["surface"],
                "reasons": [], "components": [], "sources": [], "references": "",
            })
            for reason in reasons:
                add_unique(issue["reasons"], reason)
            for component in components:
                add_unique(issue["components"], component)
            add_unique(issue["sources"], source_record(row, row["lookup_key"]))
    for entry in entries.values():
        entry["sources"].sort(key=lambda s: (s["row_id"], s["query"]))
        entry["senses"].sort(key=lambda s: s["number"])
        entry["references"] = compact_references(entry["sources"])
    unmatched, ambiguous = [], []
    for issue in issue_groups.values():
        issue["reasons"].sort()
        issue["sources"].sort(key=lambda s: s["row_id"])
        issue["references"] = compact_references(issue["sources"])
        (unmatched if "unmatched" in issue["reasons"] else ambiguous).append(issue)
    meta = {
        "build_script": "scripts/build_vocabulary.py", "resources": resources(),
        "licence": "CC BY-SA 4.0 for dictionary-derived content; retain upstream/third-party attribution",
        "policy": {
            "primary_chinese": "Jitendex unofficial Chinese v2026.08.11-zh.4",
            "english": "Official Jitendex 2026.08.11.0 / JMdict, same upstream snapshot as Chinese",
            "alignment": "Exact ZIP member, row, expression, reading and JMdict ID; pair original sense ordinals and verify POS/restrictions",
            "merge_key": ["word", "reading_hiragana", "jmdict_id", "derivation"],
            "ordinary_polysemy": "Retain all applicable dictionary senses; do not guess one textbook translation",
            "ambiguity": "Multiple readings/IDs, textbook usage context, abnormal symbols, missing bilingual data or upstream glossary concerns go to review",
            "no_automatic_common_reading_selection": True,
            "obsolete_readings": "Exclude only explicitly obsolete readings when the same JMdict ID has an active reading; preserve explicit PDF readings and log exclusions",
            "inflections": "Explicit surface/lemma/reading/POS mappings; retain surface spelling and label dictionary glosses as lemma meanings",
            "translation_normalization": "Only reviewed exact sense variants in review.json.translation_normalizations; retain original translations in senses.translation_variants",
            "source_corrections": "Preserve original lessons and raw_line; display separately recorded corrected_lessons with evidence",
            "kana_display": "Hiragana reading only; keep the original Japanese word spelling",
            "textbook_verification": "Automatic unique matches are not claimed to match the textbook's exact reading/translation",
            "manual_resolutions": "Preserved in review.json.resolutions; choose exactly one candidate per component and record evidence in note",
        },
        "pdf_page_audits": audits,
    }
    production = {"schema_version": 1, "metadata": copy.deepcopy(meta),
                  "entries": sorted(entries.values(), key=lambda e: (e["word"], e["reading_hiragana"], e["id"]))}
    queue = {"schema_version": 1, "metadata": copy.deepcopy(meta), "reason_codes": REASON_NAMES,
             "resolutions": resolutions,
             "translation_normalizations": normalizations,
             "processing_log": processing_log,
             "unmatched": sorted(unmatched, key=lambda i: (i["word"], i["id"])),
             "ambiguous": sorted(ambiguous, key=lambda i: (i["word"], i["id"]))}
    accepted, pending = validate(production, queue, rows)
    summary = {
        "input_pdf_rows": len(rows), "input_by_level": dict(Counter(r["level"] for r in rows)),
        "main_entries": len(entries), "accepted_pdf_rows": len(accepted),
        "unmatched_groups": len(unmatched), "unmatched_pdf_rows": len({s["row_id"] for i in unmatched for s in i["sources"]}),
        "ambiguous_groups": len(ambiguous), "ambiguous_pdf_rows": len({s["row_id"] for i in ambiguous for s in i["sources"]}),
        "pending_pdf_rows": len(pending), "manual_resolved_pdf_rows": manual_rows,
        "merged_additional_source_occurrences": sum(max(len(e["sources"]) - 1, 0) for e in entries.values()),
        "entries_in_both_levels": sum(len({s["level"] for s in e["sources"]}) == 2 for e in entries.values()),
        "review_reasons": dict(Counter(reason for i in issue_groups.values() for reason in i["reasons"])),
        "bilingual_records_checked": len(aligned),
        "bilingual_alignment_issue_records": sum("bilingual_alignment" in a["issues"] for a in aligned.values()),
        "processing_adjustments": dict(Counter(a["kind"] for row in processing_log for a in row["adjustments"])),
        "inflected_main_entries": sum(bool(e.get("inflection")) for e in entries.values()),
        "approved_translation_senses": len(normalizations),
    }
    for document in (production, queue):
        document["metadata"]["summary"] = summary
    # Persist only after the complete in-memory documents pass validation.
    dump(MAIN, production)
    dump(REVIEW, queue)
    # Validate the saved representation as well, including literal newlines and Unicode.
    validate(json.loads(MAIN.read_text()), json.loads(REVIEW.read_text()), rows)
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
