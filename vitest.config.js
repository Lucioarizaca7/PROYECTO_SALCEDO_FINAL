import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '.git/',
        '.vscode/',
        '__pycache__/',
        '*.config.js',
        'vitest.config.js',
        '**/*.config.*',
        'dll/',
        'docs/',
        'examples/'
      ]
    }
  }
})