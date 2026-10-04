import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import eslintConfigPrettier from 'eslint-config-prettier';

export default [
  js.configs.recommended,
  eslintConfigPrettier, // 👈 هذا السطر يمنع ESLint من إظهار أي تحذيرات تخص المسافات أو التنسيق
  {
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules, // 👈 ينبهك لو نسيت الـ Dependency Array في useEffect
      'react-refresh/only-export-components': 'warn',
      'no-unused-vars': 'warn', // 👈 ينبهك لو عملت متغير ونسيته (تحذير وليس خطأ أحمر)
      'no-console': 'off', // 👈 يسمح لك بكتابة console.log بدون إزعاج
    },
  },
];
