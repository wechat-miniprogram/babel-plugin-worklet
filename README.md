# babel-plugin-worklet

Compile worklet function in wecht miniprogram.

## Installation

`npm install babel-plugin-worklet --save-dev`

Add plugin to your babel.config.js:

```js
module.exports = {
  presets: [
    ...
  ],
  plugins: [
    ...
    '@babel/plugin-transform-arrow-functions',
    '@babel/plugin-transform-shorthand-properties',
    ['@babel/plugin-proposal-class-properties', { loose: true }],
    'babel-plugin-worklet',
  ],
};
```

