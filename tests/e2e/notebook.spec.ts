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

test('practices saved words without autoplay, reveals answers and undoes the final removal', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    Object.defineProperty(window, 'speechSynthesis', {
      value: {
        getVoices: () => [{ lang: 'ja-JP', localService: true }],
        cancel() {},
        addEventListener() {},
        removeEventListener() {},
        speak(utterance: SpeechSynthesisUtterance) {
          document.documentElement.dataset.spoken = utterance.text;
        },
      },
    });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      value: class {
        constructor(public text: string) {}
      },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '加入生词本', exact: true }).click();
  await page.getByRole('button', { name: '生词本 · 1' }).click();
  await page.getByRole('button', { name: '开始练习' }).click();
  const practice = page.getByRole('dialog', { name: '生词练习', exact: true });
  await expect(practice).toBeVisible();
  expect(await practice.boundingBox()).toMatchObject({ x: 0, y: 0, width: 390, height: 844 });
  await expect(page.locator('html')).not.toHaveAttribute('data-spoken');
  await expect(practice.getByText('はっぴょう')).toHaveCount(0);
  await practice.getByRole('button', { name: '朗读発表' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-spoken', 'はっぴょう');
  await expect(practice.getByText('はっぴょう')).toHaveCount(0);
  await practice.getByRole('button', { name: '显示假名' }).click();
  await expect(practice.getByText('はっぴょう')).toBeVisible();
  await practice.getByRole('button', { name: '显示释义' }).click();
  await expect(practice.locator('.practice-meaning')).toContainText(/.+/);
  await practice.getByRole('button', { name: '移出生词本' }).click();
  await expect(practice.getByRole('heading', { name: '本轮练习完成' })).toBeVisible();
  await practice.getByRole('button', { name: '撤回移除' }).click();
  await expect(practice.getByRole('button', { name: '朗读発表' })).toBeVisible();
  await expect(practice.getByText('はっぴょう')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(practice).toHaveCount(0);
  await expect(page.getByRole('button', { name: '探索生词発表' })).toBeVisible();
  await page.getByRole('button', { name: '关闭生词本' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: '将発表移出生词本' })).toBeVisible();
});

test('removes and restores a bookmarked island without changing the current selection', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '加入生词本', exact: true }).click();
  await page.getByRole('button', { name: '展开汉字発', exact: true }).click();
  await page.getByRole('button', { name: '选中词汇発電', exact: true }).click();
  const marker = page.getByRole('button', { name: '将発表移出生词本' });
  await marker.click();
  await expect(marker).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '発電', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '撤回', exact: true }).click();
  await expect(marker).toBeVisible();
  await page.getByRole('button', { name: '生词本 · 1' }).click();
  await expect(page.getByRole('button', { name: '探索生词発表' })).toBeVisible();
});

test('keeps both bookmarks across concurrent edits, open tabs and a next-day reload', async ({
  page,
  context,
}) => {
  await page.clock.setFixedTime(new Date('2026-11-22T22:00:00+08:00'));
  await page.goto('/');
  const other = await context.newPage();
  await other.goto('/');
  await other.getByRole('combobox', { name: '输入起始词' }).fill('学校');
  await other.getByRole('button', { name: '开始探索', exact: true }).click();
  await expect(other.getByRole('heading', { name: '学校', exact: true })).toBeVisible();
  await Promise.all(
    [page, other].map((tab) =>
      tab.getByRole('button', { name: '加入生词本', exact: true }).click(),
    ),
  );
  for (const tab of [page, other]) {
    await expect(tab.getByRole('button', { name: '生词本 · 2' })).toBeVisible();
  }
  await other.getByRole('button', { name: '生词本 · 2' }).click();
  const list = other.getByRole('dialog', { name: '生词本', exact: true });
  await list.getByRole('button', { name: '删除生词発表' }).click();
  const marker = page.getByRole('button', { name: '将発表移出生词本' });
  await expect(marker).toHaveCount(0);
  await page.getByRole('button', { name: '加入生词本', exact: true }).click();
  await expect(list.getByRole('button', { name: '探索生词発表' })).toBeVisible();

  await other.close();
  await page.clock.setFixedTime(new Date('2026-11-23T09:00:00+08:00'));
  await page.reload();
  await page.getByRole('button', { name: '生词本 · 2' }).click();
  const reopened = page.getByRole('dialog', { name: '生词本', exact: true });
  await expect(reopened.getByRole('button', { name: '探索生词学校' })).toBeVisible();
  await reopened.getByRole('button', { name: '探索生词発表' }).click();
  await expect(marker).toBeVisible();
});
