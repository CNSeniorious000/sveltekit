import * as path from 'node:path';
import process from 'node:process';
import { sveltekit } from '@sveltejs/kit/vite';
import { inline_host } from './inline-host.js';

const inline = process.env.HASH_INLINE === 'true';

/** @type {import('vite').UserConfig} */
const config = {
	build: {
		minify: false
	},
	clearScreen: false,
	plugins: [
		sveltekit({
			router: { type: 'hash' },
			...(inline && {
				outDir: '.svelte-kit/inline',
				paths: { base: '/app' },
				output: { bundleStrategy: 'inline' },
				adapter: {
					name: 'inline-hash-fixture',
					async adapt(builder) {
						await builder.generateFallback('.svelte-kit/inline/shell.html');
					}
				}
			})
		}),
		inline && inline_host()
	],
	server: {
		fs: {
			allow: [path.resolve('../../../src')]
		}
	},
	optimizeDeps: {
		exclude: ['svelte']
	}
};

export default config;
