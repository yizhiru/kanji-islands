"""Fetch the pinned macOS arm64 benchmark assets. Requires Python 3.12 and curl."""

import hashlib
import json
import subprocess
import tarfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path


HERE = Path(__file__).resolve().parent
CACHE = HERE.parents[1] / "tmp/speech-bench"
GH = "https://github.com"
HF = "https://huggingface.co"
KOKORO = f"{HF}/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231"
REAZON = f"{HF}/reazon-research/reazonspeech-k2-v2/resolve/291488c8151be24d7da4bf7af26e533fad96e407"
WHISPER = f"{HF}/Systran/faster-whisper-small/resolve/536b0662742c02347bc0e980a01041f333bce120"
WHEEL = "voicevox_core-0.16.3-cp310-abi3-macosx_11_0_arm64.whl"


def download_urls():
    files = {
        f"tts/{WHEEL}": f"{GH}/VOICEVOX/voicevox_core/releases/download/0.16.3/{WHEEL}",
        "tts/voicevox-runtime.tgz": f"{GH}/VOICEVOX/onnxruntime-builder/releases/download/voicevox_onnxruntime-1.17.3/voicevox_onnxruntime-osx-arm64-1.17.3.tgz",
        "tts/0.vvm": "https://raw.githubusercontent.com/VOICEVOX/voicevox_vvm/58959f04aa09b9681667fb146788050c6d618dec/vvms/0.vvm",
        "tts/open_jtalk_dic.tar.gz": f"{GH}/r9y9/open_jtalk/releases/download/v1.11.1/open_jtalk_dic_utf_8-1.11.tar.gz",
        "tts/kokoro.onnx": f"{KOKORO}/onnx/model.onnx",
        "tts/jf_alpha.bin": f"{KOKORO}/voices/jf_alpha.bin",
        "tts/tokenizer.json": f"{KOKORO}/tokenizer.json",
        "tts/utmos22_strong.onnx": f"{HF}/TigreGotico/utmos-onnx/resolve/ff41b8f440cb12ecda18261f9ff7326d058275ce/utmos22_strong.onnx",
    }
    for part in ("encoder", "decoder", "joiner"):
        filename = f"{part}-epoch-99-avg-1.int8.onnx"
        files[f"reazon/{filename}"] = f"{REAZON}/{filename}"
    files["reazon/tokens.txt"] = f"{REAZON}/tokens.txt"
    for filename in ("config.json", "model.bin", "tokenizer.json", "vocabulary.txt"):
        files[f"small/{filename}"] = f"{WHISPER}/{filename}"
    return files


def sha256(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def fetch(name, url, checksum):
    target = CACHE / name
    if target.is_file() and sha256(target) == checksum:
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.with_suffix(target.suffix + ".part")
    subprocess.run(["curl", "-fsSL", "--retry", "3", "--max-time", "900",
                    url, "-o", str(temp)], check=True)
    if sha256(temp) != checksum:
        raise ValueError(f"SHA-256 mismatch: {name}")
    temp.replace(target)


if __name__ == "__main__":
    urls = download_urls()
    checks = json.loads((HERE / "sha256.json").read_text())
    assert urls.keys() == checks.keys()
    with ThreadPoolExecutor(4) as pool:
        jobs = [pool.submit(fetch, name, url, checks[name]) for name, url in urls.items()]
        for job in jobs:
            job.result()
    for name in ("voicevox-runtime.tgz", "open_jtalk_dic.tar.gz"):
        with tarfile.open(CACHE / "tts" / name) as archive:
            archive.extractall(CACHE / "tts", filter="data")
    print("Verified models, runtimes, and dictionaries")
