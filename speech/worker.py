"""One offline Japanese synthesizer per process. JSON lines over private stdio."""
from contextlib import redirect_stdout
import base64
import io
import json
import os
from pathlib import Path
import re
import sys
import traceback
import wave

from assets import FILES, install


def emit(**message):
    print(json.dumps(message), flush=True)


def load_openjtalk():
    # This dedicated HTS process uses the vanilla frontend. Disable the optional
    # ONNX reading predictor which pyopenjtalk-plus otherwise loads at import.
    sys.modules["onnxruntime"] = None
    with redirect_stdout(sys.stderr):
        from pyopenjtalk import OpenJTalk, HTSEngine, run_frontend
    front = OpenJTalk(dn_mecab=b"dictionary")
    voice = HTSEngine(b"mei.htsvoice")

    def generate(text):
        labels = front.make_label(run_frontend(text, jtalk=front, use_vanilla=True))
        voice.set_speed(0.9)
        return voice.synthesize(labels) / 32768, voice.get_sampling_frequency()
    return generate


def load_kokoro():
    import numpy as np
    import onnxruntime as ort
    from fugashi import Tagger
    from misaki.cutlet import Cutlet, HEPBURN

    # Cutlet's default constructor selects a system dictionary. Supply the exact
    # same UniDic Lite dictionary as the benchmark, using the downloaded path.
    class LocalCutlet(Cutlet):
        def __init__(self):
            self.tagger = Tagger("-r dictionary/mecabrc -d dictionary")
            self.table = dict(HEPBURN)
            self.exceptions = {}

    frontend = LocalCutlet()
    vocab = json.loads(Path("tokenizer.json").read_text(encoding="utf-8"))["model"]["vocab"]
    styles = np.fromfile("jf_alpha.bin", dtype="<f4").reshape(-1, 1, 256)
    ort.disable_telemetry_events()
    options = ort.SessionOptions()
    options.intra_op_num_threads = 4
    options.inter_op_num_threads = 1
    options.add_session_config_entry("session.intra_op.allow_spinning", "0")
    session = ort.InferenceSession("kokoro.onnx", sess_options=options, providers=["CPUExecutionProvider"])

    def generate(text):
        pieces = []
        for sentence in re.split(r"(?<=[。！？!?])", text):
            if not sentence.strip():
                continue
            phonemes, _ = frontend(sentence)
            tokens = [vocab[c] for c in phonemes.strip() if c in vocab]
            # Reserve two padding tokens in the model's 512-token context.
            for offset in range(0, len(tokens), 510):
                part = tokens[offset:offset + 510]
                feeds = dict(input_ids=np.array([[0, *part, 0]], dtype=np.int64),
                             style=styles[len(part)], speed=np.array([0.9], dtype=np.float32))
                pieces.append(session.run(None, feeds)[0].reshape(-1))
        if not pieces:
            raise ValueError("No pronounceable text")
        return np.concatenate(pieces), 24000
    return generate


def wav_bytes(samples, rate):
    import numpy as np
    if not samples.size or samples.size > 8_000_000 or not np.isfinite(samples).all():
        raise ValueError("Invalid waveform")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav:
        wav.setparams((1, 2, rate, 0, "NONE", "not compressed"))
        wav.writeframes(np.clip(np.rint(samples * 32768), -32768, 32767).astype("<i2").tobytes())
    return buf.getvalue()


def main():
    sys.stdin.reconfigure(encoding="utf-8")
    engine, cache = sys.argv[1:]
    if engine not in FILES:
        raise ValueError("Unknown engine")
    Path(cache).mkdir(parents=True, exist_ok=True)
    os.chdir(cache)
    generate = None
    for line in sys.stdin:
        try:
            text = json.loads(line)
            if not isinstance(text, str) or not 0 < len(text.strip()) <= 500:
                raise ValueError("Invalid speech text")
            if generate is None:
                install(engine, lambda done, total: emit(state="downloading", done=done, total=total))
                generate = load_openjtalk() if engine == "openjtalk" else load_kokoro()
                emit(state="ready")
            emit(wav=base64.b64encode(wav_bytes(*generate(text))).decode("ascii"))
        except Exception:
            traceback.print_exc(file=sys.stderr)
            emit(error="朗读失败，请重试。" if generate else "语音资源准备失败，请检查网络和磁盘空间后重试。")


if __name__ == "__main__":
    main()
