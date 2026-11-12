import { expect } from '@playwright/test';
import { test } from '../../../utils.js';
test.describe.configure({mode:'parallel',retries:0});
for (const transport of ['srcdoc','data','blank']) {
 test('opaque history survives reload '+transport,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/app/memory?'+new URLSearchParams({transport,simple:'',base:'opaque',sandbox:''}));
  await expect(page.getByTestId('host-status')).toHaveText('ready');
  const el=await page.getByTestId('frame-1').elementHandle();
  const frame=await el.contentFrame();
  await expect(frame.getByTestId('runtime')).toHaveText('browser');
  await expect(frame.locator('body')).toHaveClass('started');
  const initial=await frame.getByTestId('page-url').textContent();
  await frame.getByTestId('native-anchor').click();
  await expect(frame.getByTestId('page-url')).toHaveText(initial+'#anchor');
  const before=await frame.evaluate(()=>performance.timeOrigin);
  await frame.evaluate(()=>location.reload()).catch(()=>{});
  await expect.poll(async()=>frame.evaluate(()=>performance.timeOrigin).catch(()=>before)).not.toBe(before);
  await expect(frame.getByTestId('runtime')).toHaveText('browser');
  await expect(frame.locator('body')).toHaveClass('started');
  await expect(frame.getByTestId('page-url')).toHaveText(initial+'#anchor');
  await frame.evaluate(()=>history.back());
  await expect(frame.getByTestId('page-url')).toHaveText(initial);
  await frame.evaluate(()=>history.forward());
  await expect(frame.getByTestId('page-url')).toHaveText(initial+'#anchor');
  expect(errors).toEqual([]);
 });
}
