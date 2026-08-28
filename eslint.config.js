import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // `dist` is Vite's web build; `android/app/src/main/assets/public` is the same
  // build COPIED into the native project by `cap sync` — both are minified output,
  // never source, so linting them just floods the report with parser-level errors.
  globalIgnores(['dist', 'android/app/src/main/assets/public', 'ios/App/App/public']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
      // eslint-plugin-react-hooks v7's recommended set auto-enabled the React
      // Compiler diagnostics. This project does NOT use the React Compiler (no
      // babel-plugin-react-compiler), so these advisory rules flag intentional,
      // working patterns (ref reads during render, derived-state effects, etc.)
      // in load-bearing realtime/fight code. Turn them off; KEEP the two classic,
      // always-valuable hooks rules on (rules-of-hooks + exhaustive-deps). Drop
      // these overrides if/when the React Compiler is adopted.
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      // Fast Refresh nicety (dev HMR only, not a correctness rule). A few files
      // deliberately co-export a helper/constant with their component; keep it a
      // hint, not a hard error.
      'react-refresh/only-export-components': 'warn',
    },
  },
  {
    // Vercel serverless functions (api/*) run in Node, not the browser — give
    // them Node globals (process, Buffer, …) so no-undef doesn't fire.
    files: ['api/**/*.js'],
    languageOptions: { globals: { ...globals.node } },
  },
])
