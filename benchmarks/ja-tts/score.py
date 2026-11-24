"""Score the saved first-pass WAVs with two independent Japanese recognizers."""

import argparse
import json
import math
import platform
import statistics
from importlib.metadata import version
from pathlib import Path

import numpy as np
import onnxruntime as ort
from run import ASSETS, CACHE, OUT, VOICE_NAMES, pcm_wav

import pyopenjtalk
import sherpa_onnx
from faster_whisper import WhisperModel
from faster_whisper.audio import decode_audio


def phones(text):
    if not text.strip():
        return []
    tokens = pyopenjtalk.g2p(text, use_vanilla=True).split()
    # Pitch accent, pauses and devoicing are outside the intelligibility metric.
    return [p.lower() if p in ("A", "E", "I", "O", "U") else p
            for p in tokens if p not in ("pau", "sil")]


def edit_distance(reference, prediction):
    prev = list(range(len(prediction) + 1))
    for i, a in enumerate(reference, 1):
        row = [i]
        for j, b in enumerate(prediction, 1):
            row.append(min(row[-1] + 1, prev[j] + 1, prev[j-1] + (a != b)))
        prev = row
    return prev[-1]


def make_judges():
    networks = {part: str(CACHE / "reazon" / f"{part}-epoch-99-avg-1.int8.onnx")
                for part in ("encoder", "decoder", "joiner")}
    reazon = sherpa_onnx.OfflineRecognizer.from_transducer(
        **networks, tokens=str(CACHE / "reazon/tokens.txt"), num_threads=4)
    whisper = WhisperModel(str(CACHE / "small"), device="cpu", compute_type="int8",
                           cpu_threads=4, num_workers=1, local_files_only=True)

    def recognize_reazon(audio):
        stream = reazon.create_stream()
        stream.accept_waveform(16000, audio)
        reazon.decode_stream(stream)
        return stream.result.text.strip()

    def recognize_whisper(audio):
        segments, _ = whisper.transcribe(audio, language="ja", temperature=0, beam_size=1,
                                         best_of=1, condition_on_previous_text=False,
                                         without_timestamps=True, max_new_tokens=96)
        return "".join(s.text for s in segments).strip()

    return dict(reazon=recognize_reazon, whisper_small=recognize_whisper)


def summarize(rows, judge_names):
    summary = {}
    for name in VOICE_NAMES:
        by_group = {}
        for group in ("word", "sentence"):
            subset = [r for r in rows if r["group"] == group]
            runs = [run for row in subset for run in row["results"][name]]
            times = [r["seconds"] for r in runs]
            audio_s = sum(r["audio_s"] for r in runs)
            metrics = dict(items=len(subset), calls=len(runs), median_s=statistics.median(times),
                           p95_s=sorted(times)[math.ceil(.95*len(times))-1],
                           total_s=sum(times), audio_s=audio_s, rtf=sum(times)/audio_s)
            if group == "sentence":
                metrics["predicted_mos"] = statistics.mean(r["utmos"][name] for r in subset)
            denominator = sum(len(r["reference_phones"]) for r in subset)
            for judge in judge_names:
                errors = [r["checks"][name][judge]["edits"] for r in subset]
                metrics[judge] = dict(exact=errors.count(0), edits=sum(errors),
                                      reference_phones=denominator, per=sum(errors)/denominator)
            by_group[group] = metrics
        summary[name] = by_group
    return summary


def listening_samples(target):
    target.mkdir(parents=True, exist_ok=True)
    for name in VOICE_NAMES:
        pieces = []
        for key in ("w063", "s05", "s10"):
            wav = decode_audio(str(OUT / name / f"{key}.wav"), sampling_rate=24000)
            if pieces:
                pieces.append(np.zeros(12000, dtype=np.float32))
            pieces.append(wav)
        (target / f"{name}.wav").write_bytes(pcm_wav(np.concatenate(pieces), 24000))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=OUT / "result.json")
    parser.add_argument("--samples", type=Path, default=OUT / "samples")
    args = parser.parse_args()
    result = json.loads((OUT / "timing.json").read_text())
    judges = make_judges()
    options = ort.SessionOptions()
    options.intra_op_num_threads = 4
    options.inter_op_num_threads = 1
    mos = ort.InferenceSession(ASSETS / "utmos22_strong.onnx", sess_options=options,
                               providers=["CPUExecutionProvider"])
    for row in result["prompts"]:
        reference = phones(row["spoken_kana"])
        assert reference
        row["reference_phones"] = reference
        row["checks"] = {}
        for name in VOICE_NAMES:
            path = OUT / name / f"{row['id']}.wav"
            samples = decode_audio(str(path))
            if row["group"] == "sentence":
                value = mos.run(None, {"wave": samples[None, :]})[0].item()
                assert math.isfinite(value)
                row.setdefault("utmos", {})[name] = value
            checks = {}
            for judge, recognize in judges.items():
                transcript = recognize(samples)
                prediction = phones(transcript)
                checks[judge] = dict(text=transcript, phones=prediction,
                                     edits=edit_distance(reference, prediction))
            row["checks"][name] = checks
    result["summary"] = summarize(result["prompts"], judges)
    packages = ("voicevox-core", "misaki", "unidic-lite", "onnxruntime", "pyopenjtalk-plus",
                "sherpa-onnx", "faster-whisper", "ctranslate2", "av", "numpy")
    result.update(platform=platform.platform(), python=platform.python_version(),
                  versions={name: version(name) for name in packages})
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    listening_samples(args.samples)
    print(json.dumps(result["summary"], indent=2))


if __name__ == "__main__":
    main()
