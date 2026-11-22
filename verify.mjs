import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const origin = process.env.BASE_URL || 'http://127.0.0.1:5173';
const expected = Number(process.env.EXPECT_UNHANDLED ?? '1');
assert([0, 1].includes(expected), 'EXPECT_UNHANDLED must be 0 or 1');

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(15_000);
  const errors = [];
  let dataRequests = 0;
  page.on('pageerror', (error) => errors.push(error));
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/b/__data.json') dataRequests += 1;
  });
  await page.addInitScript(() => {
    window.rejections = [];
    // Observe the real events without preventing the browser from reporting errors.
    addEventListener('unhandledrejection', (event) => {
      window.rejections.push({
        promise: event.promise,
        message: event.reason?.message,
        path: location.pathname,
        handled: false
      });
    });
    addEventListener('rejectionhandled', (event) => {
      const original = window.rejections.find((entry) => entry.promise === event.promise);
      if (original) original.handled = true;
    });
  });

  await page.goto(origin);
  await page.getByText('Hover the link before clicking it.', { exact: true }).waitFor();
  const link = page.getByRole('link', { name: 'Page B', exact: true });
  const dataResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/b/__data.json'
  );
  await link.hover();
  const response = await dataResponse;
  assert.equal(response.status(), 200);
  assert.equal(await response.finished(), null);
  // Give rejection reporting a browser turn after the complete data stream.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  );

  assert.equal(new URL(page.url()).pathname, '/');
  assert.equal(await page.getByRole('heading').textContent(), 'Page A');
  assert.equal(errors.length, expected, 'pageerror count while still on A');
  assert.deepEqual(
    await page.evaluate(() => window.rejections.map(({ message, path }) => ({ message, path }))),
    expected ? [{ message: 'Streamed failure', path: '/' }] : []
  );

  await link.click();
  const alert = page.getByRole('alert');
  await alert.waitFor();
  assert.equal(await alert.textContent(), 'Streamed failure');
  assert.equal(new URL(page.url()).pathname, '/b');
  assert.equal(dataRequests, 1, 'navigation must reuse the preloaded data');
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  );
  assert.equal(errors.length, expected, 'no additional pageerrors after navigation');
  assert.deepEqual(
    await page.evaluate(() => window.rejections.map(({ handled }) => handled)),
    expected ? [true] : [],
    'the page must later handle the original rejected promise'
  );
  console.log(JSON.stringify({ unhandled: errors.length, dataRequests, errorVisible: true }));
} finally {
  await browser.close();
}
