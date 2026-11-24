from pathlib import Path
from importlib import metadata
from PyInstaller.utils.hooks import collect_dynamic_libs, collect_delvewheel_libs_directory
import sys
import sysconfig

source = Path(SPECPATH)
# Only runtime code and legal notices belong in the installer.
# Misaki's small G2P exception table is part of the conversion algorithm.
from PyInstaller.utils.hooks import collect_data_files
datas = collect_data_files('misaki', includes=['data/ja_words.txt'])
datas.append((str(source/'NOTICE.txt'), 'licenses'))
for directory in (Path(sysconfig.get_path('stdlib')), Path(sys.base_prefix)):
    license_file = directory / 'LICENSE.txt'
    if license_file.is_file():
        datas.append((str(license_file), 'licenses/python'))
        break
for name in ('pyopenjtalk-plus', 'onnxruntime', 'numpy', 'misaki', 'fugashi', 'mojimoji',
             'jaconv', 'sudachipy', 'certifi', 'pyinstaller'):
    dist = metadata.distribution(name)
    for item in dist.files or ():
        if any(word in item.name.lower() for word in ('license', 'notice', 'copying')):
            datas.append((str(dist.locate_file(item)), 'licenses/' + name))
binaries = collect_dynamic_libs('fugashi')
if sys.platform == 'win32':
    extra_data, extra_libs = collect_delvewheel_libs_directory('fugashi')
    datas += extra_data
    binaries += extra_libs
a = Analysis([str(source/'worker.py')], pathex=[str(source)], binaries=binaries, datas=datas,
             hiddenimports=['pyopenjtalk._known_symbols'], excludes=['unidic', 'unidic_lite',
                 'sudachidict_core', 'torch', 'onnx', 'pip', 'pytest', 'setuptools'])
# The SudachiPy hook otherwise adds every dictionary found on the build machine.
a.datas = [entry for entry in a.datas if not Path(entry[0]).parts[0].startswith('sudachidict_')]
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name='speech-worker', console=True, upx=False)
coll = COLLECT(exe, a.binaries, a.datas, name='speech-worker', upx=False)
