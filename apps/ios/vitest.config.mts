import { defineConfig } from 'vitest/config';

// Expo's tsconfig base is not exported from the package, so Vite cannot resolve the extends in tsconfig.json. The
// tests need nothing from it: they run plain TypeScript with no JSX.
export default defineConfig({
  oxc: { tsconfig: false },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
