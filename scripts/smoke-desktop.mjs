import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.KANJI_DEV_URL;
const profile = await mkdtemp(path.join(tmpdir(), 'kanji-desktop-test-'));
const profileArg = `--user-data-dir=${profile}`;
const options = process.env.KANJI_PACKAGED_EXECUTABLE
  ? { executablePath: path.resolve(process.env.KANJI_PACKAGED_EXECUTABLE), args: [profileArg], env }
  : { args: ['.', profileArg], env };
let desktop;
let page;
try {
  desktop = await electron.launch(options);
  page = await desktop.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const requests = [];
  // A packaged app must operate through its local protocol, with no web server.
  page.on('request', (request) => requests.push(request.url()));
  await page.getByTestId('word-node').waitFor();
  assert.equal(await page.title(), '汉字岛');
  await page.getByRole('button', { name: '词本练习', exact: true }).click();
  await page.getByRole('button', { name: '开始练习', exact: true }).click();
  const practice = page.getByRole('dialog', { name: 'N2 核心词汇', exact: true });
  await practice.getByText('第 1 组 · 1 / 20').waitFor();
  await practice.getByRole('button', { name: '退出练习' }).click();
  await page.getByLabel('选择练习词本文件').setInputFiles('public/practice-example.csv');
  await page
    .getByLabel('选择词本')
    .locator('option:checked')
    .filter({ hasText: 'practice-example' })
    .waitFor({ state: 'attached' });
  await page.getByRole('button', { name: '开始练习', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'practice-example' })
    .getByText('第 1 组 · 1 / 2')
    .waitFor();
  await page.getByRole('button', { name: '退出练习' }).click();
  await page.getByRole('button', { name: '关闭词本练习' }).click();
  // Dispatch a complete drag in one task so React processes the position
  // update after pointerup has cleared the active drag.
  const canvas = page.getByTestId('network-canvas');
  const transform = await canvas.locator('svg > g').getAttribute('transform');
  await canvas.evaluate((element) => {
    element.setPointerCapture = () => {};
    for (const [type, x, y] of [
      ['pointerdown', 300, 300],
      ['pointermove', 350, 350],
      ['pointerup', 350, 350],
    ]) {
      element.dispatchEvent(
        new PointerEvent(type, { bubbles: true, pointerId: 1, clientX: x, clientY: y }),
      );
    }
  });
  await page.waitForFunction(
    (before) =>
      document
        .querySelector('[data-testid="network-canvas"] svg > g')
        ?.getAttribute('transform') !== before &&
      !!document.querySelector('[data-testid="word-node"]'),
    transform,
  );
  assert.equal(await page.getByLabel('平假名读音', { exact: true }).textContent(), 'はっぴょう');
  assert.equal(
    await page.getByRole('button', { name: '显示读音', exact: true }).getAttribute('aria-pressed'),
    'true',
  );
  assert.equal(
    await page
      .getByRole('button', { name: '选中自动朗读', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  );
  assert.equal(await page.getByRole('button', { name: '朗读当前词', exact: true }).count(), 0);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  assert.equal(await page.getByRole('switch', { name: '自动折叠', exact: true }).isChecked(), true);
  const collapseCount = page.getByRole('spinbutton', { name: '自动折叠保留汉字数', exact: true });
  assert.equal(await collapseCount.inputValue(), '2');
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  assert.match(page.url(), /^islands:\/\/app\/index\.html$/);
  assert.deepEqual(await page.evaluate(() => Object.keys(window.islands)), [
    'voicevoxStatus',
    'synthesizeVoicevox',
    'localSpeechStatus',
    'synthesizeLocal',
    'onLocalSpeechStatus',
    'openSource',
    'copyText',
    'openDictionary',
  ]);
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  await page.getByRole('button', { name: '复制单词', exact: true }).click();
  assert.equal(await desktop.evaluate(({ clipboard }) => clipboard.readText()), '発表');
  await desktop.evaluate(({ shell }) => {
    globalThis.dictionaryURLs = [];
    shell.openExternal = async (url) => {
      globalThis.dictionaryURLs.push(url);
    };
  });
  await page.getByRole('link', { name: 'Jisho 词典' }).click();
  assert.deepEqual(await desktop.evaluate(() => globalThis.dictionaryURLs), [
    'https://jisho.org/search/%E7%99%BA%E8%A1%A8',
  ]);
  assert.equal(
    await page.evaluate(async () => {
      try {
        await window.islands.copyText('');
        return false;
      } catch {
        return true;
      }
    }),
    true,
  );
  assert.equal(
    await page.evaluate(async () => {
      try {
        await window.islands.openDictionary('test', 42);
        return false;
      } catch {
        return true;
      }
    }),
    true,
  );
  await page.getByRole('button', { name: '展开汉字発', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="word-node"]').length > 1,
  );
  const first = await page.getByTestId('word-node').count();
  assert(first > 1);
  await page.locator('[data-word="発電"]').hover();
  await page.getByRole('button', { name: '复制词卡单词発電', exact: true }).click();
  assert.equal(await desktop.evaluate(({ clipboard }) => clipboard.readText()), '発電');
  assert.equal(await page.getByRole('heading', { name: '発表', exact: true }).count(), 1);
  await page.getByRole('button', { name: '选中词汇発電', exact: true }).click();
  assert.equal(await page.getByLabel('平假名读音', { exact: true }).textContent(), 'はつでん');
  await page.getByRole('button', { name: '展开汉字電', exact: true }).click();
  await page.waitForFunction(
    (count) => document.querySelectorAll('[data-testid="word-node"]').length > count,
    first,
  );
  assert((await page.getByTestId('word-node').count()) > first);
  const fullCount = await page.getByTestId('word-node').count();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await collapseCount.fill('1');
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.waitForFunction(
    (count) => document.querySelectorAll('[data-testid="word-node"]').length < count,
    fullCount,
  );
  assert.equal(await page.getByLabel('平假名读音', { exact: true }).textContent(), 'はつでん');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await collapseCount.fill('2');
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.waitForFunction(
    (count) => document.querySelectorAll('[data-testid="word-node"]').length === count,
    fullCount,
  );
  const pdfWindow = desktop.waitForEvent('window');
  await page.evaluate(() => window.islands.openSource('初级', 1));
  const viewer = await pdfWindow;
  await viewer.waitForURL(/beginner\.pdf|chrome-extension:/);
  // Chromium may wrap the local file in its built-in PDF viewer.
  assert.match(viewer.url(), /beginner\.pdf|chrome-extension:/);
  await viewer.close();
  await page.locator('.details-panel').evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.locator('.toast.visible').waitFor({ state: 'hidden' });
  await mkdir('output/app', { recursive: true });
  await page.screenshot({ path: 'output/app/desktop.png' });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.screenshot({ path: 'output/app/settings.png' });
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  const expandedCount = await page.getByTestId('word-node').count();
  await page.getByRole('button', { name: '删除汉字発及其分支', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="word-node"]').length === 1,
  );
  assert.equal(await page.getByRole('heading', { name: '発表', exact: true }).count(), 1);
  assert.equal(
    await page.getByRole('button', { name: '继续展开共用汉字電', exact: true }).count(),
    0,
  );
  await page.getByRole('button', { name: '撤回上一步', exact: true }).click();
  await page.waitForFunction(
    (count) => document.querySelectorAll('[data-testid="word-node"]').length === count,
    expandedCount,
  );
  await page.reload();
  await page.waitForFunction(
    (count) => document.querySelectorAll('[data-testid="word-node"]').length === count,
    expandedCount,
  );
  assert.equal(await page.getByRole('heading', { name: '発電', exact: true }).count(), 1);

  // Add another character branch from a visible word, then grow the real
  // network to the application limit with folding disabled.
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('switch', { name: '自动折叠', exact: true }).uncheck();
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  const branch = await page.getByTestId('word-node').evaluateAll((nodes) => {
    for (const node of nodes) {
      const word = node.getAttribute('data-word');
      const kanji = [...word].find((c) => /\p{Unified_Ideograph}/u.test(c) && !'発電'.includes(c));
      if (kanji && word !== '発表') return { word, kanji };
    }
    return null;
  });
  assert(branch, 'expected a visible word with another character');
  await page.getByRole('button', { name: `选中词汇${branch.word}`, exact: true }).click();
  await page.getByRole('button', { name: `展开汉字${branch.kanji}`, exact: true }).click();
  await page
    .getByRole('button', { name: `继续展开共用汉字${branch.kanji}`, exact: true })
    .waitFor();
  const stat = page.getByTestId('network-stat');
  const wordCount = async () => Number((await stat.textContent()).match(/(\d+) 个词/)[1]);
  let count = await wordCount();
  for (let batch = 0; count < 160 && batch < 25; batch++) {
    const previous = count;
    await page.getByRole('button', { name: '继续展开共用汉字発', exact: true }).click();
    await page.waitForFunction(
      (before) => {
        const text = document.querySelector('[data-testid="network-stat"]')?.textContent ?? '';
        return Number(text.match(/(\d+) 个词/)?.[1]) > before;
      },
      previous,
      { timeout: 30000 },
    );
    count = await wordCount();
  }
  assert.equal(count, 160, 'large network should reach the word limit');
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="word-node"]').length === 160,
    null,
    { timeout: 30000 },
  );
  await page.getByRole('button', { name: '继续展开共用汉字発', exact: true }).click();
  await page.getByText('当前网络已有 160 个词，可以从新词重新开始探索。').waitFor();

  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('switch', { name: '自动折叠', exact: true }).check();
  await collapseCount.fill('1');
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="word-node"]').length < 160,
    null,
    { timeout: 30000 },
  );
  assert.equal(await wordCount(), 160, 'folding must preserve the complete network');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('switch', { name: '自动折叠', exact: true }).uncheck();
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="word-node"]').length === 160,
    null,
    { timeout: 30000 },
  );
  await page.reload();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="network-stat"]')?.textContent?.includes('160 个词'),
    null,
    { timeout: 60000 },
  );
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('switch', { name: '自动折叠', exact: true }).uncheck();
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="word-node"]').length === 160,
    null,
    { timeout: 60000 },
  );
  assert.equal(await wordCount(), 160, 'large network should survive reload');
  assert.equal(await page.getByRole('heading', { name: '発表', exact: true }).count(), 1);
  assert.deepEqual(errors, []);
  assert(!requests.some((url) => /^https?:/.test(url)));
  const versions = await desktop.evaluate(({ app }) => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    packaged: app.isPackaged,
  }));
  assert.equal(versions.version, JSON.parse(await readFile('package.json', 'utf8')).version);
  await writeFile(
    'output/app/desktop-check.json',
    JSON.stringify(
      {
        ...versions,
        runtime: 'local islands:// protocol',
        errors,
        passed: [
          'context isolation',
          'offline vocabulary',
          'offline Shikken practice and local CSV practice',
          'two-hop expansion',
          'reading and automatic speech are enabled by default in one toolbar group',
          'automatic folding is configurable in settings and defaults to two recent characters',
          'local PDF',
          'restore expanded exploration after reload',
          'native clipboard from cards and details',
          'allowlisted dictionary opener',
          'remove kanji branch and detached descendants, then undo',
          '160-word network expansion, limit, folding, unfolding and reload',
          'rapid drag and release keeps the network visible',
        ],
      },
      null,
      2,
    ),
  );
  await page.keyboard.press('Alt+r');
  assert.equal(
    await page.getByRole('button', { name: '显示读音', exact: true }).getAttribute('aria-pressed'),
    'false',
  );
  await desktop.close();
  desktop = await electron.launch(options);
  page = await desktop.firstWindow();
  await page.getByTestId('word-node').first().waitFor({ timeout: 60000 });
  assert.equal(
    await page.getByRole('button', { name: '显示读音', exact: true }).getAttribute('aria-pressed'),
    'false',
  );
  await page.getByRole('button', { name: '设置', exact: true }).click();
  assert.equal(
    await page.getByRole('switch', { name: '自动折叠', exact: true }).isChecked(),
    false,
  );
  assert.equal(
    await page.getByRole('spinbutton', { name: '自动折叠保留汉字数' }).inputValue(),
    '1',
  );
  console.log('Desktop smoke test passed:', versions);
} catch (error) {
  if (page && !page.isClosed()) {
    await mkdir('output/app', { recursive: true });
    await page
      .screenshot({ path: 'output/app/desktop-failure.png', timeout: 5000 })
      .catch(() => {});
  }
  throw error;
} finally {
  await desktop?.close();
  await rm(profile, { recursive: true, force: true });
}
