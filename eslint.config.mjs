import nextConfig from "eslint-config-next/core-web-vitals";

const config = [
  {
    ignores: [
      ".next/**",
      ".next-*/**",
      "node_modules/**",
      "dist/**",
      "build/**",
      "out/**",
      "test-results/**",
      "playwright-report/**",
      "playwright/.cache/**",
      "prisma/dev.db",
      "prisma/dev.db-journal",
      "prisma/test.db",
      "prisma/test.db-journal",
      "prisma/keys/**",
    ],
  },
  ...nextConfig,
  {
    rules: {
      "react/no-unescaped-entities": "off",
      "@next/next/no-img-element": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
];

export default config;
