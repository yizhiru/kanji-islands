import { expect, test } from '@playwright/test';

test('practices the live notebook from the library and syncs removal and undo', async ({
  page,
}) => {
  await page.goto('/');
  const open = page.getByRole('button', { name: '词本练习', exact: true });
  const library = page.getByRole('dialog', { name: '词本练习', exact: true });
  const choose = library.getByLabel('选择词本');
  const start = library.getByRole('button', { name: '开始练习' });
  await open.click();
  await choose.selectOption({ label: '我的生词本 · 0 条' });
  await expect(library.getByText(/还没有生词/)).toBeVisible();
  await expect(start).toBeDisabled();
  await expect(library.getByRole('button', { name: '删除此词本' })).toHaveCount(0);
  await library.getByRole('button', { name: '关闭词本练习' }).click();
  await page.getByRole('button', { name: '加入生词本', exact: true }).click();
  await expect(page.getByRole('button', { name: '生词本 · 1', exact: true })).toBeVisible();
  await page.reload();
  await open.click();
  await expect(choose.locator('option:checked')).toHaveText('我的生词本 · 1 条');
  await start.click();
  const practice = page.getByRole('dialog', { name: '我的生词本', exact: true });
  await expect(practice.getByRole('button', { name: '朗读発表' })).toBeVisible();
  const remove = practice.getByRole('button', { name: '移出生词本' });
  await remove.click();
  await expect(practice.getByText('生词本中还有 0 个词。')).toBeVisible();
  await practice.getByRole('button', { name: '撤回移除' }).click();
  await expect(practice.getByRole('button', { name: '朗读発表' })).toBeVisible();
  await remove.click();
  await practice.getByRole('button', { name: '返回词本选择' }).click();
  await expect(choose.locator('option:checked')).toHaveText('我的生词本 · 0 条');
  await expect(start).toBeDisabled();
  await choose.selectOption('shikken-n2');
  await expect(start).toBeEnabled();
  await library.getByRole('button', { name: '关闭词本练习' }).click();
  await page.reload();
  await page.getByRole('button', { name: '生词本 · 0', exact: true }).click();
  await expect(page.getByText(/生词本还是空的/)).toBeVisible();
});

test('practices Shikken in groups, remembers the group and includes the final 19 cards', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: '词本练习', exact: true }).click();
  const library = page.getByRole('dialog', { name: '词本练习', exact: true });
  await expect(library.getByRole('option', { name: /N2 核心词汇.*1,?739/ })).toHaveCount(1);
  const groups = library.getByLabel('练习分组');
  await expect(groups.locator('option')).toHaveCount(87);
  await groups.selectOption('85');
  await library.screenshot({ path: testInfo.outputPath('library.png') });
  await library.getByRole('button', { name: '开始练习' }).click();
  const practice = page.getByRole('dialog', { name: 'N2 核心词汇', exact: true });
  await expect(practice.getByText('第 86 组 · 1 / 20')).toBeVisible();
  const helpButton = practice.getByRole('button', { name: '快捷键', exact: true });
  await helpButton.click();
  const help = page.getByRole('dialog', { name: '练习快捷键', exact: true });
  await expect(help.locator('kbd')).toHaveText(['A', 'S', 'D', 'F', 'G', 'Esc']);
  await page.keyboard.press('f');
  await page.keyboard.press('Escape');
  await expect(help).not.toBeVisible();
  await expect(helpButton).toBeFocused();
  await expect(practice.getByText('第 86 组 · 1 / 20')).toBeVisible();
  await page.keyboard.press('g');
  await expect(help).toBeVisible();
  await help.screenshot({ path: testInfo.outputPath('shortcut-guide.png') });
  await page.keyboard.press('g');
  await expect(help).not.toBeVisible();
  await page.keyboard.press('a');
  await expect(practice.locator('.practice-kana')).toBeVisible();
  await expect(practice.locator('.practice-kana')).not.toHaveText('暂无假名');
  await page.keyboard.press('s');
  await expect(practice.locator('.practice-meaning')).toBeVisible();
  await expect(practice.locator('.practice-meaning')).not.toHaveText('暂无释义');
  await page.keyboard.press('Control+f');
  await expect(practice.getByText('第 86 组 · 1 / 20')).toBeVisible();
  await page.keyboard.down('f');
  await page.keyboard.down('f');
  await page.keyboard.up('f');
  await expect(practice.getByText('第 86 组 · 2 / 20')).toBeVisible();
  await expect(practice.locator('.practice-kana, .practice-meaning')).toHaveCount(0);
  await practice.screenshot({ path: testInfo.outputPath('practice-shortcuts.png') });
  for (let i = 2; i < 20; i++) await practice.getByRole('button', { name: '下一个' }).click();
  await page.keyboard.press('f');
  await expect(practice.getByText('本轮练习完成')).toBeVisible();
  await page.keyboard.press('f');
  await expect(practice.getByText('第 87 组 · 1 / 19')).toBeVisible();
  const card = practice.getByRole('button', { name: /^朗读/ });
  const label = await card.getAttribute('aria-label');
  const remove = practice.getByRole('button', { name: '从本词本移除' });
  await remove.click();
  await practice.getByRole('button', { name: '撤回移除' }).click();
  await expect(card).toHaveAttribute('aria-label', label!);
  await remove.click();
  await expect(practice.getByRole('button', { name: '撤回移除' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '词本练习', exact: true }).click();
  await expect(groups).toHaveValue('86');
  await expect(groups.locator('option:checked')).toContainText('剩余 18 条');
  await library.getByRole('button', { name: '开始练习' }).click();
  for (let i = 1; i <= 18; i++) {
    await expect(card).not.toHaveAttribute('aria-label', label!);
    await practice.getByRole('button', { name: i < 18 ? '下一个' : '完成练习' }).click();
  }
  await expect(practice.getByText('本组还有 18 个词条可复习。')).toBeVisible();
});

test('upgrades existing CSV books, keeps removals in their original group and isolates them by book', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('kanji-islands-practice-books', 1);
        open.onupgradeneeded = () => open.result.createObjectStore('books', { keyPath: 'id' });
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('books', 'readwrite');
          const shared = { word: '紅葉', reading: 'こうよう' };
          tx.objectStore('books').add({
            id: 'legacy-a',
            name: '词本甲',
            cards: [
              { word: '紅葉', reading: 'もみじ' },
              ...Array.from({ length: 19 }, (_, i) => ({ word: `練習${i}` })),
              shared,
            ],
          });
          tx.objectStore('books').add({ id: 'legacy-b', name: '词本乙', cards: [shared] });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onabort = () => reject(tx.error);
        };
      }),
  );
  const open = page.getByRole('button', { name: '词本练习', exact: true });
  const library = page.getByRole('dialog', { name: '词本练习', exact: true });
  const choose = library.getByLabel('选择词本');
  const group = library.getByLabel('练习分组');
  const start = library.getByRole('button', { name: '开始练习' });
  await open.click();
  await choose.selectOption('legacy-a');
  await group.selectOption('1');
  await start.click();
  const a = page.getByRole('dialog', { name: '词本甲', exact: true });
  await a.getByRole('button', { name: '从本词本移除' }).click();
  await a.getByRole('button', { name: '返回词本选择' }).click();
  await page.reload();
  await open.click();
  await choose.selectOption({ label: '词本甲 · 20 条' });
  await expect(group.locator('option:checked')).toContainText('剩余 0 条');
  await expect(start).toBeDisabled();
  await group.selectOption('0');
  await start.click();
  await expect(a.getByText('第 1 组 · 1 / 20')).toBeVisible();
  await a.getByRole('button', { name: '退出练习' }).click();
  await choose.selectOption({ label: '词本乙 · 1 条' });
  await start.click();
  const b = page.getByRole('dialog', { name: '词本乙', exact: true });
  await expect(b.getByRole('button', { name: '朗读紅葉' })).toBeVisible();
  await b.getByRole('button', { name: '从本词本移除' }).click();
  await b.getByRole('button', { name: '撤回移除' }).click();
  await expect(b.getByRole('button', { name: '朗读紅葉' })).toBeVisible();
  await b.getByRole('button', { name: '从本词本移除' }).click();
  await b.getByRole('button', { name: '返回词本选择' }).click();
  await expect(start).toBeDisabled();
  await library.getByRole('button', { name: '恢复全部 1 条词汇' }).click();
  await expect(choose.locator('option:checked')).toHaveText('词本乙 · 1 条');
  await expect(choose.locator('option[value="legacy-a"]')).toHaveText('词本甲 · 20 条');
  await expect(start).toBeEnabled();
});

test('imports an independent book, practices offline words and deletes only the selected book', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const open = page.getByRole('button', { name: '词本练习', exact: true });
  await open.click();
  const library = page.getByRole('dialog', { name: '词本练习', exact: true });
  const file = library.getByLabel('选择练习词本文件');
  const choose = library.getByLabel('选择词本');
  const download = page.waitForEvent('download');
  await library.getByRole('link', { name: '下载示例' }).click();
  expect((await download).suggestedFilename()).toBe('练习词本示例.csv');
  await expect(choose).toBeEnabled();
  await file.setInputFiles({
    name: '错误.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('word,reading\n春,はる\n,あき'),
  });
  await expect(library.getByRole('alert')).toContainText('第 2 条词汇缺少单词');
  await expect(choose.locator('option')).toHaveCount(2);
  const csv = {
    name: '我的听写.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('\uFEFFword,reading,meaning\r\n漢字島ノート,かんじじまのーと,"练习, 示例"'),
  };
  await file.setInputFiles(csv);
  await expect(choose.locator('option:checked')).toHaveText('我的听写 · 1 条');
  await library.screenshot({ path: testInfo.outputPath('import-mobile.png') });
  await library.getByRole('button', { name: '开始练习' }).click();
  const practice = page.getByRole('dialog', { name: '我的听写', exact: true });
  await expect(practice.getByRole('button', { name: '朗读漢字島ノート' })).toBeVisible();
  await expect(practice.getByText('かんじじまのーと')).toHaveCount(0);
  await practice.getByRole('button', { name: '显示假名' }).click();
  await expect(practice.getByText('かんじじまのーと')).toBeVisible();
  await practice.getByRole('button', { name: '显示释义' }).click();
  await expect(practice.getByText('练习, 示例')).toBeVisible();
  await practice.getByRole('button', { name: '完成练习' }).click();
  await practice.getByRole('button', { name: '返回词本选择' }).click();
  await page.reload();
  await open.click();
  await choose.selectOption({ label: '我的听写 · 1 条' });
  await file.setInputFiles(csv);
  await expect(choose.locator('option:checked')).toHaveText('我的听写（2） · 1 条');
  await library.getByRole('button', { name: '删除此词本' }).click();
  await library.getByRole('button', { name: '确认删除' }).click();
  await expect(choose.locator('option')).toHaveCount(3);
  await expect(choose.getByRole('option', { name: '我的听写 · 1 条' })).toHaveCount(1);
  await library.getByRole('button', { name: '关闭词本练习' }).click();
  await expect(page.getByRole('button', { name: '生词本 · 0' })).toBeVisible();
});
