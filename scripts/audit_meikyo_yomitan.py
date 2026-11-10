#!/usr/bin/env python3
"""Inspect a user-supplied Yomitan dictionary ZIP without installing or executing it.

Definitions remain separate from application JMdict senses. Reading references
are existing application data, not independently verified textbook readings.
"""
import csv
import hashlib
import json
import random
import re
import zipfile
from collections import Counter, defaultdict
from pathlib import Path
from check_zhwiktionary_coverage import canonical_surface, extract_pdfs, hira, norm, sha256

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = ROOT / 'data/meikyo-yomitan/dictionary-1.4.4.zip'
OUT = ROOT / 'output/meikyo-yomitan-audit'
KANA = re.compile(r'[ぁ-ゖァ-ヺー]+')
SKIP = {'num', 'type', 'canzhao', 'num_circle'}
TARGETS = [('新しい', 'あたらしい'), ('安心する', 'あんしんする'), ('研究する', 'けんきゅうする'),
           ('転職する', 'てんしょくする'), ('開く', 'あく'), ('開く', 'ひらく'), ('開ける', 'あける'),
           ('上手', 'じょうず'), ('生', 'なま'), ('人気', 'にんき'), ('大丈夫', 'だいじょうぶ'),
           ('かける', 'かける'), ('すみません', 'すみません'), ('いただく', 'いただく'),
           ('パソコン', 'ぱそこん'), ('つける', 'つける'), ('発表', 'はっぴょう'), ('意識', 'いしき'),
           ('帽子', 'ぼうし'), ('市場', 'しじょう'), ('ハリケーン', 'はりけーん'), ('警察署', 'けいさつしょ')]


def dump(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def walk(x):
    if isinstance(x, list):
        for child in x:
            yield from walk(child)
    elif isinstance(x, dict):
        yield x
        yield from walk(x.get('content'))


def cls(node):
    return node.get('data', {}).get('class', '')


def text(x):
    if isinstance(x, str):
        return x
    if isinstance(x, list):
        return ''.join(text(v) for v in x)
    if isinstance(x, dict):
        return text(x.get('content'))
    return ''


def split_text(x, language='ja', skip=False):
    result = {'ja': '', 'zh': ''}
    if isinstance(x, str):
        if not skip:
            result['zh' if language.startswith('zh') else 'ja'] += x
    elif isinstance(x, list):
        for child in x:
            sub = split_text(child, language, skip)
            for key in result:
                result[key] += sub[key]
    elif isinstance(x, dict):
        result = split_text(x.get('content'), x.get('lang', language), skip or cls(x) in SKIP)
    return {k: v.strip().removeprefix('/').strip() for k, v in result.items()}


def parse_document(row):
    payload = row[5]
    nodes = list(walk(payload))
    definitions, examples = [], []
    context = ''
    for node in nodes:
        if cls(node) == 'def0':
            context = text(node)
        if cls(node) in {'def2', 'def2_first'}:
            pair = split_text(node)
            if pair['ja'] or pair['zh']:
                definitions.append(pair | {'context': context})
        elif cls(node) == 'exam':
            examples.append(split_text(node))
    all_text = text(payload)
    return {
        'sequence': row[6], 'heading': ' / '.join(text(n) for n in nodes if cls(n) == 'head'),
        'types': sorted({text(n) for n in nodes if cls(n) == 'type'}),
        'definitions': definitions, 'examples': examples,
        'has_ja': any(re.search(r'[ぁ-ゖァ-ヺ一-鿿]', d['ja']) for d in definitions),
        'has_zh': any(re.search(r'[一-鿿]', d['zh']) for d in definitions),
        'unpaired_definitions': sum(bool(d['ja']) != bool(d['zh']) for d in definitions),
        'kana_in_chinese_definitions': any(re.search(r'[ぁ-ゖァ-ヺ]', d['zh']) for d in definitions),
        'supplement_marker': 'ⓚ' in all_text,
        'replacement_character': '\ufffd' in all_text,
        'relations': [text(n) for n in nodes if cls(n) in {'dong', 'yixing', 'yufa', 'keneng', 'paisheng'}],
        'cross_reference_text': re.findall(r'⇨([^⇨⇔。\n]+)', all_text),
        'note_labels': sorted({cls(n) for n in nodes if cls(n) in {'biaoji', 'biaoxian', 'yufa', 'zhuyi'}}),
        'raw_excerpt': all_text[:18000],
    }


def load():
    documents, by_word = {}, defaultdict(list)
    statistics = Counter()
    classes, tags, languages = Counter(), Counter(), Counter()
    hashes, duplicate_payload_conflicts = {}, []
    with zipfile.ZipFile(ARCHIVE) as archive:
        assert archive.testzip() is None
        index = json.loads(archive.read('index.json'))
        assert index['format'] == 3
        banks = sorted((n for n in archive.namelist() if re.fullmatch(r'term_bank_\d+\.json', n)),
                       key=lambda n: int(re.search(r'\d+', n)[0]))
        for bank in banks:
            for offset, row in enumerate(json.loads(archive.read(bank))):
                assert isinstance(row, list) and len(row) == 8
                assert isinstance(row[0], str) and isinstance(row[1], str) and isinstance(row[6], int)
                statistics['index_rows'] += 1
                reading = hira(row[1]) if row[1] else hira(row[0]) if KANA.fullmatch(norm(row[0])) else ''
                statistics['explicit_reading_rows'] += bool(row[1])
                statistics['kana_headword_reading_rows'] += not row[1] and bool(reading)
                statistics['unknown_reading_rows'] += not bool(reading)
                digest = hashlib.sha256(json.dumps(row[5], ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
                sequence = row[6]
                if sequence in hashes and hashes[sequence] != digest:
                    duplicate_payload_conflicts.append({'sequence': sequence, 'bank': bank, 'offset': offset})
                if sequence not in documents:
                    hashes[sequence] = digest
                    documents[sequence] = parse_document(row)
                    for node in walk(row[5]):
                        classes[cls(node)] += 1
                        tags[node.get('tag', node.get('type', ''))] += 1
                        languages[node.get('lang', '')] += 1
                        statistics['external_references'] += any(k in node for k in ['href', 'src', 'path'])
                by_word[norm(row[0])].append({'sequence': sequence, 'reading': reading,
                    'explicit_reading': bool(row[1]), 'rules': row[3], 'bank': bank, 'offset': offset})
        statistics['zip_members'] = len(archive.namelist())
        statistics['uncompressed_bytes'] = sum(i.file_size for i in archive.infolist())
        statistics['term_banks'] = len(banks)
        files = archive.namelist()
    statistics['unique_sequences'] = len(documents)
    statistics['unique_headwords'] = len(by_word)
    statistics['sequence_payload_conflicts'] = len(duplicate_payload_conflicts)
    assert not duplicate_payload_conflicts, 'A sequence has inconsistent payloads; deduplication is unsafe.'
    for key in ['has_ja', 'has_zh', 'supplement_marker', 'replacement_character', 'kana_in_chinese_definitions']:
        statistics['documents_' + key] = sum(d[key] for d in documents.values())
    statistics['definition_pairs'] = sum(len(d['definitions']) for d in documents.values())
    statistics['unpaired_definition_nodes'] = sum(d['unpaired_definitions'] for d in documents.values())
    return documents, by_word, {'index': index, 'statistics': dict(statistics), 'classes': dict(classes),
        'tags': dict(tags), 'language_tags': dict(languages), 'members': files}


def match(word, readings, documents, index):
    rows = index.get(norm(word), [])
    expected = {hira(r) for r in readings if r}
    ids = sorted({r['sequence'] for r in rows})
    known = {r['reading'] for r in rows if r['reading']}
    matched = sorted({r['sequence'] for r in rows if r['reading'] in expected})
    status = ('no_surface' if not rows else 'no_reference_reading' if not expected else
              'match' if matched else 'conflict' if known else 'unavailable')
    return {'surface': bool(rows), 'reading_status': status, 'sequences': ids,
            'matching_sequences': matched, 'dictionary_readings': sorted(known),
            'ja_surface': any(documents[i]['has_ja'] for i in ids),
            'zh_surface': any(documents[i]['has_zh'] for i in ids),
            'ja_reading': any(documents[i]['has_ja'] for i in matched),
            'zh_reading': any(documents[i]['has_zh'] for i in matched),
            'bilingual_reading': any(documents[i]['has_ja'] and documents[i]['has_zh'] for i in matched)}


def summarize(rows):
    c = Counter()
    for row in rows:
        m = row['match']
        c['total'] += 1
        for key in ['surface', 'ja_surface', 'zh_surface', 'ja_reading', 'zh_reading', 'bilingual_reading']:
            c[key] += m[key]
        c[m['reading_status']] += 1
        c['multiple_reading_matched_sequences'] += len(m['matching_sequences']) > 1
        c['enhanced_bilingual_candidate'] += bool(m['bilingual_reading'] or row.get('suru', {}).get('bilingual_reading') or row.get('inflection_candidate', {}).get('bilingual_reading'))
        c['suru_bilingual_candidate'] += row.get('suru', {}).get('bilingual_reading', False)
        c['inflection_bilingual_candidate'] += row.get('inflection_candidate', {}).get('bilingual_reading', False)
    for key in ['match', 'conflict', 'unavailable', 'no_surface', 'no_reference_reading']:
        c.setdefault(key, 0)
    result = dict(c)
    for key in ['surface', 'ja_surface', 'zh_surface', 'match', 'ja_reading', 'zh_reading', 'bilingual_reading', 'enhanced_bilingual_candidate']:
        result[key + '_percent'] = round(100 * c[key] / c['total'], 2) if c['total'] else 0
    result['reading_match_percent_of_surface'] = round(100 * c['match'] / c['surface'], 2) if c['surface'] else 0
    return result


def save_csv(path, rows):
    fields = ['id', 'word', 'reading', 'levels', 'surface', 'reading_status', 'dictionary_readings',
              'ja_reading', 'zh_reading', 'bilingual_reading', 'sequences', 'matching_sequences',
              'suru_bilingual_candidate', 'inflection_bilingual_candidate']
    with path.open('w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for row in rows:
            out = {k: row.get(k, '') for k in ['id', 'word', 'reading', 'levels']}
            out.update({k: row['match'][k] for k in fields if k in row['match']})
            for key in ['suru', 'inflection_candidate']:
                out['suru_bilingual_candidate' if key == 'suru' else 'inflection_bilingual_candidate'] = row.get(key, {}).get('bilingual_reading', False)
            for key, value in out.items():
                if isinstance(value, list): out[key] = '|'.join(map(str, value))
            w.writerow(out)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    documents, index, metadata = load()
    print(json.dumps(metadata['statistics'], ensure_ascii=False), flush=True)
    entries = json.loads((ROOT / 'data/vocabulary/vocabulary.json').read_text())['entries']
    rows, by_pdf = [], defaultdict(list)
    for entry in entries:
        row = {'id': entry['id'], 'word': entry['word'], 'reading': entry['reading_hiragana'],
            'levels': sorted({s['level'] for s in entry['sources']}), 'references': entry['references'],
            'current_zh': entry['meanings_zh'], 'current_pos': sorted({p for s in entry['senses'] for p in s['pos']})}
        row['match'] = match(row['word'], [row['reading']], documents, index)
        if not row['match']['bilingual_reading'] and row['word'].endswith('する') and row['reading'].endswith('する'):
            candidate = match(row['word'][:-2], [row['reading'][:-2]], documents, index)
            # Require dictionary metadata to explicitly identify a suru conjugation.
            valid = [i for i in candidate['matching_sequences'] if any('サ変' in t for t in documents[i]['types'])]
            if valid:
                row['suru'] = match(row['word'][:-2], [row['reading'][:-2]], documents, index)
                row['suru']['matching_sequences'] = valid
                row['suru']['bilingual_reading'] = any(documents[i]['has_ja'] and documents[i]['has_zh'] for i in valid)
        if not row['match']['bilingual_reading'] and entry.get('inflection'):
            lemma = entry['inflection']
            row['inflection_candidate'] = match(lemma['lemma'], [lemma['lemma_reading_hiragana']], documents, index)
        rows.append(row)
        for source in entry['sources']:
            by_pdf[source['row_id']].append(row['reading'])
    pdfs, page_audits = extract_pdfs()
    pdf_rows = []
    for entry in pdfs:
        expected = sorted(set(by_pdf.get(entry['id'], [])))
        parts = re.split(r'[/／]', canonical_surface(entry['surface']))
        ms = [match(part, expected, documents, index) for part in parts]
        merged = dict(ms[0])
        for key in ['surface', 'ja_surface', 'zh_surface', 'ja_reading', 'zh_reading', 'bilingual_reading']:
            merged[key] = all(m[key] for m in ms)
        for key in ['sequences', 'matching_sequences', 'dictionary_readings']:
            merged[key] = sorted({v for m in ms for v in m[key]})
        if not all(m['surface'] for m in ms): merged['reading_status'] = 'no_surface'
        elif not expected: merged['reading_status'] = 'no_reference_reading'
        elif all(m['reading_status'] == 'match' for m in ms): merged['reading_status'] = 'match'
        elif any(m['reading_status'] == 'conflict' for m in ms): merged['reading_status'] = 'conflict'
        else: merged['reading_status'] = 'unavailable'
        pdf_rows.append({'id': entry['id'], 'word': entry['surface'], 'reading': '/'.join(expected),
                         'levels': [entry['level']], 'match': merged})
    matched_ids = {i for r in rows for i in r['match']['matching_sequences']}
    quality_flags = {k: sum(documents[i][k] for i in matched_ids) for k in ['supplement_marker', 'kana_in_chinese_definitions', 'replacement_character']}
    quality_flags.update(unique_matching_sequences=len(matched_ids), unpaired_definition_nodes=sum(documents[i]['unpaired_definitions'] for i in matched_ids))
    summary = {'matched_document_flags': quality_flags, 'application_hashes': {str(p.relative_to(ROOT)): sha256(p) for p in [ROOT/'data/vocabulary/vocabulary.json', ROOT/'初级词汇表_完整校对文字版.pdf', ROOT/'中级词汇表_完整校对文字版.pdf']}, 'dictionary': metadata, 'archive': {'sha256': sha256(ARCHIVE), 'bytes': ARCHIVE.stat().st_size,
        'source_post': 'https://forum.freemdict.com/t/topic/38630',
        'source_url': 'https://forum.freemdict.com/uploads/short-url/qxfbMB2LwahQJPa2ojKaruyutfF.zip',
        'download_url': 'https://forumcdn.freemdict.com/uploads/short-url/qxfbMB2LwahQJPa2ojKaruyutfF.zip',
        'downloaded_on': '2026-11-10', 'crc_verified': True},
        'methodology': {'reading_reference': 'Existing application JMdict reading, not independently verified textbook pronunciations.',
          'empty_reading': 'Infer only from all-kana expression; never infer a kanji word reading.',
          'bilingual': 'At least one extracted definition in each language in the same reading-matched sequence; not an assertion that every sense is translated.',
          'suru': 'Separate additional candidate only: remove final する from spelling+reading, require matching lemma and explicit サ変 metadata.',
          'sense_alignment': 'Neither JMdict sense alignment nor textbook-context verification is implied by coverage.'},
        'textbook_entries': {level: summarize([r for r in rows if level == '合并' or level in r['levels']]) for level in ['初级','中级','合并']},
        'pdf_rows': {level: summarize([r for r in pdf_rows if level == '合并' or level in r['levels']]) for level in ['初级','中级','合并']},
        'pdf_page_audits': page_audits}
    samples = []
    rng = random.Random(20261110)
    for level in ['初级', '中级']:
        pool = sorted([r for r in rows if level in r['levels'] and r['match']['bilingual_reading']], key=lambda r: r['id'])
        for row in rng.sample(pool, 16):
            samples.append({'group': level, 'entry': row})
    for word, reading in TARGETS:
        row = next((r for r in rows if r['word'] == word and r['reading'] == reading), None)
        if row is None:
            row = {'word': word, 'reading': reading, 'levels': [], 'match': match(word, [reading], documents, index)}
        # Show the explicit nominal suru lemma as a targeted diagnostic even outside the resolved textbook entries.
        if word.endswith('する') and not row['match']['bilingual_reading'] and 'suru' not in row:
            row = {**row, 'suru': match(word[:-2], [reading[:-2]], documents, index)}
        samples.append({'group': 'targeted', 'entry': row})
    for sample in samples:
        row = sample['entry']
        seqs = row['match']['matching_sequences'] or row.get('suru', {}).get('matching_sequences') or row['match']['sequences']
        sample['documents'] = [documents[i] for i in seqs]
        sample['sample_id'] = f"{sample['group']}:{row['word']}:{row['reading']}"
    # Reuse all 82 prior Wiktionary samples for direct comparisons, preserving their original strata.
    prior = ROOT / 'output/wiktionary-replacement/quality-samples.json'
    comparison = []
    if prior.exists():
        for old in json.loads(prior.read_text()):
            e = old['entry']; m = match(e['word'], [e['reading']], documents, index)
            ids = m['matching_sequences']
            comparison.append({'sample_id': old['sample_id'], 'word': e['word'], 'reading': e['reading'],
                'wiktionary_language': old['language'], 'wiktionary_status': e[old['language']]['reading_status'],
                'meikyo_match': m, 'documents': [documents[i] for i in ids]})
    matched_ids = {i for r in rows for i in r['match']['matching_sequences']}
    matched_ids.update(i for r in rows for i in r.get('suru', {}).get('matching_sequences', []))
    dump(OUT/'summary.json', summary)
    dump(OUT/'textbook-details.json', rows)
    dump(OUT/'quality-samples.json', samples)
    dump(OUT/'wiktionary-comparison-samples.json', comparison)
    dump(OUT/'matched-documents.json', {str(i): documents[i] for i in sorted(matched_ids)})
    save_csv(OUT/'textbook-details.csv', rows)
    save_csv(OUT/'pdf-details.csv', pdf_rows)
    dump(ROOT/'data/meikyo-yomitan/metadata.json', summary['archive'] | {'index': metadata['index']})
    print(json.dumps({k: summary[k] for k in ['textbook_entries','pdf_rows']}, ensure_ascii=False, indent=2), flush=True)


if __name__ == '__main__':
    main()
