"""Regression checks for curation boundaries that can silently lose distinctions."""

import copy
import unittest

from build_vocabulary import (
    compact_references, exclude_obsolete_readings, normalize_translations,
    variant_signature,
)
from vocabulary_curation import inflection_for


def candidate(cid, reading, jid=1, obsolete=False):
    return {"id": cid, "jmdict_id": jid, "reading_hiragana": reading,
            "dictionary_matches": [{"definition_tags": "obsolete\u00a0reading" if obsolete else "★"}]}


class CurationBoundaryTests(unittest.TestCase):
    def test_only_explicitly_obsolete_reading_with_same_lexeme_alternative_is_excluded(self):
        old, modern = candidate("old", "あんせん", obsolete=True), candidate("new", "あんぜん")
        parts = [{"query": "安全", "candidates": [old, modern]}]
        log = []
        exclude_obsolete_readings({"annotation_info": {"readings": []}}, parts, log)
        self.assertEqual(parts[0]["candidates"], [modern])
        self.assertEqual(parts[0]["excluded_candidates"], [old])
        self.assertEqual(log[0]["reading_hiragana"], "あんせん")

    def test_old_only_readings_and_other_lexemes_are_retained(self):
        old, unrelated = candidate("old", "あんせん", obsolete=True), candidate("other", "あんぜん", jid=2)
        parts = [{"query": "安全", "candidates": [old, unrelated]}]
        exclude_obsolete_readings({"annotation_info": {"readings": []}}, parts, [])
        self.assertEqual(parts[0]["candidates"], [old, unrelated])

    def test_textbook_explicit_reading_takes_precedence(self):
        old, modern = candidate("old", "あんせん", obsolete=True), candidate("new", "あんぜん")
        parts = [{"query": "安全", "candidates": [old, modern]}]
        exclude_obsolete_readings({"annotation_info": {"readings": ["あんせん"]}}, parts, [])
        self.assertEqual(parts[0]["candidates"], [old, modern])

    def test_existing_manual_choice_takes_precedence_over_obsolete_filter(self):
        old, modern = candidate("old", "あんせん", obsolete=True), candidate("new", "あんぜん")
        parts = [{"query": "安全", "candidates": [old, modern]}]
        row = {"annotation_info": {"readings": []}, "protected_candidate_ids": ["old"]}
        exclude_obsolete_readings(row, parts, [])
        self.assertEqual(parts[0]["candidates"], [old, modern])

    def normalization_fixture(self):
        a = {"id": "sense:1", "zh": ["清空"], "en": ["to empty"]}
        b = {"id": "sense:1", "zh": ["腾空"], "en": ["to empty"]}
        c = {"id": "c", "senses": [copy.deepcopy(a)], "sense_variants": [a, b],
             "issues": ["variant_translation_conflict", "upstream_translation_issue"]}
        approval = {"sense:1": {"canonical_zh": a["zh"], "canonical_source": a,
                    "english": a["en"], "variant_signatures": [variant_signature(a), variant_signature(b)],
                    "note": "Reviewed synonym wording; same source sense."}}
        return [{"query": "あける", "candidates": [c]}], approval

    def test_approved_synonyms_preserve_originals_and_other_review_reasons(self):
        parts, approvals = self.normalization_fixture()
        normalize_translations(parts, approvals, [])
        c = parts[0]["candidates"][0]
        self.assertEqual(c["meanings_zh"], ["清空"])
        self.assertEqual(c["issues"], ["upstream_translation_issue"])
        self.assertEqual(len(c["senses"][0]["translation_variants"]), 2)

    def test_new_dictionary_translation_does_not_inherit_old_approval(self):
        parts, approvals = self.normalization_fixture()
        parts[0]["candidates"][0]["sense_variants"][1]["zh"] = ["未经复核的新译文"]
        normalize_translations(parts, approvals, [])
        self.assertIn("variant_translation_conflict", parts[0]["candidates"][0]["issues"])

    def test_inflected_form_keeps_negation_and_reading_metadata(self):
        form = inflection_for("分かりません")
        self.assertEqual(form["form"], "polite_negative")
        self.assertEqual(form["surface_reading_hiragana"], "わかりません")
        self.assertEqual(form["lemma"], "分かる")
        self.assertEqual(form["meanings_scope"], "lemma")
        self.assertIsNone(inflection_for("何のお構いもできませんで"))

    def test_corrected_display_does_not_change_original_source_symbols(self):
        source = {"level": "初级", "lessons": [{"lesson": 23, "symbol": "ス"}],
                  "corrected_lessons": [{"lesson": 23, "symbol": ""}]}
        self.assertEqual(compact_references([source]), "初级23")
        self.assertEqual(source["lessons"][0]["symbol"], "ス")


if __name__ == "__main__":
    unittest.main()
