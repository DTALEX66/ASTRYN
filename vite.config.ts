/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const here = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url));

const devProxyPort = process.env.ASTRYN_DEV_PROXY_PORT ?? '8791';
const devHostPort = Number(process.env.ASTRYN_DEV_HOST_PORT ?? '5183');

export default defineConfig({
  root: here('dev-host'),
  publicDir: false,
  appType: 'spa',
  server: {
    host: '127.0.0.1',
    port: devHostPort,
    strictPort: true,
    // 浏览器永不持有模型密钥：只把 /dev-model 转发到 loopback 上的开发代理。
    proxy: {
      '/dev-model': {
        target: `http://127.0.0.1:${devProxyPort}`,
        changeOrigin: false,
        ws: false,
        rewrite: (path: string) => path.replace(/^\/dev-model/, '')
      }
    }
  },
  preview: { host: '127.0.0.1', port: 5184 },
  build: {
    outDir: here('.project-local/artifacts/dev-host-dist'),
    emptyOutDir: true,
    sourcemap: true
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@astryn/contracts': here('contracts/index.ts'),
      '@astryn/core': here('src/index.ts')
    }
  },
  test: {
    // vite 的 root 指向 dev-host；测试必须回到仓库根，否则 tests/** 解析不到。
    root: here('.'),
    environment: 'jsdom',
    globals: false,
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    setupFiles: ['tests/setup.ts'],
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true
  }
});
