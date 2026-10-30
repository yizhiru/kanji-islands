import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.KANJI_DEV_URL;
const options = process.env.KANJI_PACKAGED_EXECUTABLE
  ? { executablePath: path.resolve(process.env.KANJI_PACKAGED_EXECUTABLE), args: [], env }
  : { args: ['.'], env };
const desktop = await electron.launch(options);
try {
  const page = await desktop.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const requests = [];
  // A packaged app must operate through its local protocol, with no web server.
  page.on('request', (request) => requests.push(request.url()));
  await page.getByTestId('word-node').waitFor();
  assert.equal(await page.title(), '汉字岛');
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
  await page.locator('[data-word="発音"]').hover();
  await page.getByRole('button', { name: '复制词卡单词発音', exact: true }).click();
  assert.equal(await desktop.evaluate(({ clipboard }) => clipboard.readText()), '発音');
  assert.equal(await page.getByRole('heading', { name: '発表', exact: true }).count(), 1);
  await page.getByRole('button', { name: '选中词汇発音', exact: true }).click();
  assert.equal(await page.getByLabel('平假名读音', { exact: true }).textContent(), 'はつおん');
  await page.getByRole('button', { name: '展开汉字音', exact: true }).click();
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
  assert.equal(await page.getByLabel('平假名读音', { exact: true }).textContent(), 'はつおん');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await collapseCount.fill('2');
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.waitForFunction(
    (count) => document.querySelectorAll('[data-testid="word-node"]').length === count,
    fullCount,
  );
  assert.deepEqual(await page.evaluate(() => Object.keys(localStorage)), []);
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
    await page.getByRole('button', { name: '继续展开共用汉字音', exact: true }).count(),
    0,
  );
  await page.getByRole('button', { name: '撤回上一步', exact: true }).click();
  await page.waitForFunction(
    (count) => document.querySelectorAll('[data-testid="word-node"]').length === count,
    expandedCount,
  );
  await page.reload();
  await page.getByTestId('word-node').waitFor();
  assert.equal(await page.getByTestId('word-node').count(), 1);
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
          'two-hop expansion',
          'reading and automatic speech are enabled by default in one toolbar group',
          'automatic folding is configurable in settings and defaults to two recent characters',
          'local PDF',
          'no persisted exploration',
          'native clipboard from cards and details',
          'allowlisted dictionary opener',
          'remove kanji branch and detached descendants, then undo',
        ],
      },
      null,
      2,
    ),
  );
  console.log('Desktop smoke test passed:', versions);
} finally {
  await desktop.close();
}
