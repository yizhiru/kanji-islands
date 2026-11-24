// electron-builder beforePack hook, also used by local desktop development.
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const build = path.join(root, 'tmp', 'desktop-tts-build');
const output = path.join(root, 'tmp', 'speech-runtime');
const executable = path.join(
  output,
  'speech-worker',
  process.platform === 'win32' ? 'speech-worker.exe' : 'speech-worker',
);
const stamp = path.join(output, '.build-key');
const run = (cmd, args) =>
  execFileSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, PYINSTALLER_CONFIG_DIR: path.join(build, 'pyinstaller-cache') },
  });

function buildSpeech(context) {
  if (
    context &&
    (context.electronPlatformName !== process.platform ||
      require('builder-util').Arch[context.arch] !== process.arch)
  ) {
    throw new Error('Build the speech runtime on the target OS and architecture.');
  }
  const hash = createHash('sha256').update(process.platform + process.arch);
  for (const file of [
    __filename,
    ...fs
      .readdirSync(path.join(root, 'speech'), { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => path.join(root, 'speech', e.name))
      .sort(),
  ])
    hash.update(fs.readFileSync(file));
  const key = hash.digest('hex');
  if (fs.existsSync(executable) && fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === key)
    return;
  const venv = path.join(build, 'venv');
  const python = path.join(
    venv,
    ...(process.platform === 'win32' ? ['Scripts', 'python.exe'] : ['bin', 'python']),
  );
  if (!fs.existsSync(python)) {
    run(
      process.env.KANJI_BUILD_PYTHON || (process.platform === 'win32' ? 'python' : 'python3.12'),
      ['-m', 'venv', venv],
    );
  }
  run(python, [
    '-c',
    'import sys; assert sys.version_info[:2] == (3, 12), "Use Python 3.12 to build speech"',
  ]);
  run(python, [
    '-m',
    'pip',
    'install',
    '--disable-pip-version-check',
    '-r',
    'speech/requirements.txt',
  ]);
  run(python, [
    '-m',
    'PyInstaller',
    '--noconfirm',
    '--distpath',
    output,
    '--workpath',
    path.join(build, 'freeze'),
    'speech/worker.spec',
  ]);
  fs.writeFileSync(stamp, key);
}
module.exports = buildSpeech;
if (require.main === module) buildSpeech();
