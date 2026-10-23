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
      .filter({ has: page.getByRole('button', { name: '选中词汇発音', exact: true }) }),
  ).toBeVisible();
  const firstCount = await page.getByTestId('word-node').count();
  await page.getByRole('button', { name: '选中词汇発音', exact: true }).click();
  await expect(page.getByLabel('平假名读音', { exact: true })).toHaveText('はつおん');
  await page.getByRole('button', { name: '展开汉字音', exact: true }).click();
  await expect.poll(() => page.getByTestId('word-node').count()).toBeGreaterThan(firstCount);
  await expect(page.getByRole('button', { name: '继续展开共用汉字発', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '继续展开共用汉字音', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '显示读音', exact: true }).click();
  await expect(page.getByLabel('平假名读音', { exact: true })).toHaveText('はつおん');
  await page.getByRole('button', { name: '撤回上一步' }).click();
  await expect(page.getByTestId('word-node')).toHaveCount(firstCount);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect.poll(() => page.getByTestId('word-node').count()).toBeGreaterThan(firstCount);
  expect(errors).toEqual([]);
});

test('reveals card readings on hover and focus while details stay visible independently', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page).toHaveTitle('汉字岛');
  await expect(page.getByRole('link', { name: '汉字岛首页' })).toBeVisible();
  const root = page.getByTestId('word-node').filter({ hasText: '発表' });
  await expect(root.locator('.node-reading')).toBeHidden();
  await root.hover();
  await expect(root.locator('.node-reading')).toBeVisible();
  await expect(root.locator('.node-reading')).toHaveText('はっぴょう');
  await page.getByRole('heading', { name: '词汇成岛，汉字相连。' }).hover();
  await expect(root.locator('.node-reading')).toBeHidden();
  await page.getByRole('button', { name: '展开汉字発', exact: true }).focus();
  await expect(root.locator('.node-reading')).toBeVisible();
  await page.getByRole('button', { name: '展开汉字発', exact: true }).click();
  const card = page.locator('[data-word="発音"]');
  await card.hover();
  await expect(card.locator('.node-reading')).toBeVisible();
  await expect(card.locator('.node-reading')).toHaveText('はつおん');
  await page.getByRole('button', { name: '选中词汇発音', exact: true }).click();
  await expect(page.getByLabel('平假名读音', { exact: true })).toHaveText('はつおん');
  await page.getByRole('button', { name: '显示读音', exact: true }).click();
  await expect(root.locator('.node-reading')).toBeVisible();
  await page.getByRole('button', { name: '隐藏读音', exact: true }).click();
  await expect(root.locator('.node-reading')).toBeHidden();
  await expect(page.getByLabel('平假名读音', { exact: true })).toHaveText('はつおん');
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
  expect(await page.getByTestId('word-node').count()).toBeGreaterThan(1);
  await page.getByRole('button', { name: '初级', exact: true }).click();
  await expect(page.getByTestId('word-node')).toHaveCount(1);
  await page.getByRole('combobox', { name: '筛选课次' }).selectOption('初级:28');
  await page.getByRole('button', { name: '通过発展开关联词', exact: true }).click();
  await expect(page.getByRole('button', { name: '选中词汇発音', exact: true })).toBeVisible();
});

test('does not persist exploration or write learning records and works without external requests', async ({
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
  await page.getByRole('button', { name: '展开汉字発', exact: true }).click();
  expect(await page.getByTestId('word-node').count()).toBeGreaterThan(1);
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  expect(await page.evaluate(() => Object.keys(sessionStorage))).toEqual([]);
  await page.reload();
  await expect(page.getByTestId('word-node')).toHaveCount(1);
  expect(external).toEqual([]);
});

test('shows dictionary credits and labels inflected meanings', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '词库与来源', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('不会保存学习记录');
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
  expect(await page.getByTestId('word-node').count()).toBeGreaterThan(1);
});
