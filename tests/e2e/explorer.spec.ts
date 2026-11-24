import { expect, test } from '@playwright/test';

test('expands a word into a multi-hop network, shows selected readings, and supports undo', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByTestId('word-node')).toHaveCount(1);
  await expect(page.getByLabel('平假名读音', { exact: true })).toHaveText('はっぴょう');
  await page.getByRole('button', { name: '展开汉字発', exact: true }).click();
  await expect(page.getByTestId('word-node')).not.toHaveCount(1);
  await expect(
    page
      .getByTestId('word-node')
      .filter({ has: page.getByRole('button', { name: '选中词汇発電', exact: true }) }),
  ).toBeVisible();
  const firstCount = await page.getByTestId('word-node').count();
  await page.getByRole('button', { name: '选中词汇発電', exact: true }).click();
  await expect(page.getByLabel('平假名读音', { exact: true })).toHaveText('はつでん');
  await page.getByRole('button', { name: '展开汉字電', exact: true }).click();
  await expect.poll(() => page.getByTestId('word-node').count()).toBeGreaterThan(firstCount);
  await expect(page.getByRole('button', { name: '继续展开共用汉字発', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '继续展开共用汉字電', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '显示读音', exact: true }).click();
  await expect(page.getByLabel('平假名读音', { exact: true })).toHaveText('はつでん');
  await page.getByRole('button', { name: '撤回上一步' }).click();
  await expect(page.getByTestId('word-node')).toHaveCount(firstCount);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect.poll(() => page.getByTestId('word-node').count()).toBeGreaterThan(firstCount);
  expect(errors).toEqual([]);
});

test('hides card readings on hover and focus while details stay visible independently', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page).toHaveTitle('汉字岛');
  await expect(page.getByRole('link', { name: '汉字岛首页' })).toBeVisible();
  const root = page.locator('[data-testid="word-node"][data-word="発表"]');
  await expect(root.locator('.node-reading')).toBeVisible();
  await page.getByRole('button', { name: '显示读音', exact: true }).click();
  await expect(root.locator('.node-reading')).toBeHidden();
  await root.hover();
  await expect(root.locator('.node-reading')).toBeHidden();
  await expect(root).not.toHaveAttribute('title', 'はっぴょう');
  await page.getByRole('heading', { name: '词汇成岛，汉字相连。' }).hover();
  await expect(root.locator('.node-reading')).toBeHidden();
  await page.getByRole('button', { name: '展开汉字発', exact: true }).focus();
  await expect(root.locator('.node-reading')).toBeHidden();
  await page.getByRole('button', { name: '展开汉字発', exact: true }).click();
  const card = page.locator('[data-word="発電"]');
  await card.hover();
  await expect(card.locator('.node-reading')).toBeHidden();
  await page.getByRole('button', { name: '选中词汇発電', exact: true }).click();
  await expect(page.getByLabel('平假名读音', { exact: true })).toHaveText('はつでん');
  await page.getByRole('button', { name: '显示读音', exact: true }).click();
  await expect(root.locator('.node-reading')).toBeVisible();
  await page.getByRole('button', { name: '显示读音', exact: true }).click();
  await expect(root.locator('.node-reading')).toBeHidden();
  await expect(page.getByLabel('平假名读音', { exact: true })).toHaveText('はつでん');
});

test('persists display settings and toggles card readings with Alt+R', async ({ page }) => {
  await page.goto('/');
  const toggle = page.getByRole('button', { name: '显示读音', exact: true });
  const card = page.getByTestId('word-node').first();
  await expect(toggle).toHaveAttribute('aria-keyshortcuts', 'Alt+R');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('spinbutton', { name: '自动折叠保留汉字数' }).fill('1');
  await page.getByRole('switch', { name: '自动折叠' }).uncheck();
  await page.keyboard.press('Alt+r');
  await expect(page.locator('.reading-toggle').first()).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.keyboard.press('Alt+r');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(card.locator('.node-reading')).toBeHidden();
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(card.locator('.node-reading')).toBeHidden();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByRole('switch', { name: '自动折叠' })).not.toBeChecked();
  await expect(page.getByRole('spinbutton', { name: '自动折叠保留汉字数' })).toHaveValue('1');
  await page.getByRole('switch', { name: '自动折叠' }).check();
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  const input = page.getByRole('combobox', { name: '输入起始词' });
  await input.focus();
  await page.keyboard.press('Alt+r');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await input.blur();
  await page.keyboard.press('Alt+r');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(card.locator('.node-reading')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByRole('switch', { name: '自动折叠' })).toBeChecked();
  await expect(page.getByRole('spinbutton', { name: '自动折叠保留汉字数' })).toHaveValue('1');
});

test('falls back to display defaults when stored settings are invalid', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'kanji-islands.display-settings.v1',
      JSON.stringify({ autoCollapse: 'false', visibleKanjiCount: 9999, showReading: null }),
    );
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: '显示读音', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByRole('switch', { name: '自动折叠' })).toBeChecked();
  await expect(page.getByRole('spinbutton', { name: '自动折叠保留汉字数' })).toHaveValue('2');
});

test('searches real words, accepts custom seeds, and changes scope and lesson', async ({
  page,
}) => {
  await page.goto('/');
  const input = page.getByRole('combobox', { name: '输入起始词' });
  await input.fill('はつおん');
  await page.getByRole('option').first().click();
  await expect(page.getByRole('heading', { name: '発音', exact: true })).toBeVisible();
  await input.fill('架空発表');
  await page.getByRole('button', { name: '开始探索' }).click();
  await expect(page.getByText('自定义起点 · 词库暂未收录')).toBeVisible();
  await expect(page.getByLabel('平假名读音', { exact: true })).toHaveText('词库中暂无读音');
  await page.getByRole('button', { name: '展开汉字発', exact: true }).click();
  await expect.poll(() => page.getByTestId('word-node').count()).toBeGreaterThan(1);
  await page.getByRole('button', { name: '标日', exact: true }).click();
  await expect(page.getByTestId('word-node')).toHaveCount(1);
  await page.getByRole('combobox', { name: '筛选课次' }).selectOption('初级:28');
  await page.getByRole('button', { name: '通过発展开关联词', exact: true }).click();
  await page.getByRole('button', { name: '查看关联词発音', exact: true }).click();
  await expect(page.locator('[data-testid="word-node"][data-word="発音"]')).toBeVisible();
});

test('restores the last exploration and undo history without external requests', async ({
  page,
}) => {
  const external: string[] = [];
  await page.route('**/*', async (route) => {
    if (!new URL(route.request().url()).hostname.match(/^(127\.0\.0\.1|localhost)$/)) {
      external.push(route.request().url());
      await route.abort();
    } else await route.continue();
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '発表', exact: true })).toBeVisible();
  const textbook = page.getByRole('button', { name: '标日', exact: true });
  await textbook.click();
  await page.getByRole('button', { name: '展开汉字発', exact: true }).click();
  await expect.poll(() => page.getByTestId('word-node').count()).toBeGreaterThan(1);
  const expandedCount = await page.getByTestId('word-node').count();
  await page.getByRole('button', { name: '选中词汇発音', exact: true }).click();
  await page.reload();
  await expect(textbook).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: '発音', exact: true })).toBeVisible();
  await expect(page.getByTestId('word-node')).toHaveCount(expandedCount);
  await page.getByRole('button', { name: '撤回上一步', exact: true }).click();
  await expect(page.getByRole('heading', { name: '発表', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect(page.getByRole('heading', { name: '発音', exact: true })).toBeVisible();
  expect(external).toEqual([]);
});

test('shows dictionary credits and labels inflected meanings', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '词库与来源', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('上次的词网');
  await page.getByRole('button', { name: '查看完整署名与许可' }).click();
  await expect(page.locator('.license-text')).toContainText('CC BY-SA 4.0');
  await page.getByRole('button', { name: '关闭词库说明' }).click();
  await page.getByRole('combobox', { name: '输入起始词' }).fill('分かりません');
  await page.getByRole('button', { name: '开始探索' }).click();
  await expect(page.getByText('礼貌体否定式', { exact: true })).toBeVisible();
  await expect(page.getByText('以下为原形释义；实际含义需结合活用。')).toBeVisible();
  await expect(page.locator('.word-references')).toContainText('标日初级');
  await expect(page.getByRole('button', { name: '教材出处与原始记录' })).toHaveCount(0);
});

test('preserves lesson symbols and explains them beside textbook references', async ({ page }) => {
  await page.goto('/');
  const search = page.getByRole('combobox', { name: '输入起始词' });
  const references = page.locator('.word-references > span');
  const help = page.getByLabel('课次符号说明', { exact: true });
  await search.fill('おおざっぱ');
  await page.getByRole('button', { name: '开始探索' }).click();
  await expect(references).toContainText('标日中级31※');
  await expect(page.locator('.reference-legend')).toBeHidden();
  await help.hover();
  await expect(page.locator('.reference-legend')).toBeVisible();
  await expect(page.locator('.reference-legend')).toContainText('数字表示该词初次出现的课次');
  await expect(page.locator('.reference-legend')).toContainText('讲解或练习中的生词');
  await expect(page.locator('.reference-legend')).toContainText('关联词语');
  await page.getByRole('heading', { name: '词汇成岛，汉字相连。' }).hover();
  await expect(page.locator('.reference-legend')).toBeHidden();
  await search.fill('きれい');
  await page.getByRole('button', { name: '开始探索' }).click();
  await expect(references).toContainText('标日中级31▼');
  await help.focus();
  await expect(page.locator('.reference-legend')).toBeVisible();
  await search.fill('えさ');
  await page.getByRole('button', { name: '开始探索' }).click();
  await expect(references).toContainText('标日中级31');
  await expect(references).not.toContainText('※');
  await expect(references).not.toContainText('▼');
  await expect(page.locator('.reference-legend')).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  await help.hover();
  await expect(page.locator('.reference-legend')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('remains usable at narrow widths without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '発表', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '展开汉字発', exact: true }).click();
  await expect.poll(() => page.getByTestId('word-node').count()).toBeGreaterThan(1);
});

test('searches the standard dictionary and keeps textbook-only filters', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '标准词库', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const search = page.getByRole('combobox', { name: '输入起始词' });
  await search.fill('量子力学');
  await page.getByRole('option').first().click();
  await expect(page.getByRole('heading', { name: '量子力学', exact: true })).toBeVisible();
  await expect(page.locator('.word-references')).toContainText('未匹配标日课次');
  await expect(page.locator('.entry-meanings')).not.toHaveCount(0);
  await page.getByRole('button', { name: '标日', exact: true }).click();
  await expect(page.locator('.scope-control button')).toHaveText(['标准词库', '标日']);
  await expect(page.getByRole('combobox', { name: '筛选课次' }).locator('optgroup')).toHaveCount(2);
  await expect(page.locator('option[value="初级:1"]')).toHaveCount(1);
  await expect(page.locator('option[value="中级:1"]')).toHaveCount(1);
  await search.fill('量子力学');
  await expect(page.locator('#search-suggestions [role="option"]')).toHaveCount(0);
  await search.fill('発音');
  await page.getByRole('button', { name: '开始探索', exact: true }).click();
  await expect(page.locator('.word-references')).toContainText('标日初级28※');
  await search.fill('発表');
  await page.getByRole('button', { name: '开始探索', exact: true }).click();
  await expect(page.locator('.word-references')).toContainText('标日中级7※');
  await search.fill('量子力学');
  await page.getByRole('button', { name: '标准词库', exact: true }).click();
  await search.focus();
  await expect(page.locator('#search-suggestions [role="option"]').first()).toContainText(
    '量子力学',
  );
});

test('copies card and detail words without expanding or selecting another card', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await page.getByRole('button', { name: '复制单词', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已复制「発表」');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('発表');
  await page.getByRole('button', { name: '展开汉字発', exact: true }).click();
  const count = await page.getByTestId('word-node').count();
  await page.locator('[data-word="発電"]').hover();
  await page.getByRole('button', { name: '复制词卡单词発電', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已复制「発電」');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('発電');
  await expect(page.getByRole('heading', { name: '発表', exact: true })).toBeVisible();
  await expect(page.getByTestId('word-node')).toHaveCount(count);
  expect(
    await page.locator('.selected-word-block h2').evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      return window.getSelection()?.toString();
    }),
  ).toBe('発表');
});

test('offers separate local Japanese readings and a dictionary link', async ({ page }) => {
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
        getVoices: () => [{ name: 'Test Japanese', lang: 'ja-JP', localService: true }],
        addEventListener: () => {},
        removeEventListener: () => {},
        cancel: () => {
          state.canceled++;
        },
        speak: (utterance: SpeechSynthesisUtterance) => {
          state.spoken.push(utterance.text);
        },
      },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '选中自动朗读', exact: true }).click();
  await page.getByRole('button', { name: '朗读はっぴょう', exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { spoken: string[] }).spoken)).toEqual([
    'はっぴょう',
  ]);
  const search = page.getByRole('combobox', { name: '输入起始词' });
  await search.fill('生物');
  await page.getByRole('button', { name: '开始探索' }).click();
  await expect(page.getByRole('button', { name: '朗读なまもの', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '朗读せいぶつ', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '朗读なまもの', exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { spoken: string[] }).spoken)).toEqual([
    'はっぴょう',
    'なまもの',
  ]);
  await expect(page.getByRole('link', { name: 'Jisho 词典' })).toHaveAttribute(
    'href',
    'https://jisho.org/search/%E7%94%9F%E7%89%A9',
  );
  const help = page.getByRole('button', { name: '读音说明', exact: true });
  const note = page.locator('.pronunciation-note');
  await expect(note).toBeHidden();
  await help.hover();
  await expect(note).toBeVisible();
  await expect(note).toContainText('系统合成语音');
  await page.getByRole('heading', { name: '生物', exact: true }).hover();
  await expect(note).toBeHidden();
  await help.focus();
  await expect(note).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(note).toBeHidden();
  await help.click();
  await expect(note).toBeVisible();
  await page.getByRole('heading', { name: '生物', exact: true }).hover();
  await expect(note).toBeVisible();
  await help.click();
  await expect(note).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  await help.click();
  await expect(note).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('heading', { name: '生物', exact: true }).click();
  await expect(note).toBeHidden();
});

test('explains missing local speech voices and retains the external dictionary fallback', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'speechSynthesis', {
      value: {
        getVoices: () => [
          { name: 'English', lang: 'en-US', localService: true },
          { name: 'Remote Japanese', lang: 'ja-JP', localService: false },
        ],
        addEventListener: () => {},
        removeEventListener: () => {},
        cancel: () => {},
      },
    });
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: '朗读はっぴょう', exact: true })).toBeDisabled();
  await expect(page.locator('.pronunciation-note')).toBeHidden();
  await page.getByRole('button', { name: '读音说明', exact: true }).click();
  await expect(page.locator('.pronunciation-note')).toBeVisible();
  await expect(page.locator('.pronunciation-note')).toContainText('本机未检测到日语语音');
  await expect(page.getByRole('link', { name: 'Jisho 词典' })).toBeVisible();
});

test('removes a kanji branch and its detached words with undo and redo', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '展开汉字発', exact: true }).click();
  await page.getByRole('button', { name: '选中词汇発電', exact: true }).click();
  await page.getByRole('button', { name: '展开汉字電', exact: true }).click();
  const count = await page.getByTestId('word-node').count();
  await page.getByRole('button', { name: '删除汉字電及其分支', exact: true }).click();
  await expect(page.getByRole('button', { name: '继续展开共用汉字電', exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole('button', { name: '继续展开共用汉字発', exact: true })).toBeVisible();
  await expect(page.locator('[data-word="発電"]')).toBeVisible();
  expect(await page.getByTestId('word-node').count()).toBeLessThan(count);
  await page.getByRole('button', { name: '撤回上一步', exact: true }).click();
  await expect(page.getByTestId('word-node')).toHaveCount(count);
  await expect(page.getByRole('button', { name: '删除汉字電及其分支', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect(page.getByRole('button', { name: '继续展开共用汉字電', exact: true })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: '删除汉字発及其分支', exact: true }).click();
  await expect(page.getByTestId('word-node')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: '発表', exact: true })).toBeVisible();
  await expect(page.getByTestId('network-stat')).toContainText('0 个汉字');
  await page.getByRole('button', { name: '展开汉字発', exact: true }).click();
  await expect(page.getByRole('button', { name: '删除汉字発及其分支', exact: true })).toBeVisible();
});

test('keeps standard readings and meanings for a pending textbook word across filters', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('combobox', { name: '输入起始词' }).fill('緑化');
  await page.getByRole('button', { name: '开始探索', exact: true }).click();
  const reading = page.getByLabel('平假名读音', { exact: true });
  await expect(reading).toHaveText('りょっか / りょくか');
  const meanings = await page.locator('.meaning-section').innerText();
  await expect(page.locator('.word-references')).toContainText('未匹配标日课次');

  await page.getByRole('button', { name: '标日', exact: true }).click();
  for (const lesson of ['', '中级:19', '初级:1']) {
    await page.getByRole('combobox', { name: '筛选课次' }).selectOption(lesson);
    await expect(reading).toHaveText('りょっか / りょくか');
    await expect(page.getByRole('button', { name: '朗读りょっか', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '朗读りょくか', exact: true })).toBeVisible();
    await expect(page.locator('.meaning-section')).toHaveText(meanings, { useInnerText: true });
    await expect(page.locator('.word-references')).toContainText('该词不在当前筛选范围内');
    await expect(page.getByLabel('课次符号说明', { exact: true })).toHaveCount(0);
  }
});

test('labels word islands by grammatical class with readings shown or hidden', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  const root = page.locator('.word-node.is-root');
  const label = root.locator('.node-pos');
  const toggle = page.getByRole('switch', { name: '显示词性角标' });
  const settings = page.getByRole('button', { name: '设置', exact: true });
  const close = page.getByRole('button', { name: '关闭设置' });
  await expect(root).toBeVisible();
  await expect(label).toHaveCount(0);
  await expect(page.getByLabel('词性', { exact: true })).toContainText('名词');
  await settings.click();
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await close.click();
  await page.reload();
  await expect(label).toHaveText('名·サ变');
  await expect(label).toHaveCSS('position', 'absolute');
  await expect(label).toHaveAttribute('title', /可接する/);
  await page.getByRole('button', { name: '加入生词本', exact: true }).click();
  await page.getByRole('button', { name: '展开汉字発', exact: true }).click();
  await expect(page.locator('[data-word="発つ"] .node-pos')).toHaveText('五段');
  await expect(page.locator('.node-pos')).toHaveCount(await page.getByTestId('word-node').count());
  await expect(root.getByRole('button', { name: '将発表移出生词本' })).toBeVisible();
  const otherLabel = page.locator('[data-word="発つ"] .node-pos');
  await expect(otherLabel).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(label).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await page.mouse.move(0, 0);
  await page.screenshot({ path: testInfo.outputPath('island-labels-desktop.png') });
  await page
    .locator('.network-svg > g')
    .screenshot({ path: testInfo.outputPath('island-labels-network.png') });
  await page.getByRole('button', { name: '选中词汇発つ', exact: true }).click();
  await expect(label).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(otherLabel).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await page.getByRole('button', { name: '显示读音', exact: true }).click();
  await expect(label).toBeVisible();
  await expect(root.locator('.node-reading')).toBeHidden();
  const input = page.getByRole('combobox', { name: '输入起始词' });
  for (const [word, short, full] of [
    ['走る', '五段', '五段动词'],
    ['食べる', '一段', '一段动词'],
    ['美しい', 'い形', 'い形容词'],
    ['静か', 'な形', 'な形容词'],
    ['おいしさ', '名', '名词'],
    ['架空発表', '?', '词性未标注'],
  ]) {
    await input.fill(word);
    await page.getByRole('button', { name: '开始探索', exact: true }).click();
    await expect(root).toHaveAttribute('data-word', word);
    await expect(label).toHaveText(short);
    await expect(page.getByLabel('词性', { exact: true })).toContainText(full);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await input.fill('美しい');
  await page.getByRole('button', { name: '开始探索', exact: true }).click();
  await expect(label).toHaveText('い形');
  await page.getByRole('button', { name: '加入生词本', exact: true }).click();
  await root.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('island-labels-mobile.png') });
  await settings.click();
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await close.click();
  await expect(label).toHaveCount(0);
  await page.reload();
  await expect(root).toBeVisible();
  await expect(label).toHaveCount(0);
});
