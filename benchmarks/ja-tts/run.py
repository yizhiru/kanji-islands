"""Time Japanese TTS from input text to a complete in-memory PCM WAV."""

import csv
import io
import json
import os
import random
import wave
from pathlib import Path
from time import perf_counter

import numpy as np


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
CACHE = ROOT / "tmp/speech-bench"
ASSETS = CACHE / "tts"
OUT = CACHE / "tts-run"
DICTIONARY = ASSETS / "open_jtalk_dic_utf_8-1.11"
os.environ["OPEN_JTALK_DICT_DIR"] = str(DICTIONARY)
VOICE_NAMES = ("voicevox", "kokoro", "openjtalk")
SPEED = 0.9


def prompts():
    ranks = {1, 5, 10, 14, 21, 25, 30, 33, 36, 37, 48, 58, 61, 63, 86, 112}
    rows = []
    with (ROOT / "src/assets/shikken-jlpt-n2-en.csv").open(encoding="utf-8") as stream:
        for row in csv.DictReader(line for line in stream if not line.startswith("#")):
            rank = int(row["rank"])
            if rank in ranks:
                rows.append(dict(id=f"w{rank:03d}", group="word", display=row["word"],
                                 text=row["reading"], spoken_kana=row["reading"]))
    assert len(rows) == len(ranks)
    with (HERE / "sentences.tsv").open(encoding="utf-8") as stream:
        rows.extend(dict(row, group="sentence", display=row["text"])
                    for row in csv.DictReader(stream, delimiter="\t"))
    return rows


def pcm_wav(audio, rate):
    if not np.isfinite(audio).all():
        raise ValueError("Non-finite waveform")
    pcm = np.clip(np.rint(audio * 32768), -32768, 32767).astype("<i2")
    stream = io.BytesIO()
    with wave.open(stream, "wb") as writer:
        writer.setparams((1, 2, rate, 0, "NONE", "not compressed"))
        writer.writeframes(pcm.tobytes())
    return stream.getvalue()


def load_voicevox():
    from voicevox_core.blocking import Onnxruntime, OpenJtalk, Synthesizer, VoiceModelFile

    lib = ASSETS / "voicevox_onnxruntime-osx-arm64-1.17.3/lib" / Onnxruntime.LIB_VERSIONED_FILENAME
    synthesizer = Synthesizer(Onnxruntime.load_once(filename=str(lib)), OpenJtalk(str(DICTIONARY)),
                              acceleration_mode="CPU", cpu_num_threads=4)
    with VoiceModelFile.open(ASSETS / "0.vvm") as model:
        synthesizer.load_voice_model(model)
    assert any(c.name == "四国めたん" and any(s.id == 2 and s.name == "ノーマル" for s in c.styles)
               for c in synthesizer.metas())

    def synthesize(text):
        query = synthesizer.create_audio_query(text, 2)
        query.speed_scale = SPEED
        return synthesizer.synthesis(query, 2)
    return synthesize


def load_kokoro():
    import onnxruntime as ort
    from misaki.ja import JAG2P

    g2p = JAG2P()
    vocab = json.loads((ASSETS / "tokenizer.json").read_text())["model"]["vocab"]
    styles = np.fromfile(ASSETS / "jf_alpha.bin", dtype="<f4").reshape(-1, 1, 256)
    options = ort.SessionOptions()
    options.intra_op_num_threads = 4
    options.inter_op_num_threads = 1
    options.add_session_config_entry("session.intra_op.allow_spinning", "0")
    session = ort.InferenceSession(ASSETS / "kokoro.onnx", sess_options=options,
                                   providers=["CPUExecutionProvider"])

    def synthesize(text):
        phonemes, _ = g2p(text)
        tokens = [vocab[c] for c in phonemes.strip()]
        if not 0 < len(tokens) <= 510:
            raise ValueError("Kokoro prompt outside context window")
        feeds = dict(input_ids=np.array([[0, *tokens, 0]], dtype=np.int64),
                     style=styles[len(tokens)], speed=np.array([SPEED], dtype=np.float32))
        audio = session.run(None, feeds)[0].reshape(-1)
        return pcm_wav(audio, 24000)
    return synthesize


def load_openjtalk():
    import pyopenjtalk

    def synthesize(text):
        audio, rate = pyopenjtalk.tts(text, speed=SPEED, use_vanilla=True)
        return pcm_wav(audio / 32768, rate)
    return synthesize


def main():
    rows = prompts()
    OUT.mkdir(parents=True, exist_ok=True)
    engines = {}
    setup = {}
    for name, load in zip(VOICE_NAMES, (load_voicevox, load_kokoro, load_openjtalk)):
        start = perf_counter()
        engines[name] = load()
        loaded = perf_counter()
        engines[name]("日本語の音声テストです。")
        setup[name] = dict(load_s=loaded-start, first_request_s=perf_counter()-loaded)
    for row in rows:
        row["results"] = {name: [] for name in engines}
    for repeat in range(3):
        indexes = list(range(len(rows)))
        random.Random(42 + repeat).shuffle(indexes)
        for name in VOICE_NAMES[repeat:] + VOICE_NAMES[:repeat]:
            folder = OUT / name
            folder.mkdir(exist_ok=True)
            for i in indexes:
                row = rows[i]
                start = perf_counter()
                wav = engines[name](row["text"])
                seconds = perf_counter() - start
                with wave.open(io.BytesIO(wav)) as reader:
                    assert reader.getnchannels() == 1 and reader.getsampwidth() == 2
                    duration = reader.getnframes() / reader.getframerate()
                    signal = np.frombuffer(reader.readframes(reader.getnframes()), dtype="<i2")
                    assert duration > 0 and np.max(np.abs(signal.astype(float))) > 100
                row["results"][name].append(dict(seconds=seconds, audio_s=duration))
                if repeat == 0:
                    (folder / f"{row['id']}.wav").write_bytes(wav)
            print(f"Pass {repeat+1}: {name}, {len(rows)} prompts", flush=True)
    (OUT / "timing.json").write_text(json.dumps(dict(setup=setup, prompts=rows),
                                                ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
