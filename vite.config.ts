import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

function contentSecurityPolicyPlugin(isDev: boolean): Plugin {
  const content = isDev
    ? [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: file: https:",
        "font-src 'self' data:",
        "connect-src 'self' ws://localhost:3000",
        "object-src 'none'",
        "base-uri 'none'",
        "frame-src 'none'",
        "form-action 'none'",
      ].join('; ')
    : [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: file: https:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "frame-src 'none'",
        "form-action 'none'",
      ].join('; ')

  return {
    name: 'erp-content-security-policy',

    transformIndexHtml: {
      order: 'pre',

      handler() {
        return [
          {
            tag: 'meta',
            attrs: {
              'http-equiv': 'Content-Security-Policy',
              content,
            },
            injectTo: 'head-prepend',
          },
        ]
      },
    },
  }
}

export default defineConfig(({ command }) => ({
  root: path.resolve(__dirname, 'src/renderer'),

  plugins: [react(), contentSecurityPolicyPlugin(command === 'serve')],

  base: './',

  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
  },

  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/renderer'),
    },
  },

  server: {
    port: 3000,
    strictPort: true,
  },
}))
