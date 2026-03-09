import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), '');
	const port = parseInt(env.PORT); // MUST BE LOWERCASE

	return {
		plugins: [react(), tailwindcss(), tsconfigPaths()],
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
		},
	};
});
