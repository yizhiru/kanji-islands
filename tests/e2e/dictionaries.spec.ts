import { expect, test, type Page } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';

const title = '本地测试双解词典';
const words = [
  ['発表', 'はっぴょう'],
  ['発音', 'はつおん'],
  ['発展', 'はってん'],
  ['研究する', 'けんきゅうする'],
  ['土曜日', 'どようび'],
];
const node = (name: string, content: unknown[]) => ({ tag: 'div', data: { class: name }, content });
function glossary(word: string, ja: string, zh: string, types = '名') {
  return [
    {
      type: 'structured-content',
      content: node('mjrhsjcd-entry', [
        node('head', [word, node('type', [types])]),
        node('def1', [
          node('num', ['①']),
          node('def2', [ja, { tag: 'span', lang: 'zh', content: zh }]),
          ...(word === '発表' && ja === '発表の日本語説明。'
            ? [
                node('exam', [
                  '結果を発表する。',
                  { tag: 'span', lang: 'zh', content: '公布结果。' },
                ]),
              ]
            : []),
        ]),
      ]),
    },
  ];
}
const term = (
  word: string,
  reading: string,
  seq: number,
  ja: string,
  zh: string,
  types?: string,
) => [word, reading, '', '', 0, glossary(word, ja, zh, types), seq, ''];
const pack = (rows: unknown[], name = title) =>
  Buffer.from(
    zipSync({
      'index.json': strToU8(
        JSON.stringify({
          title: name,
          revision: 'test-1',
          format: 3,
          sequenced: true,
          sourceLanguage: 'ja',
          targetLanguage: 'zh',
        }),
      ),
      'term_bank_1.json': strToU8(JSON.stringify(rows)),
    }),
  );
const standardPack = () =>
  pack([
    term('発表', 'はっぴょう', 1, '発表の日本語説明。', '导入的中文释义。'),
    term('発表', 'べつよみ', 2, '違う読みの説明。', '错误读音不能出现'),
    term('発音', 'はつおん', 3, '発音の日本語説明。', ''),
    term('発展', 'はってん', 4, '', '仅有中文释义。'),
    term('研究', 'けんきゅう', 5, '研究の日本語説明。', '研究的中文说明。', '名・他サ変'),
    term('土曜日', 'どようび', 6, '', ''),
    term('土曜', 'どよう', 7, '土曜の日本語説明。', '星期六。'),
  ]);
async function settings(page: Page) {
  await page.getByRole('button', { name: '设置', exact: true }).click();
}
async function close(page: Page) {
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
}
async function importPack(page: Page, buffer = standardPack()) {
  await page
    .getByLabel('导入 Yomitan 词典', { exact: true })
    .setInputFiles({ name: 'dictionary.zip', mimeType: 'application/zip', buffer });
}
async function select(page: Page, word: string) {
  await page.getByRole('combobox', { name: '输入起始词' }).fill(word);
  await page.getByRole('button', { name: '开始探索', exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await page.route('**/vocabulary.json', (route) =>
    route.fulfill({
      json: {
        version: 1,
        metadata: { entryCount: words.length, pendingGroups: 0 },
        entries: words.map(([word, reading], i) => ({
          id: `e:${i}`,
          word,
          reading_hiragana: reading,
          jmdict_id: i,
          meanings_zh: [`内置中文${word}`],
          meanings_en: [`builtin English ${word}`],
          references: '初级1',
          sources: [{ level: '初级', lessons: [{ lesson: 1, symbol: '' }], original_word: word }],
          senses: [
            {
              id: `s:${i}`,
              zh: [`内置中文${word}`],
              en: [`builtin English ${word}`],
              pos: ['n'],
              notes_zh: [],
              notes_en: [],
              labels: [],
            },
          ],
        })),
      },
    }),
  );
  await page.goto('/');
});

test('imports locally, uses language priorities in both scopes, persists, disables and deletes', async ({
  page,
}) => {
  const external: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith('http://127.0.0.1:5173') && !r.url().startsWith('blob:'))
      external.push(r.url());
  });
  await settings(page);
  await importPack(page);
  await expect(page.locator('.user-dictionary strong')).toHaveText(title);
  await close(page);
  const meanings = page.locator('.meaning-section');
  await expect(meanings).toContainText('导入的中文释义。');
  await expect(meanings).toContainText('発表の日本語説明。');
  await expect(meanings).toContainText('結果を発表する。');
  await expect(meanings).not.toContainText('公布结果。');
  await expect(meanings).not.toContainText('内置中文発表');
  await expect(meanings).not.toContainText('错误读音不能出现');
  await expect(meanings).toContainText('builtin English 発表');
  await expect(meanings.locator('h4')).toHaveText(['中文释义', '日文释义', '英文释义']);
  await expect(meanings.locator('.definition-source').first()).toContainText(title);
  for (const [language, text] of [
    ['中文释义', '导入的中文释义。'],
    ['日文释义', '発表の日本語説明。'],
    ['英文释义', 'builtin English 発表'],
  ]) {
    const summary = meanings.locator('summary').filter({ hasText: language });
    await summary.click();
    await expect(
      meanings.locator('.imported-block p, .english-gloss').filter({ hasText: text }),
    ).toBeHidden();
    await expect(summary).toBeVisible();
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(
      meanings.locator('.imported-block p, .english-gloss').filter({ hasText: text }),
    ).toBeVisible();
  }

  await page.getByRole('button', { name: '标日', exact: true }).click();
  await expect(meanings).toContainText('导入的中文释义。');
  await select(page, '発音');
  await expect(meanings).toContainText('内置中文発音');
  await expect(meanings).toContainText('発音の日本語説明。');
  await select(page, '発展');
  await expect(meanings).toContainText('仅有中文释义。');
  await expect(meanings.getByRole('heading', { name: '日文释义' })).toHaveCount(0);
  await select(page, '研究する');
  await expect(meanings).toContainText('研究的中文说明。');
  await expect(meanings).toContainText('サ变词「研究」');
  await page.reload();
  await expect(meanings).toContainText('导入的中文释义。');
  await settings(page);
  await page.getByRole('checkbox', { name: `启用词典${title}` }).uncheck();
  await close(page);
  await expect(meanings).toContainText('内置中文発表');
  await expect(meanings).not.toContainText('発表の日本語説明。');
  await settings(page);
  await page.getByRole('checkbox', { name: `启用词典${title}` }).check();
  await close(page);
  await expect(meanings).toContainText('导入的中文释义。');
  await settings(page);
  await page.getByRole('button', { name: `删除词典${title}` }).click();
  await expect(page.locator('.user-dictionary')).toHaveCount(0);
  await close(page);
  await expect(meanings).toContainText('内置中文発表');
  expect(external).toEqual([]);
});

test('rejects broken packages without replacing the saved dictionary and escapes imported content', async ({
  page,
}) => {
  await settings(page);
  await importPack(page);
  await expect(page.locator('.user-dictionary strong')).toHaveText(title);
  await importPack(page, Buffer.from('not a zip'));
  await expect(page.getByRole('status').filter({ hasText: 'ZIP' })).toBeVisible();
  await expect(page.locator('.user-dictionary')).toHaveCount(1);
  await importPack(page);
  await expect(page.getByRole('status').filter({ hasText: '已经导入' })).toBeVisible();
  const hostile = '<img src="https://example.invalid/x" onerror="window.bad=1">';
  await importPack(
    page,
    pack([term('発表', 'はっぴょう', 1, '安全な日本語', hostile)], '自定义测试词典'),
  );
  await expect(page.locator('.user-dictionary')).toHaveCount(2);
  await close(page);
  await expect(page.locator('.meaning-section')).toContainText(hostile);
  await expect(page.locator('.meaning-section img, .meaning-section script')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { bad?: number }).bad)).toBeUndefined();
});

test('describes both scopes and actual definition sources concisely', async ({ page }) => {
  await page.getByRole('button', { name: '词库与来源', exact: true }).click();
  const about = page.getByRole('dialog');
  await expect(about).toContainText('标准词库：');
  await expect(about).toContainText('标日词库：');
  await expect(about).toContainText('词典释义不等于教材原文');
  await expect(about).toContainText('不内置或自动下载明镜');
});

test('offers licensed dictionary sources without a Meikyo download link', async ({ page }) => {
  await settings(page);
  const help = page.locator('.dictionary-help');
  await help.locator('summary').click();
  await expect(help.getByRole('link')).toHaveCount(4);
  await expect(help).toContainText('无需解压或购买 API');
  await expect(help).toContainText('明镜词典需用户自行取得');
  await expect(help.getByRole('link', { name: '维基词典下载' })).toHaveAttribute(
    'href',
    'https://yomidevs.github.io/wiktionary-to-yomitan/download/',
  );
  await expect(help.getByRole('link', { name: 'Jitendex 下载' })).toHaveAttribute(
    'href',
    'https://jitendex.org/pages/downloads.html',
  );
  await expect(help.getByRole('link', { name: /明镜/ })).toHaveCount(0);
});

test('chooses sources per language and follows only unambiguous explicit references', async ({
  page,
}) => {
  const reference = [
    '土曜日',
    'どようび',
    '',
    '',
    0,
    [
      {
        type: 'structured-content',
        content: node('mjrhsjcd-entry', [node('head', ['土曜日']), node('def1', ['⇨土曜'])]),
      },
    ],
    6,
    '',
  ];
  await settings(page);
  await importPack(
    page,
    pack([
      term('発表', 'はっぴょう', 1, '旧日文', '第一本的中文'),
      reference,
      term('土曜', 'どよう', 7, '土曜の意味。', '星期六。'),
    ]),
  );
  await expect(page.locator('.user-dictionary')).toHaveCount(1);
  await importPack(page, pack([term('発表', 'はっぴょう', 1, '第二本的日文', '')], '第二本词典'));
  await expect(page.locator('.user-dictionary')).toHaveCount(2);
  await close(page);
  const meanings = page.locator('.meaning-section');
  await expect(meanings).toContainText('第一本的中文');
  await expect(meanings).toContainText('第二本的日文');
  await expect(meanings.locator('[lang="zh-CN"] .definition-source')).toContainText(title);
  await expect(meanings.locator('.meaning-language[lang="ja"] .definition-source')).toContainText(
    '第二本词典',
  );
  await select(page, '土曜日');
  await expect(meanings).toContainText('参照「土曜」');
  await expect(meanings).toContainText('星期六。');
});
