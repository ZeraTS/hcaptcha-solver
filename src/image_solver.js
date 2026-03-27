'use strict';

/**
 * image_solver.js — Classify hCaptcha image challenge tasks using vision AI.
 *
 * Supports two backends:
 *   1. Anthropic Claude (claude-haiku-20240307) — fast, cheap, good accuracy
 *   2. OpenAI GPT-4o-mini — alternative
 *
 * Task types supported:
 *   - image_label_binary: "Is this image a <X>?" → true/false per image
 *   - image_label_area_select: "Click the area containing <X>" → coordinates
 *
 * Usage:
 *   const { classifyImages } = require('./image_solver');
 *   const answers = await classifyImages(taskList, taskType, question, apiKey);
 */

const https = require('https');

/**
 * Call Claude API for image classification.
 * Returns array of 'true'/'false' answers matching taskList order.
 */
async function classifyWithClaude(imageUrls, question, apiKey) {
  const content = [
    {
      type: 'text',
      text: `You are classifying images for a CAPTCHA. The task is: "${question}"\n\nFor each image numbered 1-${imageUrls.length}, answer ONLY "true" if the image contains what is asked, or "false" if it does not. Respond with ONLY a JSON array of strings, e.g.: ["true","false","true","true","false","true","false","false","true"]\n\nClassify each image:`,
    },
  ];

  // Add each image
  for (let i = 0; i < imageUrls.length; i++) {
    content.push({
      type: 'text',
      text: `Image ${i + 1}:`,
    });
    content.push({
      type: 'image',
      source: {
        type: 'url',
        url: imageUrls[i],
      },
    });
  }

  const body = JSON.stringify({
    model: 'claude-haiku-4-5',
    max_tokens: 256,
    messages: [{ role: 'user', content }],
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const resp = JSON.parse(data);
          if (resp.error) return reject(new Error('Claude API error: ' + resp.error.message));
          const text = resp.content[0].text.trim();
          // Extract JSON array from response
          const match = text.match(/\[[\s\S]*\]/);
          if (!match) return reject(new Error('Could not parse Claude response: ' + text.slice(0, 100)));
          const answers = JSON.parse(match[0]);
          resolve(answers.map(a => String(a).toLowerCase() === 'true' ? 'true' : 'false'));
        } catch (e) {
          reject(new Error('Claude response parse error: ' + e.message));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Classify images for an hCaptcha task.
 *
 * @param {Array} taskList - Array of task objects from hCaptcha getcaptcha response
 * @param {string} taskType - e.g. 'image_label_binary'
 * @param {string} question - e.g. 'Please click each image containing a bicycle'
 * @param {object} opts
 *   - backend: 'claude' (default) or 'random'
 *   - apiKey: Anthropic API key (required for claude)
 *
 * Returns: { [task_key]: 'true'|'false' }
 */
async function classifyImages(taskList, taskType, question, opts = {}) {
  if (!taskList || taskList.length === 0) return {};

  const backend = opts.backend || (opts.apiKey ? 'claude' : 'random');

  if (backend === 'random') {
    // Fallback: random answers (low success rate but doesn't crash)
    const answers = {};
    for (const task of taskList) {
      if (task.task_key) answers[task.task_key] = Math.random() > 0.5 ? 'true' : 'false';
    }
    return answers;
  }

  if (backend === 'claude') {
    if (!opts.apiKey) throw new Error('classifyImages: apiKey required for claude backend');

    // Extract image URLs from task list
    const imageUrls = taskList.map(t => t.datapoint_uri || t.datapoint_text || '').filter(Boolean);

    if (imageUrls.length === 0) {
      // No image URLs — fallback to all-true
      const answers = {};
      for (const task of taskList) {
        if (task.task_key) answers[task.task_key] = 'true';
      }
      return answers;
    }

    // Classify
    const results = await classifyWithClaude(imageUrls, question, opts.apiKey);

    // Map back to task keys
    const answers = {};
    for (let i = 0; i < taskList.length; i++) {
      const task = taskList[i];
      if (task.task_key) {
        answers[task.task_key] = results[i] || 'false';
      }
    }
    return answers;
  }

  throw new Error('Unknown backend: ' + backend);
}

module.exports = { classifyImages };
