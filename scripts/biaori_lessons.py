"""Join the four-volume CSV to proofread PDF occurrences without assigning dictionary senses."""
import csv
import re
import sys

from check_zhwiktionary_coverage import ROOT, canonical_surface, extract_pdfs, norm

CSV_PATH = ROOT / "data/biaori/标日四册总词汇表.csv"


def proofread_values(row):
    word = row["surface"]
    refs = [(ref["lesson"], ref["symbol"]) for ref in row["references"]]
    # A misplaced ス at the line break is documented in the curated dictionary.
    if row["level"] == "初级" and row["pdf_page"] == 9:
        if row["raw_line"] == "スケート 19▼,23ス":
            refs = [(19, "▼"), (23, "")]
        elif word == "ケートボード":
            word = "スケートボード"
    return word, refs


def row_key(volume, headword, refs):
    return volume, norm(headword).replace("〜", "~"), tuple(sorted(refs))


def proofread_rows():
    pdf_rows, _ = extract_pdfs()
    for row in pdf_rows:
        word, refs = proofread_values(row)
        cutoff = 24 if row["level"] == "初级" else 16
        volume = row["level"] + ("上" if refs[0][0] <= cutoff else "下")
        yield row["id"], volume, word, refs


def load_lesson_index():
    proof = {}
    for row_id, volume, word, refs in proofread_rows():
        key = row_key(volume, word, refs)
        if key in proof:
            raise ValueError(f"校对稿中有重复的词头与课次组合：{key}")
        proof[key] = row_id

    rows = {}
    with CSV_PATH.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames != ["册别", "词头", "课次"]:
            raise ValueError("标日 CSV 表头应为册别、词头、课次")
        for c in reader:
            volume, word, lessons = c["册别"], c["词头"], c["课次"]
            if not re.fullmatch(r"\d+[※▼]?(?:\s*[,，、]\s*\d+[※▼]?)*", lessons):
                raise ValueError(f"CSV 第 {reader.line_num} 行课次格式错误")
            refs = [(int(n), s) for n, s in re.findall(r"(\d+)([※▼]?)", lessons)]
            row_id = proof.pop(row_key(volume, word, refs), None)
            if row_id is None:
                raise ValueError(f"CSV 第 {reader.line_num} 行与校对稿不符或重复：{c}")
            rows[row_id] = {"words": canonical_surface(word).split("/"), "level": volume[:2],
                            "lessons": [{"lesson": n, "symbol": s} for n, s in refs]}
    if proof:
        raise ValueError(f"标日 CSV 缺少 {len(proof)} 条校对稿记录")
    return rows

if __name__ == "__main__":
    # Reproduce the index from the local PDFs when setting up a fresh data directory.
    sys.stdout.reconfigure(encoding="utf-8-sig", newline="")
    writer = csv.writer(sys.stdout)
    writer.writerow(["册别", "词头", "课次"])
    for _, volume, word, refs in proofread_rows():
        writer.writerow([volume, word, ", ".join(f"{n}{s}" for n, s in refs)])
