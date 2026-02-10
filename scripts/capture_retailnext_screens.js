const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const outDir = '/Users/timothycllam/Documents/llm_sandbox/openai/codex_assignment/retailnext_outfit_assistant/assets/screenshots';
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  await page.goto('http://127.0.0.1:8010/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(outDir, '01_home.png') });

  await page.fill('#search-input', 'my wife wants a sakura season t shirt');
  await page.click('#search-form button[type="submit"]');
  await page.waitForURL(/\/personalized\?session=/, { timeout: 15000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(outDir, '02_personalized_text_search.png') });

  await page.click('.match-button');
  await page.waitForSelector('.match-result', { timeout: 15000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(outDir, '03_check_match.png') });

  await page.click('#camera-button');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outDir, '04_upload_modal.png') });

  const sampleImage = '/Users/timothycllam/Documents/llm_sandbox/openai/codex_assignment/retailnext_outfit_assistant/data/sample_clothes/sample_images/47120.jpg';
  await page.setInputFiles('#image-input', sampleImage);
  await page.click('#upload-form button[type="submit"]');
  await page.waitForTimeout(2200);
  await page.waitForSelector('.product-card', { timeout: 15000 });
  await page.screenshot({ path: path.join(outDir, '05_image_match_results.png') });

  await browser.close();
})();
