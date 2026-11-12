import { client_origin } from '../../utils/client-origin.js';

export function get_origin() {
	return client_origin ?? window.location.origin;
}

export * from './shared.js';
