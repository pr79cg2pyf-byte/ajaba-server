import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { globals: true, include: ['src/__tests__/*-workflow.test.ts', 'src/__tests__/expiry-records.test.ts'], testTimeout: 15000, hookTimeout: 15000, fileParallelism: false } });
