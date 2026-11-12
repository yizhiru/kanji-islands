import { expect, test } from '@playwright/test';

test('persists notebook words, promotes candidates and removes saved words', async ({ page }) => {
  await page.goto('/');
  const input = page.getByRole('combobox', { name: '输入起始词' });
  await input.fill('発音');
  await page.getByRole('button', { name: '开始探索', exact: true }).click();
  await page.getByRole('button', { name: '加入生词本', exact: true }).click();
  await expect(page.getByRole('button', { name: '移出生词本', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.reload();
  await page.getByRole('button', { name: '生词本 · 1', exact: true }).click();
  const notebook = page.getByRole('dialog', { name: '生词本', exact: true });
  await expect(notebook.getByRole('button', { name: '探索生词発音' })).toBeVisible();
  await notebook.getByRole('textbox', { name: '搜索生词本' }).fill('不存在的单词');
  await expect(notebook.getByText('没有匹配的生词。')).toBeVisible();
  await notebook.getByRole('textbox', { name: '搜索生词本' }).fill('はつおん');
  await notebook.getByRole('button', { name: '探索生词発音' }).click();
  await expect(page.getByRole('heading', { name: '発音', exact: true })).toBeVisible();
  await input.fill('発表');
  await page.getByRole('button', { name: '开始探索', exact: true }).click();
  await page.getByRole('combobox', { name: '候选单词排序' }).selectOption('notebook');
  await expect(page.locator('.related-list .related-word').first()).toHaveAttribute(
    'aria-label',
    '查看关联词発音',
  );
  await page.getByRole('button', { name: '通过発展开关联词', exact: true }).click();
  await page.getByRole('button', { name: '查看关联词発音', exact: true }).click();
  await expect(page.locator('[data-testid="word-node"][data-word="発音"]')).toBeVisible();
  await page.getByRole('button', { name: '生词本 · 1', exact: true }).click();
  await notebook.getByRole('button', { name: '删除生词発音' }).click();
  await expect(notebook.getByText('生词本还是空的，添加一个单词开始积累吧。')).toBeVisible();
  await notebook.getByRole('button', { name: '关闭生词本' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: '生词本 · 0', exact: true })).toBeVisible();
});

test('exports a backup and imports it without replacing existing words', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const search = page.getByRole('combobox', { name: '输入起始词' });
  await search.fill('発音');
  await page.getByRole('button', { name: '开始探索', exact: true }).click();
  await page.getByRole('button', { name: '加入生词本', exact: true }).click();
  await page.getByRole('button', { name: '生词本 · 1', exact: true }).click();
  const notebook = page.getByRole('dialog', { name: '生词本', exact: true });
  const downloadPromise = page.waitForEvent('download');
  await notebook.getByRole('button', { name: '导出生词', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('kanji-islands-notebook.json');
  const backup = (await download.path())!;
  await notebook.getByRole('button', { name: '删除生词発音', exact: true }).click();
  await notebook.getByRole('button', { name: '关闭生词本', exact: true }).click();
  await search.fill('発表');
  await page.getByRole('button', { name: '开始探索', exact: true }).click();
  await page.getByRole('button', { name: '加入生词本', exact: true }).click();
  await page.getByRole('button', { name: '生词本 · 1', exact: true }).click();

  const chooser = page.waitForEvent('filechooser');
  await notebook.getByRole('button', { name: '导入生词', exact: true }).click();
  await (await chooser).setFiles(backup);
  await expect(notebook.getByRole('status')).toHaveText('已导入 1 个生词。');
  const file = notebook.getByLabel('选择生词备份文件');
  await file.setInputFiles(backup);
  await expect(notebook.getByRole('status')).toHaveText('没有新增生词。');
  await file.setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"format":"kanji-islands-notebook","version":1,"words":["緑化",42]}'),
  });
  await expect(notebook.getByRole('alert')).toContainText('无效生词');
  await expect(notebook.getByRole('heading', { name: '生词本 · 2' })).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: '生词本 · 2', exact: true }).click();
  await expect(notebook.getByRole('button', { name: '探索生词発音' })).toBeVisible();
  await expect(notebook.getByRole('button', { name: '探索生词発表' })).toBeVisible();
});
