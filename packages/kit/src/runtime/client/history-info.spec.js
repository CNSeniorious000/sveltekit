import fs from 'node:fs';
import vm from 'node:vm';
import { join } from 'node:path';
import { expect, test } from 'vitest';

const source = fs.readFileSync(join(import.meta.dirname, 'client.js'), 'utf8');
const helper = source.match(/function capture_scroll\(index\) \{[^]*?\n\}/)?.[0];
if (!helper) throw new Error('Missing capture_scroll helper');

test('captures scroll for an entry missing after reload without session storage', () => {
	const history_info = {};
	const scroll = { x: 12, y: 34 };
	const capture = vm.runInNewContext(`${helper}\ncapture_scroll`, {
		history_info,
		scroll_state: () => scroll
	});

	capture(42);
	expect(history_info).toEqual({ 42: { scroll } });
});

test('preserves existing history metadata when capturing scroll', () => {
	const entry = { resetIndex: 7, scroll: { x: 0, y: 0 } };
	const history_info = { 42: entry };
	const scroll = { x: 12, y: 34 };
	const capture = vm.runInNewContext(`${helper}\ncapture_scroll`, {
		history_info,
		scroll_state: () => scroll
	});

	capture(42);
	expect(history_info[42]).toBe(entry);
	expect(entry).toEqual({ resetIndex: 7, scroll });
});
