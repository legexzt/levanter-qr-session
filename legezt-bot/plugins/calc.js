// Calculates mathematical expressions with a custom tokenizer and recursive-descent parser.
// Called by the LEGEZT plugin relay for .calc commands.
// Needs only Node built-ins and the reply function supplied by the relay.
'use strict';


const { logPluginError } = require('../lib/errors.js');
const USAGE = '.calc <expression> — e.g. .calc (12 + 8) * 3 / 2';
const INVALID = 'I could not understand that expression — use numbers, + - * / % ^ ( ) and sqrt/sin/cos/tan/log/abs/min/max.';
const DIVISION_BY_ZERO = 'Division by zero is not allowed.';
const NON_FINITE = 'That does not give a finite number.';
const FUNCTIONS = new Set(['sqrt', 'sin', 'cos', 'tan', 'log', 'abs', 'min', 'max']);

async function respond(reply, message) {
  try {
    await reply(message);
  } catch (_) {
    // The returned text remains available to the relay.
  }
  return message;
}

function isDigit(char) {
  return char >= '0' && char <= '9';
}

function invalidExpression() {
  return new Error('INVALID_EXPRESSION');
}

function tokenize(input) {
  const tokens = [];
  let index = 0;

  function push(token) {
    tokens.push(token);
    if (tokens.length > 100) {
      throw invalidExpression();
    }
  }

  while (index < input.length) {
    const char = input[index];

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (isDigit(char) || (char === '.' && isDigit(input[index + 1]))) {
      const start = index;
      let sawDot = false;

      while (index < input.length) {
        const current = input[index];
        if (isDigit(current)) {
          index += 1;
          continue;
        }
        if (current === '.' && !sawDot) {
          sawDot = true;
          index += 1;
          continue;
        }
        break;
      }

      const raw = input.slice(start, index);
      push({ type: 'number', value: Number(raw) });
      continue;
    }

    if (/[A-Za-z]/.test(char)) {
      const start = index;
      while (index < input.length && /[A-Za-z]/.test(input[index])) {
        index += 1;
      }

      const name = input.slice(start, index).toLowerCase();
      if (!FUNCTIONS.has(name) && name !== 'pi' && name !== 'e') {
        throw invalidExpression();
      }

      push({ type: 'name', value: name });
      continue;
    }

    if ('+-*/%^'.includes(char)) {
      push({ type: 'op', value: char });
      index += 1;
      continue;
    }

    if (char === '(') {
      push({ type: 'lparen' });
      index += 1;
      continue;
    }

    if (char === ')') {
      push({ type: 'rparen' });
      index += 1;
      continue;
    }

    if (char === ',') {
      push({ type: 'comma' });
      index += 1;
      continue;
    }

    throw invalidExpression();
  }

  if (tokens.length === 0) {
    throw invalidExpression();
  }

  return tokens;
}

function parseTokens(tokens) {
  let position = 0;

  function match(type, value) {
    const token = tokens[position];
    if (!token || token.type !== type) {
      return false;
    }
    if (value !== undefined && token.value !== value) {
      return false;
    }
    position += 1;
    return true;
  }

  function expect(type, value) {
    if (!match(type, value)) {
      throw invalidExpression();
    }
  }

  function parseExpression() {
    let value = parseTerm();

    while (true) {
      if (match('op', '+')) {
        value += parseTerm();
      } else if (match('op', '-')) {
        value -= parseTerm();
      } else {
        break;
      }
    }

    return value;
  }

  function parseTerm() {
    let value = parseUnary();

    while (true) {
      const token = tokens[position];
      if (!token || token.type !== 'op' || !['*', '/', '%'].includes(token.value)) {
        break;
      }

      position += 1;
      const right = parseUnary();

      if ((token.value === '/' || token.value === '%') && right === 0) {
        throw new Error('DIVISION_BY_ZERO');
      }

      if (token.value === '*') {
        value *= right;
      } else if (token.value === '/') {
        value /= right;
      } else {
        value %= right;
      }
    }

    return value;
  }

  function parseUnary() {
    if (match('op', '-')) {
      return -parseUnary();
    }
    if (match('op', '+')) {
      return parseUnary();
    }
    return parsePower();
  }

  function parsePower() {
    const base = parsePrimary();
    if (match('op', '^')) {
      return Math.pow(base, parseUnary());
    }
    return base;
  }

  function parsePrimary() {
    const token = tokens[position];

    if (token && token.type === 'number') {
      position += 1;
      return token.value;
    }

    if (token && token.type === 'name') {
      position += 1;
      const name = token.value;

      if (name === 'pi') {
        return Math.PI;
      }
      if (name === 'e') {
        return Math.E;
      }

      expect('lparen');

      if (name === 'min' || name === 'max') {
        const first = parseExpression();
        expect('comma');
        const second = parseExpression();
        expect('rparen');
        return name === 'min' ? Math.min(first, second) : Math.max(first, second);
      }

      const argument = parseExpression();
      expect('rparen');

      switch (name) {
        case 'sqrt':
          return Math.sqrt(argument);
        case 'sin':
          return Math.sin(argument);
        case 'cos':
          return Math.cos(argument);
        case 'tan':
          return Math.tan(argument);
        case 'log':
          return Math.log(argument);
        case 'abs':
          return Math.abs(argument);
        default:
          throw invalidExpression();
      }
    }

    if (match('lparen')) {
      const value = parseExpression();
      expect('rparen');
      return value;
    }

    throw invalidExpression();
  }

  const result = parseExpression();
  if (position !== tokens.length) {
    throw invalidExpression();
  }
  return result;
}

module.exports = {
  name: 'calc',
  command: '.calc',
  description: 'Calculate a mathematical expression safely.',
  async run({ log, sock, message, from, text, args, plugins, reply }) {
    try {
      if (args.length < 1) {
        return respond(reply, USAGE);
      }

      const expression = args.join(' ').trim();
      if (!expression) {
        return respond(reply, USAGE);
      }
      if (expression.length > 200) {
        return respond(reply, INVALID);
      }

      const result = parseTokens(tokenize(expression));
      if (!Number.isFinite(result)) {
        return respond(reply, NON_FINITE);
      }

      const rounded = Number(result.toFixed(6));
      const formatted = rounded === 0 ? '0' : String(rounded);
      return respond(reply, `${expression} = ${formatted}`);
    } catch (error) {
      logPluginError(log, 'calc', error);
      if (error && error.message === 'DIVISION_BY_ZERO') {
        return respond(reply, DIVISION_BY_ZERO);
      }
      return respond(reply, INVALID);
    }
  }
};
