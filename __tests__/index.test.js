'use strict'

const babel = require('@babel/core')
const plugin = require('../lib/index')

function transform(code, filename = 'test.js') {
  const result = babel.transformSync(code, {
    filename,
    plugins: [plugin],
    babelrc: false,
    configFile: false,
  })
  return result.code
}

function transformWithOptions(code, options, filename = 'test.js') {
  const result = babel.transformSync(code, {
    filename,
    plugins: [[plugin, options]],
    babelrc: false,
    configFile: false,
  })
  return result.code
}

describe('babel-plugin-worklet', () => {
  describe('basic worklet function transformation', () => {
    test('should transform function declaration with worklet directive', () => {
      const input = `function myWorklet() {
  'worklet';
  return 42;
}`
      expect(transform(input)).toMatchSnapshot()
    })

    test('should transform arrow function with worklet directive', () => {
      const input = `const myWorklet = () => {
  'worklet';
  return 42;
};`
      expect(transform(input)).toMatchSnapshot()
    })

    test('should transform function expression with worklet directive', () => {
      const input = `const myWorklet = function() {
  'worklet';
  return 42;
};`
      expect(transform(input)).toMatchSnapshot()
    })

    test('should transform named function expression with worklet directive', () => {
      const input = `const myWorklet = function namedFunc() {
  'worklet';
  return 42;
};`
      expect(transform(input)).toMatchSnapshot()
    })
  })

  describe('closure variable capture', () => {
    test('should capture single external variable', () => {
      const input = `const x = 10;
function myWorklet() {
  'worklet';
  return x + 1;
}`
      expect(transform(input)).toMatchSnapshot()
    })

    test('should capture multiple external variables', () => {
      const input = `const a = 1;
const b = 2;
function myWorklet() {
  'worklet';
  return a + b;
}`
      expect(transform(input)).toMatchSnapshot()
    })

    test('should not capture global variables', () => {
      const input = `function myWorklet() {
  'worklet';
  console.log(Math.PI);
  return Date.now();
}`
      expect(transform(input)).toMatchSnapshot()
    })

    test('should not capture function parameters', () => {
      const input = `function myWorklet(x, y) {
  'worklet';
  return x + y;
}`
      expect(transform(input)).toMatchSnapshot()
    })

    test('should capture object property access', () => {
      const input = `const obj = { value: 10 };
function myWorklet() {
  'worklet';
  return obj.value;
}`
      expect(transform(input)).toMatchSnapshot()
    })
  })

  describe('object property worklet', () => {
    test('should generate factory for function expression in object property', () => {
      const input = `const obj = {
  myMethod: function() {
    'worklet';
    return 42;
  }
};`
      expect(transform(input)).toMatchSnapshot()
    })

    test('should generate factory for arrow function in object property', () => {
      const input = `const obj = {
  myMethod: () => {
    'worklet';
    return 42;
  }
};`
      expect(transform(input)).toMatchSnapshot()
    })

    test('should generate factory for object method', () => {
      const input = `const obj = {
  myMethod() {
    'worklet';
    return 42;
  }
};`
      expect(transform(input)).toMatchSnapshot()
    })
  })

  describe('should not transform functions without worklet directive', () => {
    test('normal function declaration should remain unchanged', () => {
      const input = `function normalFunc() {
  return 42;
}`
      expect(transform(input)).toMatchSnapshot()
    })

    test('normal arrow function should remain unchanged', () => {
      const input = `const normalFunc = () => {
  return 42;
};`
      expect(transform(input)).toMatchSnapshot()
    })

    test('normal function expression should remain unchanged', () => {
      const input = `const normalFunc = function() {
  return 42;
};`
      expect(transform(input)).toMatchSnapshot()
    })
  })

  describe('custom globals', () => {
    test('should capture external variable when not configured as global', () => {
      const input = `function myWorklet() {
  'worklet';
  return customGlobal + 1;
}`
      expect(transform(input)).toMatchSnapshot()
    })

    test('should not capture variable when configured as global', () => {
      const input = `function myWorklet() {
  'worklet';
  return customGlobal + 1;
}`
      expect(transformWithOptions(input, { globals: ['customGlobal'] })).toMatchSnapshot()
    })
  })

  describe('nested functions', () => {
    test('should handle worklet with inner function', () => {
      const input = `function outer() {
  'worklet';
  function inner() {
    return 1;
  }
  return inner();
}`
      expect(transform(input)).toMatchSnapshot()
    })
  })

  describe('complex scenarios', () => {
    test('should handle multiple worklet functions', () => {
      const input = `function worklet1() {
  'worklet';
  return 1;
}
function worklet2() {
  'worklet';
  return 2;
}`
      expect(transform(input)).toMatchSnapshot()
    })

    test('should handle .value assignment', () => {
      const input = `const sharedValue = { value: 0 };
function myWorklet() {
  'worklet';
  sharedValue.value = 100;
}`
      expect(transform(input)).toMatchSnapshot()
    })

    test('should handle function with default parameters', () => {
      const input = `function myWorklet(x = 10) {
  'worklet';
  return x * 2;
}`
      expect(transform(input)).toMatchSnapshot()
    })

    test('should handle function with rest parameters', () => {
      const input = `function myWorklet(...args) {
  'worklet';
  return args.length;
}`
      expect(transform(input)).toMatchSnapshot()
    })
  })

  describe('special syntax support', () => {
    test('should support optional chaining', () => {
      const input = `const obj = { a: 1 };
function myWorklet() {
  'worklet';
  return obj?.a;
}`
      expect(transform(input)).toMatchSnapshot()
    })

    test('should support nullish coalescing', () => {
      const input = `const val = null;
function myWorklet() {
  'worklet';
  return val ?? 'default';
}`
      expect(transform(input)).toMatchSnapshot()
    })

    test('should support template literals', () => {
      const input = `const name = 'world';
function myWorklet() {
  'worklet';
  return \`hello \${name}\`;
}`
      expect(transform(input)).toMatchSnapshot()
    })

    test('should support destructuring parameters', () => {
      const input = `function myWorklet({ a, b }) {
  'worklet';
  return a + b;
}`
      expect(transform(input)).toMatchSnapshot()
    })

    test('should support array destructuring parameters', () => {
      const input = `function myWorklet([a, b]) {
  'worklet';
  return a + b;
}`
      expect(transform(input)).toMatchSnapshot()
    })
  })
})
