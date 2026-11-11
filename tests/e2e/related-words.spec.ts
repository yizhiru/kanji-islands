import { expect, test } from '@playwright/test';

const words = [
  ...Array.from({ length: 25 }, (_, i) => ({
    word: `発${String(i).padStart(2, '0')}`,
    reading: 'はつ',
    pos: 'n',
  })),
  { word: '開く', reading: 'あく', pos: 'vi' },
  { word: '開く', reading: 'ひらく', pos: 'vt' },
  { word: '開ける', reading: 'あける', pos: 'vt' },
  { word: '開発', reading: 'かいはつ', pos: 'n' },
];

test.beforeEach(async ({ page }) => {
  await page.route('**/vocabulary.json', (route) =>
    route.fulfill({
      json: {
        version: 1,
        metadata: { entryCount: words.length },
        entries: words.map(({ word, reading, pos }, i) => ({
          id: `${i}`,
          word,
          reading_hiragana: reading,
          jmdict_id: i,
          meanings_zh: ['释义'],
          meanings_en: ['meaning'],
          sources: [],
          references: '',
          senses: [
            {
              id: `${i}`,
              zh: ['释义'],
              en: ['meaning'],
              pos: [pos],
              labels: [],
              notes_zh: [],
              notes_en: [],
            },
          ],
        })),
      },
    }),
  );
  await page.goto('/');
});

test('sidebar expansion reveals candidates without adding them to the graph', async ({ page }) => {
  await page.getByRole('combobox', { name: '输入起始词' }).fill('発00');
  await page.getByRole('button', { name: '开始探索', exact: true }).click();
  const related = page.locator('.related-list .related-word');
  const nodes = page.getByTestId('word-node');
  await expect(related).toHaveCount(12);
  await page.getByRole('button', { name: '通过発展开关联词', exact: true }).click();
  await expect(related).toHaveCount(20);
  await expect(nodes).toHaveCount(1);
  const expand = page.locator('.expand-more');
  await expand.click();
  await expect(related).toHaveCount(25);
  await expect(expand).toBeDisabled();
  await expect(nodes).toHaveCount(1);
  await related.last().click();
  await expect(nodes).toHaveCount(2);
});

test('shows reading-qualified verb pairs in both directions and opens the counterpart', async ({
  page,
}) => {
  await page.getByRole('combobox', { name: '输入起始词' }).fill('開く');
  await page.getByRole('button', { name: '开始探索', exact: true }).click();
  const pairs = page.locator('.verb-pairs-section');
  await expect(pairs).toContainText('開く（あく）');
  await expect(pairs).not.toContainText('ひらく');
  await pairs.getByRole('button', { name: '查看他动词開ける', exact: true }).click();
  await expect(page.getByRole('heading', { name: '開ける', exact: true })).toBeVisible();
  await expect(pairs.getByRole('button', { name: '查看自动词開く', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: '输入起始词' }).fill('開発');
  await page.getByRole('button', { name: '开始探索', exact: true }).click();
  await expect(pairs).toHaveCount(0);
});
