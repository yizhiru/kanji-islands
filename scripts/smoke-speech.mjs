import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { _electron as electron } from 'playwright';

const profile = await mkdtemp(path.join(tmpdir(), 'kanji-speech-'));
const engines = ['openjtalk', 'kokoro'];
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.KANJI_DEV_URL;
let desktop;

async function launch(offline = false) {
  const args = [`--user-data-dir=${profile}`];
  const executablePath = env.KANJI_PACKAGED_EXECUTABLE;
  if (!executablePath) args.unshift('.');
  const blocked = 'http://127.0.0.1:1';
  desktop = await electron.launch({
    executablePath,
    args,
    env: offline
      ? { ...env, https_proxy: blocked, HTTPS_PROXY: blocked, no_proxy: '', NO_PROXY: '' }
      : env,
  });
  desktop.process().stderr.on('data', (chunk) => {
    if (chunk.toString().includes('[speech]')) process.stderr.write(chunk);
  });
  const page = await desktop.firstWindow();
  // Observe the normal renderer audio element actually starting playback.
  await page.evaluate(() => {
    const original = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = async function () {
      await original.call(this);
      document.documentElement.dataset.previewPlayed = 'true';
    };
  });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  return page;
}

// Decode the actual IPC response in Chromium and inspect the PCM.
async function verifyAudio(page, engine) {
  const audio = await page.evaluate(async (name) => {
    const bytes = await window.islands.synthesizeLocal(name, 'はっぴょう');
    const context = new OfflineAudioContext(1, 1, 24000);
    const decoded = await context.decodeAudioData(bytes);
    return {
      duration: decoded.duration,
      audible: decoded.getChannelData(0).some((v) => Math.abs(v) > 0.01),
    };
  }, engine);
  assert(audio.duration > 0.1 && audio.audible, `${engine} produced silent or empty audio`);
}

try {
  let page = await launch(true);
  await page.getByRole('combobox', { name: '朗读引擎' }).selectOption('openjtalk');
  await page.getByRole('button', { name: '下载并试听' }).click();
  await page.getByRole('button', { name: '重试并试听' }).waitFor();
  await desktop.close();
  desktop = null;
  page = await launch();
  const states = () => page.evaluate(() => window.islands.localSpeechStatus());
  const initial = await states();
  for (const engine of engines) assert.equal(initial[engine].state, 'missing');
  const choice = page.getByRole('combobox', { name: '朗读引擎' });
  for (const engine of engines) {
    await choice.selectOption(engine);
    // Selection alone never starts the download.
    await page.getByRole('button', { name: '下载并试听' }).waitFor();
    assert.equal((await states())[engine].state, 'missing');
    await page.evaluate(() => delete document.documentElement.dataset.previewPlayed);
    if (engine === 'openjtalk') {
      await page.getByRole('button', { name: '关闭设置', exact: true }).click();
      await page.getByRole('button', { name: '朗读はっぴょう', exact: true }).click();
      await page.getByRole('button', { name: '设置', exact: true }).click();
    } else {
      await page.getByRole('button', { name: '下载并试听' }).click();
    }
    await page
      .getByRole('region', { name: '日语朗读' })
      .getByText('语音资源已就绪，可离线朗读。')
      .or(page.getByRole('button', { name: '重试并试听' }))
      .waitFor({ timeout: 600_000 });
    const result = (await states())[engine];
    assert.equal(result.state, 'ready', JSON.stringify(result));
    await page.getByText('语音资源已就绪，可离线朗读。').waitFor();
    await page.waitForFunction(
      () => !document.querySelector('.settings-section[aria-label="日语朗读"] button')?.disabled,
    );
    await page.waitForFunction(
      () => document.documentElement.dataset.previewPlayed === 'true',
      null,
      { timeout: 30000 },
    );
    await verifyAudio(page, engine);
    if (engine === 'openjtalk') assert.equal((await states()).kokoro.state, 'missing');
    console.log(engine, 'fresh download and playback passed');
  }
  await mkdir('output/app', { recursive: true });
  await page.screenshot({ path: 'output/app/speech-settings.png' });
  await desktop.close();
  desktop = null;
  page = await launch(true);
  assert.equal(await page.getByRole('combobox', { name: '朗读引擎' }).inputValue(), 'kokoro');
  for (const engine of engines) {
    assert.equal((await states())[engine].state, 'ready');
    await verifyAudio(page, engine);
  }
  console.log('Both engines synthesized after restart with HTTPS downloads blocked.');
} finally {
  await desktop?.close();
  await rm(profile, { recursive: true, force: true });
}
