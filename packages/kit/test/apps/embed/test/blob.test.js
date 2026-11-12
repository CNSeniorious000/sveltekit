import { expect } from '@playwright/test';
import { test, variant } from '../../../utils.js';
test.skip(variant !== 'memory', 'requires inline output');
test.describe.configure({ mode: 'parallel' });
async function mount(page, extra={}) {
 await page.goto('/app/memory?'+new URLSearchParams({transport:'blob',...extra}));
 await expect(page.getByTestId('host-status')).toHaveText('ready');
 const element=await page.getByTestId('frame-1').elementHandle();
 await expect.poll(async()=>!!(await element.contentFrame())).toBe(true);
 const frame=await element.contentFrame();
 await expect(frame.getByTestId('runtime')).toHaveText('browser');
 await expect(frame.locator('body')).toHaveClass('started');
 expect(await frame.evaluate(()=>location.protocol)).toBe('blob:');
 return frame;
}
async function route(frame,slug){
 await expect(frame.getByTestId('load-slug')).toHaveText(slug);
 await expect(frame.getByTestId('route-id')).toHaveText('/memory/route/[slug]');
 await expect(frame.getByTestId('load-route')).toHaveText('/memory/route/[slug]');
 await expect(frame.getByTestId('server-slug')).toHaveText(slug);
}
for(const sandbox of [false,true]) {
 const extra=sandbox?{sandbox:''}:{};
 test('blob reload and navigation '+sandbox,async({page})=>{
  const frame=await mount(page,{...extra,cache:'miss'});
  await route(frame,'alpha');
  expect(JSON.parse(await frame.getByTestId('fetched').textContent())).toMatchObject({source:'network'});
  if(sandbox) expect(await frame.evaluate(()=>{try{void parent.document;return false}catch{return true}})).toBe(true);
  await frame.getByTestId('counter').click();
  await expect(frame.getByTestId('counter')).toHaveText('Count: 1');
  await frame.getByTestId('goto').click();
  await route(frame,'next');
  const native=await frame.evaluate(()=>location.href);
  const logical=await frame.getByTestId('page-url').textContent();
  await frame.getByTestId('reload').click();
  await expect(frame.getByTestId('runtime')).toHaveText('browser');
  await expect(frame.locator('body')).toHaveClass('started');
  await route(frame,'next');
  await expect(frame.getByTestId('counter')).toHaveText('Count: 0');
  await expect(frame.getByTestId('page-url')).toHaveText(logical);
  expect(await frame.evaluate(()=>location.href)).toBe(native);
  await frame.evaluate(()=>history.back());
  await route(frame,'alpha');
  await frame.evaluate(()=>history.forward());
  await route(frame,'next');
 });
 test('blob relative link and fetch '+sandbox,async({page})=>{
  const frame=await mount(page,{...extra,cache:'miss'});
  await route(frame,'alpha');
  await frame.getByTestId('relative-link').click();
  await route(frame,'relative');
  expect(JSON.parse(await frame.getByTestId('fetched').textContent())).toMatchObject({source:'network'});
 });
 test('blob state and fragment reload '+sandbox,async({page})=>{
  const frame=await mount(page,extra);
  const initial=await frame.getByTestId('page-url').textContent();
  await frame.getByTestId('anchor-link').click();
  await expect(frame.getByTestId('page-url')).toHaveText(initial+'#anchor');
  const metadata=await frame.evaluate(()=>history.state['sveltekit:metadata']);
  await frame.evaluate(()=>location.reload());
  await expect(frame.getByTestId('runtime')).toHaveText('browser');
  await expect(frame.locator('body')).toHaveClass('started');
  await expect(frame.getByTestId('page-url')).toHaveText(initial+'#anchor');
  const after=await frame.evaluate(()=>history.state['sveltekit:metadata']);
  expect(after.url).toBe(metadata.url);
  await route(frame,'alpha');
 });
 test('blob self-contained no HTTP base '+sandbox,async({page})=>{
  const frame=await mount(page,{...extra,simple:'',base:'opaque'});
  await expect(frame.getByTestId('route-id')).toHaveText('/memory/simple/[slug]');
  await frame.getByTestId('counter').click();
  await frame.getByTestId('refresh').click();
  await expect(frame.getByTestId('load-count')).toHaveText('2');
  await expect(frame.getByTestId('counter')).toHaveText('Count: 1');
  await frame.evaluate(()=>location.reload());
  await expect(frame.getByTestId('runtime')).toHaveText('browser');
  await expect(frame.locator('body')).toHaveClass('started');
  await expect(frame.getByTestId('counter')).toHaveText('Count: 0');
 });
 test('blob CSP blocked base stays blocked '+sandbox,async({page})=>{
  const frame=await mount(page,{...extra,simple:'',csp:'base-none'});
  expect(await frame.evaluate(()=>document.baseURI)).toMatch(/^blob:/);
  expect(await frame.evaluate(()=>{try{new URL('../x',document.baseURI);return false}catch{return true}})).toBe(true);
  await frame.getByTestId('refresh').click();
  await expect(frame.getByTestId('load-count')).toHaveText('2');
 });
}
