module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    project: "./tsconfig.json",
    tsconfigRootDir: __dirname,
  },
  env: { node: true, es2022: true },
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  plugins: ["@typescript-eslint"],
  rules: {
    "@typescript-eslint/no-unused-vars": [
      "warn",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
    ],
    "@typescript-eslint/no-floating-promises": "error",
    "@typescript-eslint/no-misused-promises": [
      "error",
      {
        checksConditionals: true,
        checksVoidReturn: {
          arguments: false,
          attributes: false,
          returns: true,
        },
      },
    ],
    "no-console": ["warn", { allow: ["warn", "error"] }],
    "@typescript-eslint/consistent-type-imports": [
      "warn",
      { prefer: "type-imports", disallowTypeAnnotations: false },
    ],
    "@typescript-eslint/no-namespace": [
      "error",
      { allowDeclarations: true, allowDefinitionFiles: true },
    ],
    "@typescript-eslint/require-await": "warn",
    "@typescript-eslint/no-empty-function": "off",
  },
  ignorePatterns: [
    "dist",
    "node_modules",
    "prisma/generated",
    "prisma/migrations",
  ],
};
