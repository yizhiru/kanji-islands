import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdir } from 'node:fs/promises';
const server = await createServer({ server: { port: 5174 } });
await server.listen();
let browser;
try {
  browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 1,
  });
  await page.goto('http://127.0.0.1:5174/');
  await page.getByTestId('word-node').waitFor();
  await mkdir('output/app', { recursive: true });
  await page.screenshot({ path: 'output/app/start.png', fullPage: true });
  await page.getByLabel('课次符号说明', { exact: true }).hover();
  await page.screenshot({ path: 'output/app/lesson-symbols.png', fullPage: true });
  await page.getByRole('heading', { name: '词汇成岛，汉字相连。' }).hover();
  await page.getByRole('button', { name: '展开汉字発', exact: true }).click();
  await page.getByRole('button', { name: '选中词汇発音', exact: true }).click();
  await page.getByRole('button', { name: '展开汉字音', exact: true }).click();
  await page.getByRole('button', { name: '适应全部节点', exact: true }).click();
  await page.locator('.toast.visible').waitFor({ state: 'hidden' });
  await page.screenshot({ path: 'output/app/network.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '适应全部节点', exact: true }).click();
  await page.screenshot({ path: 'output/app/mobile.png', fullPage: true });
  console.log('Screenshots saved to output/app/');
} finally {
  await browser?.close();
  await server.close();
}
