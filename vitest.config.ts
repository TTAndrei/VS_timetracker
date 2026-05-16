import { defineConfig } from 'vitest/config';
import * as path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      vscode: path.resolve(__dirname, 'test/vscode-stub.ts'),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
  },
});
