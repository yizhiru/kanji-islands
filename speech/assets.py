"""Install only the selected voice's pinned data files in the user's cache."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import ssl
import tarfile
import tempfile
from time import monotonic, time
from urllib.request import urlopen

import certifi

KOKORO = "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231"
MEI = "https://raw.githubusercontent.com/r9y9/pyopenjtalk/0f0fc44e782a8134cd9a51d80b57b48a7c95bb80/pyopenjtalk/htsvoice"
# Local name, immutable URL, compressed/download size, SHA-256.
FILES = {
    "kokoro": [
        ("kokoro.onnx", f"{KOKORO}/onnx/model.onnx", 325532232, "8fbea51ea711f2af382e88c833d9e288c6dc82ce5e98421ea61c058ce21a34cb"),
        ("jf_alpha.bin", f"{KOKORO}/voices/jf_alpha.bin", 522240, "56b479360aad9f367aeb8cef908f9201cf48b4555e488c5f4590c9dfcd978bb6"),
        ("tokenizer.json", f"{KOKORO}/tokenizer.json", 3497, "77a02c8e164413299b4b4c403b14f8e0e1c1b727db4d46a09d6327b861060a34"),
        ("dictionary.tar.gz", "https://files.pythonhosted.org/packages/55/2b/8cf7514cb57d028abcef625afa847d60ff1ffbf0049c36b78faa7c35046f/unidic-lite-1.0.8.tar.gz", 47356746, "db9d4572d9fdd4d00a97949d4b0741ec480ee05a7e7e2e32f547500dae27b245"),
    ],
    "openjtalk": [
        ("mei.htsvoice", f"{MEI}/mei_normal.htsvoice", 862503, "f3be49a6838904a6c218790b64e07c3e83c1886e995dca284b413caab19184de"),
        ("dictionary.tar.gz", "https://github.com/r9y9/open_jtalk/releases/download/v1.11.1/open_jtalk_dic_utf_8-1.11.tar.gz", 23646843, "fe6ba0e43542cef98339abdffd903e062008ea170b04e7e2a35da805902f382a"),
    ],
}
PREFIX = {"kokoro": "unidic-lite-1.0.8/unidic_lite/dicdir", "openjtalk": "open_jtalk_dic_utf_8-1.11"}


def digest(path):
    with path.open("rb") as file:
        return hashlib.file_digest(file, "sha256").hexdigest()


def install(engine, progress):
    files = FILES[engine]
    total = sum(size for _, _, size, _ in files)
    done = 0
    directory = Path("dictionary")
    receipt = Path("ready.json")
    directory.mkdir(exist_ok=True)
    # Recover uncommitted files left by a power loss or a killed worker.
    for leftover in Path(".").glob("prepare-*"):
        if leftover.is_dir() and time() - leftover.stat().st_mtime > 86400:
            shutil.rmtree(leftover, ignore_errors=True)
    with tempfile.TemporaryDirectory(prefix=f"prepare-{os.getpid()}-", dir=".") as staging:
        stage = Path(staging)
        for name, url, size, checksum in files:
            dest = Path(name)
            if not (dest.is_file() and dest.stat().st_size == size and digest(dest) == checksum):
                progress(done, total)
                part = stage / name
                context = ssl.create_default_context()
                context.load_verify_locations(certifi.where())
                with urlopen(url, timeout=45, context=context) as source, part.open("wb") as out:
                    received, last = 0, 0
                    while block := source.read(256 * 1024):
                        received += len(block)
                        if received > size:
                            raise ValueError("Unexpected download size")
                        out.write(block)
                        if monotonic() - last >= 0.3:
                            progress(done + received, total)
                            last = monotonic()
                if received != size or digest(part) != checksum:
                    raise ValueError("Downloaded file failed its integrity check")
                os.replace(part, dest)
            done += size

        # Only extract immediate dictionary data files from the verified archive.
        # The UniDic source distribution also contains Python files outside dicdir.
        try:
            inventory = json.loads(receipt.read_text())
            required = {"sys.dic", "unk.dic", "matrix.bin", "char.bin"}
            if required <= inventory.keys() and all(
                Path(n).name == n and digest(directory / n) == checksum
                for n, checksum in inventory.items()
            ):
                return
        except (FileNotFoundError, ValueError, AttributeError, TypeError):
            pass
        progress(total, total)
        inventory = {}
        with tarfile.open("dictionary.tar.gz", "r|gz") as archive:
            for member in archive:
                path = PurePosixPath(member.name)
                if not member.isfile() or str(path.parent) != PREFIX[engine]:
                    continue
                part = stage / path.name
                with part.open("wb") as out:
                    shutil.copyfileobj(archive.extractfile(member), out)
                os.replace(part, directory / path.name)
                inventory[path.name] = digest(directory / path.name)
        if not {"sys.dic", "unk.dic", "matrix.bin", "char.bin"} <= inventory.keys():
            raise ValueError("Dictionary is incomplete")
        temp = stage / "ready.json"
        temp.write_text(json.dumps(inventory))
        os.replace(temp, receipt)
