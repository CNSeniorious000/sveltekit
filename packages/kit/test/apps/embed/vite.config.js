import * as path from 'node:path';
import process from 'node:process';
import { sveltekit } from '@sveltejs/kit/vite';

/** @type {import('vite').UserConfig} */
const config = {
	build: {
		minify: false
	},
	clearScreen: false,
	plugins: [
		sveltekit({
			// Keep the original fixture embedded, but exercise inline hydration without
			// relying on embedded mode's existing route/params handling.
			embedded: process.env.MEMORY_ROUTING !== 'true',
			...(process.env.MEMORY_ROUTING === 'true' && {
				output: { bundleStrategy: 'inline' },
				paths: { base: '/app' },
				files: { appTemplate: 'src/memory.html' }
			})
		})
	],
	server: {
		fs: {
			allow: [path.resolve('../../../src')]
		}
	}
};

export default config;
