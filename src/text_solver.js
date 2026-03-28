'use strict';

/**
 * text_solver.js — Solve hCaptcha text/accessibility challenges.
 *
 * These are simple text-based math/logic puzzles served when the user
 * clicks "Accessibility Challenge" in the hCaptcha widget menu.
 *
 * Known question types:
 *   - "Replace only the first occurrence of X with Y in NUMBER"
 *   - "What is X + Y?"
 *   - "What is X - Y?"
 *   - "What is X * Y?"
 *   - "Reverse the string: XXXXX"
 *   - "How many times does X appear in NUMBER?"
 *   - "What is the sum of all digits in NUMBER?"
 *   - "Remove all occurrences of X from NUMBER"
 */

function solveTextChallenge(questionText) {
  const q = questionText.trim();

  // "Replace/Change only/just the first/second/third/last occurrence of X with/to Y ... in NUMBER"
  let m = q.match(/(?:replace|change)\s+(?:only\s+)?(?:just\s+)?the\s+(first|second|third|fourth|fifth|last)\s+occurrence\s+of\s+(\d)\s+(?:with|to)\s+(\d).*?in\s+(\d+)/i);
  if (m) {
    const [, ordinal, find, replace, number] = m;
    const positions = [];
    for (let i = 0; i < number.length; i++) {
      if (number[i] === find) positions.push(i);
    }
    if (positions.length === 0) return number;
    
    const ordinalMap = { first: 0, second: 1, third: 2, fourth: 3, fifth: 4, last: -1 };
    let targetIdx;
    if (ordinal.toLowerCase() === 'last') {
      targetIdx = positions[positions.length - 1];
    } else {
      const posIdx = ordinalMap[ordinal.toLowerCase()] || 0;
      if (posIdx >= positions.length) return number;
      targetIdx = positions[posIdx];
    }
    
    return number.slice(0, targetIdx) + replace + number.slice(targetIdx + 1);
  }

  // "Replace all occurrences of X with Y in NUMBER"
  m = q.match(/replace\s+all\s+occurrences?\s+of\s+(\d)\s+with\s+(\d).*?in\s+(\d+)/i);
  if (m) {
    return m[3].replaceAll(m[1], m[2]);
  }

  // "Remove all occurrences of X from NUMBER" or "Remove every X from NUMBER"
  m = q.match(/remove\s+(?:all\s+occurrences?\s+of|every)\s+(\d)\s+from\s+(\d+)/i);
  if (m) {
    return m[2].replaceAll(m[1], '');
  }

  // "What is X + Y" / "X plus Y"
  m = q.match(/what\s+is\s+(\d+)\s*[\+plus]\s*(\d+)/i) || q.match(/(\d+)\s*\+\s*(\d+)/);
  if (m) {
    return String(parseInt(m[1]) + parseInt(m[2]));
  }

  // "What is X - Y" / "X minus Y"
  m = q.match(/what\s+is\s+(\d+)\s*[\-minus]\s*(\d+)/i) || q.match(/(\d+)\s*\-\s*(\d+)/);
  if (m) {
    return String(parseInt(m[1]) - parseInt(m[2]));
  }

  // "What is X * Y" / "X times Y" / "X multiplied by Y"
  m = q.match(/what\s+is\s+(\d+)\s*[\*×times]\s*(\d+)/i) || q.match(/(\d+)\s*[\*×]\s*(\d+)/);
  if (m) {
    return String(parseInt(m[1]) * parseInt(m[2]));
  }

  // "Reverse the string/number: XXXXX"
  m = q.match(/reverse\s+(?:the\s+)?(?:string|number|digits?)(?:\s*:\s*|\s+)(\d+)/i);
  if (m) {
    return m[1].split('').reverse().join('');
  }

  // "How many times does X appear in NUMBER"
  m = q.match(/how\s+many\s+times\s+does\s+(\d)\s+appear\s+in\s+(\d+)/i);
  if (m) {
    return String((m[2].match(new RegExp(m[1], 'g')) || []).length);
  }

  // "What is the sum of all digits in NUMBER"
  m = q.match(/sum\s+of\s+(?:all\s+)?digits\s+in\s+(\d+)/i);
  if (m) {
    return String(m[1].split('').reduce((a, b) => a + parseInt(b), 0));
  }

  // "What is the largest/smallest digit in NUMBER"
  m = q.match(/(largest|smallest|biggest|greatest)\s+digit\s+in\s+(\d+)/i);
  if (m) {
    const digits = m[2].split('').map(Number);
    return String(m[1].match(/small/i) ? Math.min(...digits) : Math.max(...digits));
  }

  // "How many digits are in NUMBER"
  m = q.match(/how\s+many\s+digits\s+(?:are\s+)?in\s+(\d+)/i);
  if (m) {
    return String(m[1].length);
  }

  // "Replace the last occurrence of X with Y in NUMBER"
  m = q.match(/replace\s+(?:only\s+)?the\s+last\s+occurrence\s+of\s+(\d)\s+with\s+(\d).*?in\s+(\d+)/i);
  if (m) {
    const [, find, replace, number] = m;
    const idx = number.lastIndexOf(find);
    if (idx === -1) return number;
    return number.slice(0, idx) + replace + number.slice(idx + 1);
  }

  // "Sort the digits in NUMBER in ascending/descending order"
  m = q.match(/sort\s+(?:the\s+)?digits\s+in\s+(\d+)\s+in\s+(ascending|descending)/i);
  if (m) {
    const digits = m[1].split('').map(Number);
    digits.sort((a, b) => m[2].match(/asc/i) ? a - b : b - a);
    return digits.join('');
  }

  // Generic "first occurrence of X to/with Y in NUMBER" (loose match)
  m = q.match(/first\s+occurrence\s+of\s+(\d)\s+(?:with|to)\s+(\d).*?(\d{4,})/i);
  if (m) {
    const idx = m[3].indexOf(m[1]);
    if (idx >= 0) return m[3].slice(0, idx) + m[2] + m[3].slice(idx + 1);
    return m[3];
  }

  // Generic "last occurrence of X to/with Y in NUMBER" (loose match)
  m = q.match(/last\s+occurrence\s+of\s+(\d)\s+(?:with|to)\s+(\d).*?(\d{4,})/i);
  if (m) {
    const idx = m[3].lastIndexOf(m[1]);
    if (idx >= 0) return m[3].slice(0, idx) + m[2] + m[3].slice(idx + 1);
    return m[3];
  }

  // Generic arithmetic: just evaluate any "X op Y" pattern
  m = q.match(/(\d+)\s*([\+\-\*\/])\s*(\d+)/);
  if (m) {
    const a = parseInt(m[1]), b = parseInt(m[3]);
    switch (m[2]) {
      case '+': return String(a + b);
      case '-': return String(a - b);
      case '*': return String(a * b);
      case '/': return String(Math.floor(a / b));
    }
  }

  return null;
}

module.exports = { solveTextChallenge };
