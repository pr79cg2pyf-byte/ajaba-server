import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['src/__tests__/credits-workflow.test.ts'], testTimeout: 10000 } });
