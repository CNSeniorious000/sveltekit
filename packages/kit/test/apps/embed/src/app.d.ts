declare global {
	interface Window {
		memory_initial_history_length: number;
	}
	namespace App {
		interface PageState {
			modal?: string;
		}
	}
}

export {};
