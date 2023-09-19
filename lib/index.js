'use strict'
const template = require('@babel/template').default
const generate = require('@babel/generator').default
const hash = require('string-hash-64')
const { transformSync } = require('@babel/core')
const traverse = require('@babel/traverse').default
const parse = require('@babel/parser').parse
const nodePath = require('path')

const buildBindFunc = func =>
  template.ast(`
  var _${func}_ = this.${func}.bind(this);
`)

const buildWorkletFunc = func =>
  template.ast(`
  var ${func} = this._${func}_worklet_factory_();
`)

const globals = new Set([
  'this',
  'console',
  '_setGlobalConsole',
  'Date',
  'Array',
  'ArrayBuffer',
  'Int8Array',
  'Int16Array',
  'Int32Array',
  'Uint8Array',
  'Uint8ClampedArray',
  'Uint16Array',
  'Uint32Array',
  'Float32Array',
  'Float64Array',
  'Date',
  'HermesInternal',
  'JSON',
  'Math',
  'Number',
  'Object',
  'String',
  'Symbol',
  'undefined',
  'null',
  'UIManager',
  'requestAnimationFrame',
  '_WORKLET',
  'arguments',
  'Boolean',
  'parseInt',
  'parseFloat',
  'Map',
  'Set',
  '_log',
  '_updateProps',
  'RegExp',
  'Error',
  'global',
  '_measure',
  '_scrollTo',
  '_setGestureState',
  '_getCurrentTime',
  '_eventTimestamp',
  '_frameTimestamp',
  'isNaN',
  'LayoutAnimationRepository',
  '_stopObservingProgress',
  '_startObservingProgress',
  // For skyline
  'setTimeout',
  'globalThis',
  'workletUIModule',
])

// leaving way to avoid deep capturing by adding 'stopCapturing' to the blacklist
const blacklistedFunctions = new Set([
  'stopCapturing',
  'toString',
  'map',
  'filter',
  'forEach',
  'valueOf',
  'toPrecision',
  'toExponential',
  'constructor',
  'toFixed',
  'toLocaleString',
  'toSource',
  'charAt',
  'charCodeAt',
  'concat',
  'indexOf',
  'lastIndexOf',
  'localeCompare',
  'length',
  'match',
  'replace',
  'search',
  'slice',
  'split',
  'substr',
  'substring',
  'toLocaleLowerCase',
  'toLocaleUpperCase',
  'toLowerCase',
  'toUpperCase',
  'every',
  'join',
  'pop',
  'push',
  'reduce',
  'reduceRight',
  'reverse',
  'shift',
  'slice',
  'some',
  'sort',
  'splice',
  'unshift',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'bind',
  'apply',
  'call',
  '__callAsync',
  'includes',
])

const possibleOptFunction = new Set(['interpolate'])

class ClosureGenerator {
  constructor() {
    this.trie = [{}, false]
  }

  mergeAns(oldAns, newAns) {
    const [purePath, node] = oldAns
    const [purePathUp, nodeUp] = newAns
    if (purePathUp.length !== 0) {
      return [purePath.concat(purePathUp), nodeUp]
    } else {
      return [purePath, node]
    }
  }

  findPrefixRec(path) {
    const notFound = [[], null]
    if (!path || path.node.type !== 'MemberExpression') {
      return notFound
    }
    const memberExpressionNode = path.node
    if (memberExpressionNode.property.type !== 'Identifier') {
      return notFound
    }
    if (
      memberExpressionNode.computed ||
      memberExpressionNode.property.name === 'value' ||
      blacklistedFunctions.has(memberExpressionNode.property.name)
    ) {
      // a.b[w] -> a.b.w in babel nodes
      // a.v.value
      // sth.map(() => )
      return notFound
    }
    if (path.parent && path.parent.type === 'AssignmentExpression' && path.parent.left === path.node) {
      /// captured.newProp = 5;
      return notFound
    }
    const purePath = [memberExpressionNode.property.name]
    const node = memberExpressionNode
    const upAns = this.findPrefixRec(path.parentPath)
    return this.mergeAns([purePath, node], upAns)
  }

  findPrefix(base, babelPath) {
    const purePath = [base]
    const node = babelPath.node
    const upAns = this.findPrefixRec(babelPath.parentPath)
    return this.mergeAns([purePath, node], upAns)
  }

  addPath(base, babelPath) {
    const [purePath, node] = this.findPrefix(base, babelPath)
    let parent = this.trie
    let index = -1
    for (const current of purePath) {
      index++
      if (parent[1]) {
        continue
      }
      if (!parent[0][current]) {
        parent[0][current] = [{}, false]
      }
      if (index === purePath.length - 1) {
        parent[0][current] = [node, true]
      }
      parent = parent[0][current]
    }
  }

  generateNodeForBase(t, current, parent) {
    const currentNode = parent[0][current]
    if (currentNode[1]) {
      return currentNode[0]
    }
    return t.objectExpression(
      Object.keys(currentNode[0]).map(propertyName =>
        t.objectProperty(
          t.identifier(propertyName),
          this.generateNodeForBase(t, propertyName, currentNode),
          false,
          true,
        ),
      ),
    )
  }

  generate(t, variables, names) {
    const arrayOfKeys = [...names]
    return t.objectExpression(
      variables.map((variable, index) =>
        t.objectProperty(
          t.identifier(variable.name),
          this.generateNodeForBase(t, arrayOfKeys[index], this.trie),
          false,
          true,
        ),
      ),
    )
  }
}

function buildWorkletString(t, fun, closureVariables, name) {
  function prependClosureVariablesIfNecessary(closureVariables, body) {
    if (closureVariables.length === 0) {
      return body
    }

    return t.blockStatement([
      t.variableDeclaration('const', [
        t.variableDeclarator(
          t.objectPattern(
            closureVariables.map(variable =>
              t.objectProperty(t.identifier(variable.name), t.identifier(variable.name), false, true),
            ),
          ),
          t.memberExpression(t.identifier('jsThis'), t.identifier('_closure')),
        ),
      ]),
      body,
    ])
  }

  traverse(fun, {
    enter(path) {
      t.removeComments(path.node)
    },
  })

  const workletFunction = t.functionExpression(
    t.identifier(name),
    fun.program.body[0].expression.params,
    prependClosureVariablesIfNecessary(closureVariables, fun.program.body[0].expression.body),
  )

  return generate(workletFunction, { compact: true }).code
}

function generateWorkletFactory(t, fun) {
  const map = new Map()
  fun.traverse({
    CallExpression: {
      enter(path) {
        if (!t.isMemberExpression(path.node.callee)) return
        const routes = []
        let iter = path.node.callee
        // find out invoke path
        while (t.isMemberExpression(iter)) {
          const route = iter.property.name
          routes.unshift(route)
          iter = iter.object
        }
        // start with this
        if (!t.isThisExpression(iter)) return
        // output: [this, bar]
        // console.log('routes: ', ['this', ...routes])
        let funcName = routes[routes.length - 1]
        // function in JS thread, like this.func.bind(this)
        if (funcName === 'bind') {
          funcName = routes[routes.length - 2]
          map.set(funcName, 'bind')
          path.replaceWith(t.identifier(`_${funcName}_`))
          return
        }
        // function in UI thread, like this.func()
        path.get('callee').replaceWith(t.identifier(funcName))
        map.set(funcName, 'worklet')
      },
    },
  })
  const statements = []
  map.forEach((value, key) => {
    const statement = value === 'bind' ? buildBindFunc(key) : buildWorkletFunc(key)
    statements.push(statement)
  })
  const funExpression = t.arrowFunctionExpression(fun.node.params, fun.node.body)
  const functionId = t.identifier('f')
  const factoryFun = t.functionExpression(
    null,
    [],
    t.blockStatement([
      ...statements,
      t.variableDeclaration('var', [t.variableDeclarator(functionId, funExpression)]),
      t.returnStatement(functionId),
    ]),
  )
  return factoryFun
}

// remove worklet directive
function removeWorkletDirective(fun) {
  let result
  const copy = parse('\n(' + fun.toString() + '\n)')
  traverse(copy, {
    DirectiveLiteral(path) {
      if (path.node.value === 'worklet') {
        path.parentPath.remove()
      }
    },
    Program: {
      exit(path) {
        result = path.get('body.0.expression').node
      },
    },
  })
  return result
}

function makeWorkletName(t, fun) {
  if (t.isObjectMethod(fun)) {
    return fun.node.key.name
  }
  if (t.isFunctionDeclaration(fun)) {
    return fun.node.id.name
  }
  if (t.isFunctionExpression(fun) && t.isIdentifier(fun.node.id)) {
    return fun.node.id.name
  }
  return '_f' // fallback for ArrowFunctionExpression and unnamed FunctionExpression
}

function makeWorklet(t, fun, fileName) {
  // Returns a new FunctionExpression which is a workletized version of provided
  // FunctionDeclaration, FunctionExpression, ArrowFunctionExpression or ObjectMethod.

  const functionName = makeWorkletName(t, fun)

  const closure = new Map()
  const outputs = new Set()
  const closureGenerator = new ClosureGenerator()
  const options = {}

  // remove 'worklet'; directive before calling .toString()
  fun.traverse({
    DirectiveLiteral(path) {
      if (path.node.value === 'worklet' && path.getFunctionParent() === fun) {
        path.parentPath.remove()
      }
    },
  })

  // We use copy because some of the plugins don't update bindings and
  // some even break them

  const code = '\n(' + (t.isObjectMethod(fun) ? 'function ' : '') + fun.toString() + '\n)'

  const transformed = transformSync(code, {
    filename: fileName,
    presets: ['@babel/preset-typescript'],
    plugins: [
      '@babel/plugin-transform-shorthand-properties',
      '@babel/plugin-transform-arrow-functions',
      '@babel/plugin-proposal-optional-chaining',
      '@babel/plugin-proposal-nullish-coalescing-operator',
      ['@babel/plugin-transform-template-literals', { loose: true }],
    ],
    ast: true,
    babelrc: false,
    configFile: false,
  })
  if (fun.parent && fun.parent.callee && fun.parent.callee.name === 'createAnimatedStyle') {
    options.optFlags = isPossibleOptimization(transformed.ast)
  }
  traverse(transformed.ast, {
    ReferencedIdentifier(path) {
      const name = path.node.name
      if (globals.has(name) || (fun.node.id && fun.node.id.name === name)) {
        return
      }

      const parentNode = path.parent

      if (parentNode.type === 'MemberExpression' && parentNode.property === path.node && !parentNode.computed) {
        return
      }

      if (
        parentNode.type === 'ObjectProperty' &&
        path.parentPath.parent.type === 'ObjectExpression' &&
        path.node !== parentNode.value
      ) {
        return
      }

      let currentScope = path.scope

      while (currentScope != null) {
        if (currentScope.bindings[name] != null) {
          return
        }
        currentScope = currentScope.parent
      }
      closure.set(name, path.node)
      closureGenerator.addPath(name, path)
    },
    AssignmentExpression(path) {
      // test for <something>.value = <something> expressions
      const left = path.node.left
      if (
        t.isMemberExpression(left) &&
        t.isIdentifier(left.object) &&
        t.isIdentifier(left.property, { name: 'value' })
      ) {
        outputs.add(left.object.name)
      }
    },
  })

  const variables = Array.from(closure.values())

  const privateFunctionId = t.identifier('_f')
  const clone = t.cloneNode(fun.node)
  let funExpression
  if (clone.body.type === 'BlockStatement') {
    funExpression = t.functionExpression(null, clone.params, clone.body)
  } else {
    funExpression = clone
  }
  const funString = buildWorkletString(t, transformed.ast, variables, functionName)
  const workletHash = hash(funString)

  const loc = fun && fun.node && fun.node.loc && fun.node.loc.start
  if (loc) {
    const { line, column } = loc
    if (typeof line === 'number' && typeof column === 'number') {
      fileName = `${fileName} (${line}:${column})`
    }
  }

  const statements = [
    t.variableDeclaration('const', [t.variableDeclarator(privateFunctionId, funExpression)]),
    t.expressionStatement(
      t.assignmentExpression(
        '=',
        t.memberExpression(privateFunctionId, t.identifier('_closure'), false),
        closureGenerator.generate(t, variables, closure.keys()),
      ),
    ),
    t.expressionStatement(
      t.assignmentExpression(
        '=',
        t.memberExpression(privateFunctionId, t.identifier('asString'), false),
        t.stringLiteral(funString),
      ),
    ),
    t.expressionStatement(
      t.assignmentExpression(
        '=',
        t.memberExpression(privateFunctionId, t.identifier('__workletHash'), false),
        t.numericLiteral(workletHash),
      ),
    ),
    t.expressionStatement(
      t.assignmentExpression(
        '=',
        t.memberExpression(privateFunctionId, t.identifier('__location'), false),
        t.stringLiteral(fileName),
      ),
    ),
    t.expressionStatement(
      t.assignmentExpression(
        '=',
        t.memberExpression(privateFunctionId, t.identifier('__worklet'), false),
        t.booleanLiteral(true),
      ),
    ),
  ]

  statements.push(t.returnStatement(privateFunctionId))

  const newFun = t.functionExpression(fun.id, [], t.blockStatement(statements))

  return newFun
}

function processWorkletFunction(t, fun, fileName) {
  // Replaces FunctionDeclaration, FunctionExpression or ArrowFunctionExpression
  // with a workletized version of itself.

  if (!t.isFunctionParent(fun)) {
    return
  }

  // "var option = { methods: { func() {'worklet';} } } in Component"
  // or "var option = { func() {'worklet;'} } in Page"

  // if (fun.parentPath.isObjectProperty()) {
  //   const parentNodePath = fun.parentPath.parentPath;
  //   if (
  //     parentNodePath.isObjectExpression() &&
  //     parentNodePath.parentPath.isObjectProperty()
  //   ) {
  //     const parentPropName = parentNodePath.parent.key.name;
  //     if (parentPropName == "methods") {}
  //   }
  // }

  if (fun.parentPath.isObjectProperty()) {
    const name = fun.parent.key.name
    const copyNode = removeWorkletDirective(fun)
    const factoryFun = generateWorkletFactory(t, fun)
    const factoryFunName = `_${name}_worklet_factory_`
    fun.parentPath.replaceWithMultiple([
      t.objectProperty(t.identifier(name), copyNode, false, false),
      t.objectProperty(t.identifier(factoryFunName), factoryFun, false, false),
    ])
    return
  }

  const newFun = makeWorklet(t, fun, fileName)

  const replacement = t.callExpression(newFun, [])

  // we check if function needs to be assigned to variable declaration.
  // This is needed if function definition directly in a scope. Some other ways
  // where function definition can be used is for example with variable declaration:
  // const ggg = function foo() { }
  // ^ in such a case we don't need to define variable for the function
  const needDeclaration = t.isScopable(fun.parent) || t.isExportNamedDeclaration(fun.parent)
  fun.replaceWith(
    fun.node.id && needDeclaration
      ? t.variableDeclaration('const', [t.variableDeclarator(fun.node.id, replacement)])
      : replacement,
  )
}

function processIfWorkletNode(t, fun, fileName) {
  fun.traverse({
    DirectiveLiteral(path) {
      const value = path.node.value
      if (value === 'worklet' && path.getFunctionParent() === fun) {
        // make sure "worklet" is listed among directives for the fun
        // this is necessary as because of some bug, babel will attempt to
        // process replaced function if it is nested inside another function
        const directives = fun.node.body.directives
        if (
          directives &&
          directives.length > 0 &&
          directives.some(directive => t.isDirectiveLiteral(directive.value) && directive.value.value === 'worklet')
        ) {
          processWorkletFunction(t, fun, fileName)
        }
      }
    },
  })
}

const FUNCTIONLESS_FLAG = 0b00000001
const STATEMENTLESS_FLAG = 0b00000010

function isPossibleOptimization(fun) {
  let isFunctionCall = false
  let isStatement = false
  traverse(fun, {
    CallExpression(path) {
      if (!possibleOptFunction.has(path.node.callee.name)) {
        isFunctionCall = true
      }
    },
    IfStatement() {
      isStatement = true
    },
  })
  let flags = 0
  if (!isFunctionCall) {
    flags = flags | FUNCTIONLESS_FLAG
  }
  if (!isStatement) {
    flags = flags | STATEMENTLESS_FLAG
  }
  return flags
}

module.exports = function ({ types: t }) {
  return {
    pre() {
      // allows adding custom globals such as host-functions
      if (this.opts != null && Array.isArray(this.opts.globals)) {
        this.opts.globals.forEach(name => {
          globals.add(name)
        })
      }
    },
    visitor: {
      'FunctionDeclaration|FunctionExpression|ArrowFunctionExpression': {
        enter(path, state) {
          let fileName = state.file.opts.filename
          fileName = nodePath.relative(__dirname, fileName)
          processIfWorkletNode(t, path, fileName)
        },
      },
    },
  }
}
