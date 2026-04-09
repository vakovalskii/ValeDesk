import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import tsconfigPaths from 'vite-tsconfig-paths';

// Stub Tauri-native plugins that only resolve inside Tauri WebView runtime.
// Without this, Vite dev server fails on import analysis for dynamic imports.
const tauriPluginStub = (): import('vite').Plugin => ({
	name: 'tauri-plugin-stub',
	resolveId(id) {
		if (id === 'tauri-plugin-locale-api' || id === '@razein97/tauri-plugin-i18n') {
			return `\0${id}`;
		}
	},
	load(id) {
		if (id === '\0tauri-plugin-locale-api') {
			return 'export function getLocale() { return navigator.language; }';
		}
		if (id === '\0@razein97/tauri-plugin-i18n') {
			return 'export default { setLocale() {} };';
		}
	},
});

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), '');
	const port = parseInt(env.PORT); // MUST BE LOWERCASE

	return {
		plugins: [tauriPluginStub(), react(), tailwindcss(), tsconfigPaths()],
		base: './',
		build: {
			outDir: 'dist-react',
			rollupOptions: {
				external: ['tauri-plugin-locale-api', '@razein97/tauri-plugin-i18n'],
			},
		},
		server: {
			port, // MUST BE LOWERCASE
			strictPort: true,
			hmr: { overlay: false },
		},
	};
});
