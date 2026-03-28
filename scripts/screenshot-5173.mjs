import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle', timeout: 15000 });
await page.screenshot({ path: 'e2e/screenshot-5173.png', fullPage: true });
await browser.close();
console.log('Screenshot saved to e2e/screenshot-5173.png');
