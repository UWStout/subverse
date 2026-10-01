import neostandard from 'neostandard'

export default [
  ...neostandard({
    env: ['node'],
    noStyle: false,
    ignores: ['node_modules/**', 'public/**']
  }),
  {
    rules: {
      // Built-in base rules (converted to warnings)
      'one-var': 'warn',
      'no-cond-assign': 'warn',
      'dot-location': 'warn',
      'accessor-pairs': 'warn',
      'no-array-constructor': 'warn',
      'no-fallthrough': 'warn',
      'no-unused-vars': 'warn',
      camelcase: 'warn',
      eqeqeq: 'warn',
      curly: 'warn',
      yoda: 'warn',

      // Enabling stylistic rules and converting to warnings
      '@stylistic/block-spacing': 'warn',
      '@stylistic/brace-style': 'warn',
      '@stylistic/comma-dangle': ['warn', 'never'],
      '@stylistic/comma-spacing': 'warn',
      '@stylistic/comma-style': 'warn',
      '@stylistic/eol-last': 'warn',
      '@stylistic/func-call-spacing': 'warn',
      '@stylistic/indent': ['warn', 2],
      '@stylistic/key-spacing': 'warn',
      '@stylistic/keyword-spacing': 'warn',
      '@stylistic/no-extra-parens': 'warn',
      '@stylistic/no-floating-decimal': 'warn',
      '@stylistic/no-mixed-spaces-and-tabs': 'warn',
      '@stylistic/no-multi-spaces': 'warn',
      '@stylistic/no-multiple-empty-lines': 'warn',
      '@stylistic/no-tabs': 'warn',
      '@stylistic/no-trailing-spaces': 'warn',
      '@stylistic/object-curly-newline': 'warn',
      '@stylistic/object-property-newline': 'warn',
      '@stylistic/operator-linebreak': 'warn',
      '@stylistic/padded-blocks': 'warn',
      '@stylistic/quote-props': 'warn',
      '@stylistic/quotes': 'warn',
      '@stylistic/semi': ['warn', 'never'],
      '@stylistic/semi-spacing': 'warn',
      '@stylistic/space-before-blocks': 'warn',
      '@stylistic/space-before-function-paren': 'warn',
      '@stylistic/space-in-parens': 'warn',
      '@stylistic/space-infix-ops': 'warn',
      '@stylistic/space-unary-ops': 'warn',
      '@stylistic/spaced-comment': 'warn',
      '@stylistic/template-curly-spacing': 'warn'
    }
  }
]
