import { expect, test } from '@playwright/test';

const words = [
  ['発表', 'はっぴょう'],
  ['発音', 'はつおん'],
  ['発展', 'はってん'],
  ['音楽', 'おんがく'],
  ['音声', 'おんせい'],
  ['楽園', 'らくえん'],
  ['楽曲', 'がっきょく'],
  ['園芸', 'えんげい'],
  ['発表音', 'はっぴょうおん'],
  ['表面', 'ひょうめん'],
];

test.beforeEach(async ({ page }) => {
  await page.route('**/vocabulary.json', (route) =>
    route.fulfill({
      json: {
        version: 1,
        metadata: {
          entryCount: words.length,
          pendingGroups: 0,
          sourceHash: '',
          chineseVersion: '',
          englishVersion: '',
        },
        entries: words.map(([word, reading], i) => ({
          id: `entry:${i}`,
          word,
          reading_hiragana: reading,
          jmdict_id: i + 1,
          meanings_zh: ['释义'],
          meanings_en: ['meaning'],
          sources: [],
          references: '',
          senses: [
            {
              id: `sense:${i}`,
              zh: ['释义'],
              en: ['meaning'],
              pos: [],
              labels: [],
              notes_zh: [],
              notes_en: [],
            },
          ],
        })),
      },
    }),
  );
  await page.addInitScript(() => {
    const state = window as unknown as { spoken: string[]; canceled: number };
    state.spoken = [];
    state.canceled = 0;
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      value: class {
        constructor(public text: string) {}
      },
    });
    Object.defineProperty(window, 'speechSynthesis', {
      value: {
        getVoices: () => [{ name: 'Japanese', lang: 'ja-JP', localService: true }],
        addEventListener() {},
        removeEventListener() {},
        cancel() {
          state.canceled++;
        },
        speak(u: SpeechSynthesisUtterance) {
          state.spoken.push(u.text);
        },
      },
    });
  });
});

test('selects card borders and blank space, reads automatically, and preserves copy and expansion actions', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  const spoken = () => page.evaluate(() => (window as unknown as { spoken: string[] }).spoken);
  expect(await spoken()).toEqual([]);
  await page.getByRole('button', { name: '展开汉字発', exact: true }).click();
  const card = page.locator('[data-word="発音"]');
  await card.click({ position: { x: 1, y: 20 } });
  await expect(page.getByRole('heading', { name: '発音', exact: true })).toBeVisible();
  expect(await spoken()).toEqual(['はつおん']);
  await page.keyboard.press('Control+Enter');
  expect(await spoken()).toEqual(['はつおん']);
  await page.locator('[data-word="発展"]').hover();
  await page.getByRole('button', { name: '复制词卡单词発展', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('発展');
  await expect(page.getByRole('heading', { name: '発音', exact: true })).toBeVisible();
  expect(await spoken()).toHaveLength(1);
  await page.getByRole('button', { name: '展开汉字音', exact: true }).click();
  expect(await spoken()).toHaveLength(1);
  await page.getByRole('button', { name: '选中自动朗读', exact: true }).click();
  await page.locator('[data-word="音楽"]').click({ position: { x: 10, y: 65 } });
  await expect(page.getByRole('heading', { name: '音楽', exact: true })).toBeVisible();
  expect(await spoken()).toHaveLength(1);
  await page.getByRole('button', { name: '收起词汇详情', exact: true }).click();
  await page.keyboard.press('Control+Enter');
  expect(await spoken()).toEqual(['はつおん']);
  await page.getByRole('button', { name: '展开词汇详情', exact: true }).click();
  await page.getByRole('button', { name: '朗读おんがく', exact: true }).click();
  expect(await spoken()).toEqual(['はつおん', 'おんがく']);
  const search = page.getByRole('combobox', { name: '输入起始词' });
  await search.fill('発表');
  const copyModifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  await search.press(`${copyModifier}+a`);
  await search.press(`${copyModifier}+c`);
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('発表');
  await search.fill('');
  await search.press('Control+Enter');
  expect(await spoken()).toHaveLength(2);
  await page.getByRole('button', { name: '词库与来源', exact: true }).click();
  await page.keyboard.press('Control+Enter');
  expect(await spoken()).toHaveLength(2);
});

test('folds old side branches, restores all words, and follows undo, redo and branch removal', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '展开汉字発', exact: true }).click();
  await page.getByRole('button', { name: '选中词汇発音', exact: true }).click();
  await page.getByRole('button', { name: '展开汉字音', exact: true }).click();
  await expect(page.locator('[data-word="発展"]')).toBeVisible();
  const twoLayerCount = await page.getByTestId('word-node').count();
  await page.getByRole('button', { name: '选中词汇音楽', exact: true }).click();
  await page.getByRole('button', { name: '展开汉字楽', exact: true }).click();
  await expect(page.locator('[data-word="発展"]')).toHaveCount(0);
  for (const word of ['発表', '発音', '音楽', '音声', '楽園', '楽曲'])
    await expect(page.locator(`[data-word="${word}"]`)).toBeVisible();
  await expect(page.locator('.collapse-notice')).toContainText('已折叠 1 个旧词');
  await page.locator('.collapse-notice').click();
  await page.getByRole('switch', { name: '自动折叠', exact: true }).uncheck();
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await expect(page.locator('[data-word="発展"]')).toBeVisible();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('switch', { name: '自动折叠', exact: true }).check();
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await expect(page.locator('[data-word="発展"]')).toHaveCount(0);
  await page.getByRole('button', { name: '撤回上一步', exact: true }).click();
  await expect(page.getByTestId('word-node')).toHaveCount(twoLayerCount);
  await expect(page.locator('[data-word="発展"]')).toBeVisible();
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect(page.locator('[data-word="発展"]')).toHaveCount(0);
  await page.getByRole('button', { name: '删除汉字楽及其分支', exact: true }).click();
  await expect(page.locator('[data-word="発展"]')).toBeVisible();
  await expect(page.getByTestId('word-node')).toHaveCount(twoLayerCount);
});

test('fits laptop windows, expands the canvas when details collapse, and avoids mobile overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/');
  const canvas = page.getByTestId('network-canvas');
  await expect(page.getByTestId('word-node')).toHaveCount(1);
  const readingControls = page.getByRole('group', { name: '读音与朗读', exact: true });
  await expect(readingControls.getByRole('button')).toHaveCount(2);
  await expect(
    readingControls.getByRole('button', { name: '显示读音', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    readingControls.getByRole('button', { name: '选中自动朗读', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: '朗读当前词', exact: true })).toHaveCount(0);
  await expect(page.getByRole('switch', { name: '自动折叠', exact: true })).toHaveCount(0);
  await expect(page.getByRole('spinbutton')).toHaveCount(0);
  const before = (await canvas.boundingBox())!;
  expect(before.y).toBeLessThan(220);
  expect(before.height).toBeGreaterThan(520);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(
    true,
  );
  await page.getByRole('button', { name: '收起词汇详情', exact: true }).click();
  await expect(page.getByRole('complementary', { name: '词汇详情', exact: true })).toBeHidden();
  expect((await canvas.boundingBox())!.width - before.width).toBeGreaterThan(300);
  await page.getByRole('button', { name: '展开词汇详情', exact: true }).click();
  await expect(page.getByRole('heading', { name: '発表', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 900, height: 680 });
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollHeight <= innerHeight &&
        document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '设置', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '设置', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '选中自动朗读', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '展开汉字発', exact: true }).click();
  await page.locator('[data-word="発音"]').click({ position: { x: 1, y: 20 } });
  await expect(page.getByRole('heading', { name: '発音', exact: true })).toBeVisible();
});

test('automatically folds by recent character count, supports custom counts and promotes re-expanded groups', async ({
  page,
}) => {
  await page.goto('/');
  const toggle = page.getByRole('switch', { name: '自动折叠', exact: true });
  const count = page.getByRole('spinbutton', { name: '自动折叠保留汉字数', exact: true });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(toggle).toBeChecked();
  await expect(count).toHaveValue('2');
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await expect(page.getByText('聚焦探索', { exact: true })).toHaveCount(0);
  await page.getByRole('combobox', { name: '输入起始词' }).fill('発表音');
  await page.getByRole('button', { name: '开始探索', exact: true }).click();
  for (const character of ['発', '表', '音'])
    await page.getByRole('button', { name: `展开汉字${character}`, exact: true }).click();
  await expect(page.locator('[data-word="発展"]')).toHaveCount(0);
  await expect(page.locator('[data-word="表面"]')).toBeVisible();
  await expect(page.locator('[data-word="音楽"]')).toBeVisible();
  await expect(page.locator('[data-word="発音"]')).toBeVisible();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await count.fill('3');
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await expect(page.locator('[data-word="発展"]')).toBeVisible();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(count).toHaveValue('3');
  await count.fill('1');
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await expect(page.locator('[data-word="発展"]')).toHaveCount(0);
  await expect(page.locator('[data-word="表面"]')).toHaveCount(0);
  await expect(page.locator('[data-word="音楽"]')).toBeVisible();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await count.fill('0');
  await count.blur();
  await expect(count).toHaveValue('1');
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(count).toBeDisabled();
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await expect(page.locator('[data-word="発展"]')).toBeVisible();
  await expect(page.locator('[data-word="表面"]')).toBeVisible();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await toggle.click();
  await count.fill('2');
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.getByRole('button', { name: '展开汉字発', exact: true }).click();
  await expect(page.locator('[data-word="発展"]')).toBeVisible();
  await expect(page.locator('[data-word="音楽"]')).toBeVisible();
  await expect(page.locator('[data-word="表面"]')).toHaveCount(0);
  await page.locator('.collapse-notice').click();
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect(toggle).not.toBeChecked();
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await expect(page.locator('[data-word="表面"]')).toBeVisible();
});
