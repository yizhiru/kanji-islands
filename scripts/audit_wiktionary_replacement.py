#!/usr/bin/env python3
"""Audit independent Wiktionary definitions without changing application data.

Reading references are the application's resolved JMdict readings, NOT an
independent textbook pronunciation gold standard. Matching does not align senses.
"""
import csv
import gzip
import hashlib
import json
import random
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from check_zhwiktionary_coverage import norm, hira, ruby_reading, canonical_surface, sha256, extract_pdfs

ROOT = Path(__file__).resolve().parents[1]
PROCESSED = '--zh-processed' in sys.argv
OUT = ROOT / ('output/wiktionary-replacement-processed' if PROCESSED else 'output/wiktionary-replacement')
DATA = ROOT / 'data/wiktionary-audit'
EXCLUDED_POS = {'romanization', 'syllable', 'soft-redirect', 'hard-redirect', 'symbol'}
KANA = re.compile(r'[ぁ-ゖァ-ヺー・]+')
REFERENCE_ONLY = re.compile(r'^(.+?)(?:の(?:漢字表記|片仮名表記|カタカナ表記|平仮名表記|ひらがな表記|学術的表記|異表記|別表記)|\s+参照)[。.]?$')
BAD = re.compile(r'\{\{|\}\}|\[\[|\]\]|<[^>]+>|={2,}|\n')
TARGETS = [('新しい', 'あたらしい'), ('安心する', 'あんしんする'), ('研究する', 'けんきゅうする'),
           ('開く', 'あく'), ('開く', 'ひらく'), ('開ける', 'あける'), ('上手', 'じょうず'),
           ('生', 'なま'), ('人気', 'にんき'), ('大丈夫', 'だいじょうぶ'), ('かける', 'かける'),
           ('すみません', 'すみません'), ('いただく', 'いただく'), ('パソコン', 'ぱそこん'),
           ('つける', 'つける'), ('発表', 'はっぴょう'), ('意識', 'いしき')]


def dump(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def is_kana(s):
    return bool(KANA.fullmatch(norm(s)))


def load_dictionary(language):
    path = DATA / ('zh-processed.jsonl.gz' if language == 'zh' and PROCESSED else f'{language}-raw.jsonl.gz')
    records, direct, aliases = [], defaultdict(set), defaultdict(set)
    links = defaultdict(set)
    counts = Counter()
    with gzip.open(path, 'rt', encoding='utf-8') as stream:
        for line in stream:
            counts['all_languages_records'] += 1
            e = json.loads(line)
            if e.get('lang_code') != 'ja':
                continue
            counts['japanese_records'] += 1
            if e.get('pos') in EXCLUDED_POS:
                counts['excluded_pos'] += 1
                continue
            if e.get('pos') == 'character' and len(norm(e['word'])) == 1:
                counts['excluded_single_character'] += 1
                continue
            for sense in e.get('senses', []):
                for target in sense.get('form_of', []) + sense.get('alt_of', []):
                    links[norm(e['word'])].add(norm(target['word']))
                for gloss in sense.get('glosses', []):
                    match = REFERENCE_ONLY.fullmatch(gloss)
                    if match:
                        links[norm(e['word'])].add(norm(match[1]))
            senses = [s for s in e.get('senses', []) if s.get('glosses') and
                      not all(REFERENCE_ONLY.fullmatch(g) for g in s['glosses']) and
                      not (s.get('alt_of') or s.get('form_of') or 'no-gloss' in s.get('tags', []))]
            if not senses:
                counts['no_independent_definition'] += 1
                continue
            readings = set()
            if is_kana(e['word']):
                readings.add(hira(e['word']))
            surfaces = {norm(e['word'])}
            alternate = set()
            for form in e.get('forms', []):
                tags = form.get('tags', [])
                if 'canonical' in tags:
                    surfaces.add(norm(form['form']))
                    reading = ruby_reading(form)
                    if reading:
                        readings.add(reading)
                    elif is_kana(form['form']):
                        readings.add(hira(form['form']))
                if 'transliteration' in tags and is_kana(form.get('form', '')):
                    # Do not inherit a character's on/kun list as lexical readings.
                    if not set(tags) & {'go-on', 'kan-on', 'to-on', 'kun', 'ko-kun'}:
                        readings.add(hira(form['form']))
                if set(tags) & {'alternative', 'alternative-spelling', 'kanji'}:
                    alternate.add(norm(form['form']))
            rid = len(records)
            glosses = [g for s in senses for g in s['glosses']]
            records.append({'id': rid, 'word': e['word'], 'pos': e.get('pos'),
                            'readings': sorted(readings), 'glosses': glosses,
                            'embedded_readings': sorted({hira(m[2]) for g in glosses
                                if (m := re.match(r'([^【]+)【([^】]+)】', g)) and
                                norm(m[1]) == norm(e['word']) and is_kana(m[2])}),
                            'senses': senses, 'forms': e.get('forms', []),
                            'tags': e.get('tags', []), 'notes': e.get('notes', []),
                            'duplicate_glosses': len(glosses) != len(set(glosses)),
                            'structure_warning': any(BAD.search(g) for g in glosses)})
            for surface in surfaces:
                direct[surface].add(rid)
            for surface in alternate:
                aliases[surface].add(rid)
    for surface, targets in links.items():
        for target in targets:
            aliases[surface].update(direct.get(target, set()))
    counts['usable_records'] = len(records)
    counts['usable_records_with_reading'] = sum(bool(r['readings']) for r in records)
    return records, direct, aliases, dict(counts)


def classify(word, reading, dictionary):
    records, direct, aliases, _ = dictionary
    ids = direct.get(norm(word), set())
    result = {'surface': bool(ids), 'reading_status': 'no_surface', 'ids': sorted(ids)}
    if ids:
        known = [r for i in ids for r in records[i]['readings']]
        if not reading:
            status = 'no_reference_reading'
        elif any(hira(reading) == hira(r) for r in known):
            status = 'match'
        elif known:
            status = 'conflict'
        else:
            status = 'unavailable'
        result['reading_status'] = status
        result['structure_warning'] = any(records[i]['structure_warning'] for i in ids)
        result['embedded_reading_match'] = status == 'unavailable' and any(hira(reading) in records[i]['embedded_readings'] for i in ids)
        result['matching_ids'] = [i for i in ids if hira(reading) in records[i]['readings']]
    else:
        alias_ids = aliases.get(norm(word), set())
        result['alias_candidate'] = bool(alias_ids)
        result['alias_matching_ids'] = [i for i in alias_ids if reading and hira(reading) in records[i]['readings']]
        result['alias_matching_reading'] = bool(result['alias_matching_ids'])
        result['alias_ids'] = sorted(alias_ids)
    return result


def coarse_pos(positions):
    result = set()
    for p in positions:
        if p.startswith('v'):
            result.add('verb')
        elif p.startswith('adj'):
            result.add('adj')
        elif p.startswith('n'):
            result.add('noun')
        elif p.startswith('adv'):
            result.add('adv')
        elif p in {'pn', 'pron'}:
            result.add('pron')
        elif p in {'int', 'intj'}:
            result.add('intj')
        elif p in {'prt', 'particle'}:
            result.add('particle')
    return result


def wiki_pos(position):
    return {'adj_noun': {'noun', 'adj'}, 'name': {'noun'}, 'adj': {'adj'}}.get(position, {position})


def summarize(rows, language):
    c = Counter()
    for row in rows:
        x = row[language]
        c['total'] += 1
        c['surface'] += x['surface']
        c[x['reading_status']] += 1
        c['structure_warning'] += x.get('structure_warning', False)
        c['alias_only_candidate'] += x.get('alias_candidate', False)
        c['alias_only_reading_match'] += x.get('alias_matching_reading', False)
        for key in ['reading_and_pos', 'alias_reading_and_pos', 'multiple_readings', 'reading_matched_structure_warning', 'embedded_reading_match', 'duplicate_glosses', 'unknown_pos_candidate']:
            c[key] += x.get(key, False)
    result = dict(c)
    for key in ['surface', 'match', 'conflict', 'unavailable', 'no_reference_reading', 'no_surface']:
        result.setdefault(key, 0)
        result[key + '_percent_of_total'] = round(100 * result[key] / c['total'], 2) if c['total'] else 0
    result['reading_match_percent_of_surface'] = round(100 * c['match'] / c['surface'], 2) if c['surface'] else 0
    return result


def csv_rows(path, rows):
    fields = ['id', 'word', 'reading', 'levels', 'inflection', 'references', 'zh_surface',
              'zh_reading_status', 'ja_surface', 'ja_reading_status']
    with path.open('w', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            data = {k: row.get(k, '') for k in fields if not k.startswith(('zh_', 'ja_'))}
            data['levels'] = ','.join(row.get('levels', []))
            for language in ['zh', 'ja']:
                for key in ['surface', 'reading_status']:
                    data[f'{language}_{key}'] = row[language][key]
            writer.writerow(data)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    dictionaries = {}
    for language in ['zh', 'ja']:
        dictionaries[language] = load_dictionary(language)
        print(language, dictionaries[language][3], flush=True)
    textbook = json.loads((ROOT / 'data/vocabulary/vocabulary.json').read_text())
    entries = textbook['entries']
    rows = []
    for e in entries:
        row = {'id': e['id'], 'word': e['word'], 'reading': e['reading_hiragana'],
               'levels': sorted({s['level'] for s in e['sources']}),
               'inflection': bool(e.get('inflection')), 'references': e['references'],
               'current_zh': e['meanings_zh'], 'current_en': e['meanings_en'],
               'pos': sorted({p for s in e['senses'] for p in s['pos']})}
        for language in dictionaries:
            row[language] = classify(row['word'], row['reading'], dictionaries[language])
            x = row[language]
            records = dictionaries[language][0]
            positions = coarse_pos(row['pos'])
            x['reading_and_pos'] = any(positions & wiki_pos(records[i]['pos']) for i in x.get('matching_ids', []))
            x['alias_reading_and_pos'] = any(positions & wiki_pos(records[i]['pos']) for i in x.get('alias_matching_ids', []))
            x['multiple_readings'] = any(len(records[i]['readings']) > 1 for i in x.get('matching_ids', []))
            x['duplicate_glosses'] = any(records[i]['duplicate_glosses'] for i in x.get('matching_ids', []))
            x['unknown_pos_candidate'] = any(records[i]['pos'] == 'unknown' for i in x.get('matching_ids', []))
            x['reading_matched_structure_warning'] = any(records[i]['structure_warning'] for i in x.get('matching_ids', []))
        rows.append(row)
    summary = {'application_input_hashes': {str(p.relative_to(ROOT)): sha256(p) for p in [ROOT / 'data/vocabulary/vocabulary.json', ROOT / 'data/vocabulary/standard.json', ROOT / '初级词汇表_完整校对文字版.pdf', ROOT / '中级词汇表_完整校对文字版.pdf']}, 'methodology': {
        'reading_reference': 'Resolved application JMdict reading; not independently verified textbook pronunciation.',
        'surface': 'NFKC and whitespace normalization; headword or canonical spelling; independent lexical gloss required.',
        'reading': 'Kana normalization only; explicit canonical ruby/transliteration or kana headword; no romanization guessing.',
        'sense_alignment': 'Not measured automatically; surface+reading match does NOT establish textbook sense coverage.',
        'aliases': 'Alternative spellings counted separately, not in direct coverage.',
        'suru': 'No stripping suru or stemming; inflected forms are not silently replaced by lemmas.',
        'sources': 'Kaikki 2026-11-01 Wikimedia dumps; downloaded 2026-11-10. See inputs for raw versus processed paths.',
        'sampling': 'Seed 20261110: 12 reading-matched entries per language per textbook level, plus 17 targeted word-reading combinations per language (including full dictionary controls).',
    }, 'inputs': {}, 'textbook_resolved_entries': {}, 'pdf_rows': {}, 'full_application_entries': {}}
    for language in dictionaries:
        input_path = DATA / ('zh-processed.jsonl.gz' if language == 'zh' and PROCESSED else f'{language}-raw.jsonl.gz')
        summary['inputs'][language] = {'path': str(input_path),
            'sha256': sha256(input_path),
            'bytes': input_path.stat().st_size,
            'source_url': ([
                'https://kaikki.org/zhwiktionary/%E6%97%A5%E8%AA%9E/kaikki.org-dictionary-%E6%97%A5%E8%AA%9E.jsonl.gz',
                'https://kaikki.org/zhwiktionary/%E6%97%A5%E8%AF%AD/kaikki.org-dictionary-%E6%97%A5%E8%AF%AD.jsonl.gz'] if language == 'zh' and PROCESSED else f'https://kaikki.org/{language}wiktionary/raw-wiktextract-data.jsonl.gz'),
            'statistics': dictionaries[language][3]}
        summary['textbook_resolved_entries'][language] = {
            level: summarize([r for r in rows if level == '合并' or level in r['levels']], language)
            for level in ['初级', '中级', '合并']}
    summary['textbook_unique_word_readings'] = {}
    for language in dictionaries:
        summary['textbook_unique_word_readings'][language] = {}
        for level in ['初级', '中级', '合并']:
            unique = {(r['word'], r['reading']): r for r in rows if level == '合并' or level in r['levels']}
            summary['textbook_unique_word_readings'][language][level] = summarize(list(unique.values()), language)
    # Include unresolved PDF vocabulary, rather than inflating coverage by using only resolved entries.
    pdf_rows, page_audits = extract_pdfs()
    summary['pdf_page_audits'] = page_audits
    by_pdf_id = defaultdict(list)
    for e in entries:
        for source in e['sources']:
            by_pdf_id[source['row_id']].append(e['reading_hiragana'])
    pdf_results = []
    for p in pdf_rows:
        parts = re.split(r'[/／]', canonical_surface(p['surface']))
        expected = sorted(set(by_pdf_id.get(p['id'], [])))
        row = {'id': p['id'], 'word': p['surface'], 'reading': '/'.join(expected), 'levels': [p['level']]}
        for language, dictionary in dictionaries.items():
            candidates = [classify(w, '', dictionary) for w in parts]
            ids = sorted({i for c in candidates for i in c['ids']})
            hit = all(c['surface'] for c in candidates)
            readings = {r for i in ids for r in dictionary[0][i]['readings']}
            status = ('no_surface' if not hit else 'no_reference_reading' if not expected else
                      'match' if any(hira(r) in readings for r in expected) else
                      'conflict' if readings else 'unavailable')
            # A PDF row with alternatives needs an independently matching reading for each spelling.
            if hit and status == 'match' and not all(any(hira(r) in dictionary[0][i]['readings']
                    for i in c['ids'] for r in expected) for c in candidates):
                status = 'partial_reading'
            row[language] = {'surface': hit, 'reading_status': status}
        pdf_results.append(row)
    for language in dictionaries:
        summary['pdf_rows'][language] = {level: summarize([r for r in pdf_results if level == '合并' or level in r['levels']], language)
            for level in ['初级', '中级', '合并']}
    summary['pdf_unique_surfaces'] = {}
    for language in dictionaries:
        summary['pdf_unique_surfaces'][language] = {}
        for level in ['初级', '中级', '合并']:
            unique = {canonical_surface(r['word']): r for r in pdf_results if level == '合并' or level in r['levels']}
            summary['pdf_unique_surfaces'][language][level] = summarize(list(unique.values()), language)
    full = json.loads((ROOT / 'data/vocabulary/standard.json').read_text())
    summary['full_application_unique_words'] = {}
    for language, dictionary in dictionaries.items():
        counter = Counter()
        word_status = defaultdict(list)
        for e in full['entries']:
            c = classify(e['word'], e['reading_hiragana'], dictionary)
            word_status[norm(e['word'])].append(c['reading_status'])
            counter['total'] += 1
            counter['surface'] += c['surface']
            counter[c['reading_status']] += 1
            counter['alias_only_reading_match'] += c.get('alias_matching_reading', False)
        summary['full_application_entries'][language] = dict(counter)
        summary['full_application_unique_words'][language] = {
            'total': len(word_status),
            'surface': sum(any(s != 'no_surface' for s in statuses) for statuses in word_status.values()),
            'at_least_one_reference_reading_match': sum('match' in statuses for statuses in word_status.values()),
            'all_reference_readings_match': sum(all(s == 'match' for s in statuses) for statuses in word_status.values()),
        }
    samples = []
    for language, dictionary in dictionaries.items():
        rng = random.Random(20261110)
        for level in ['初级', '中级']:
            pool = sorted([r for r in rows if level in r['levels'] and r[language]['reading_status'] == 'match'], key=lambda r: r['id'])
            for r in rng.sample(pool, min(12, len(pool))):
                samples.append({'language': language, 'sample_group': level, 'entry': r})
        for word, reading in TARGETS:
            r = next((r for r in rows if r['word'] == word and r['reading'] == reading), None)
            if r:
                samples.append({'language': language, 'sample_group': 'targeted', 'entry': r})
            else:
                e = next((e for e in full['entries'] if e['word'] == word and e['reading_hiragana'] == reading), None)
                senses = [full['senses'][i] for i in e['sense_ids']] if e else []
                samples.append({'language': language, 'sample_group': 'targeted_full_dictionary_control',
                    'entry': {'word': word, 'reading': reading,
                        'current_zh': sorted({g for sense in senses for g in sense['zh']}),
                        'pos': sorted({p for sense in senses for p in sense['pos']}),
                        language: classify(word, reading, dictionary)}})
    for sample in samples:
        language, r = sample['language'], sample['entry']
        ids = r[language].get('matching_ids') or r[language].get('alias_matching_ids') or r[language]['ids'] or r[language].get('alias_ids', [])
        sample['sample_id'] = f"{language}:{sample['sample_group']}:{r['word']}:{r['reading']}"
        sample['candidates'] = [dictionaries[language][0][i] for i in ids]
    dump(OUT / 'summary.json', summary)
    dump(OUT / 'textbook-details.json', rows)
    dump(OUT / 'quality-samples.json', samples)
    csv_rows(OUT / 'textbook-details.csv', rows)
    csv_rows(OUT / 'pdf-details.csv', pdf_results)
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)


if __name__ == '__main__':
    main()
