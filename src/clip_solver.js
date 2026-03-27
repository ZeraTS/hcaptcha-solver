'use strict';

/**
 * clip_solver.js — CLIP-based image classifier using @xenova/transformers
 *
 * Uses Xenova/clip-vit-base-patch32 for:
 *   - Image similarity (findMostSimilar, getEmbedding)
 *   - Zero-shot classification (classify, findMatchingContext)
 *
 * CJS module wrapping ESM @xenova/transformers via dynamic import.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

let _transformers = null;

async function getTransformers() {
  if (!_transformers) {
    // Dynamic import to bridge CJS → ESM
    _transformers = await Function('return import("@xenova/transformers")')();
  }
  return _transformers;
}

// Write buffer to a temp file and return the path
function bufferToTempFile(buf, ext = '.png') {
  const tmpDir = os.tmpdir();
  const fname = 'clip_' + crypto.randomBytes(8).toString('hex') + ext;
  const fpath = path.join(tmpDir, fname);
  fs.writeFileSync(fpath, buf);
  return fpath;
}

class CLIPSolver {
  constructor(opts = {}) {
    this.modelName = opts.modelName || 'Xenova/clip-vit-base-patch32';
    this._pipe = null;          // zero-shot-image-classification pipeline
    this._model = null;         // CLIPVisionModelWithProjection for raw embeddings
    this._processor = null;     // AutoProcessor
    this._textModel = null;     // CLIPTextModelWithProjection for text embeddings
    this._tokenizer = null;     // AutoTokenizer
    this._ready = false;
    this.debug = opts.debug || false;
  }

  log(...args) {
    if (this.debug) console.log('[clip-solver]', ...args);
  }

  async init() {
    if (this._ready) return;
    const t = await getTransformers();
    const { pipeline, env, AutoProcessor, CLIPVisionModelWithProjection,
            CLIPTextModelWithProjection, AutoTokenizer } = t;

    // Suppress download progress noise unless debug
    if (!this.debug) {
      env.allowLocalModels = false;
    }

    this.log('Loading zero-shot pipeline...');
    this._pipe = await pipeline('zero-shot-image-classification', this.modelName);

    this.log('Loading vision model for embeddings...');
    this._processor = await AutoProcessor.from_pretrained(this.modelName);
    this._model = await CLIPVisionModelWithProjection.from_pretrained(this.modelName);

    this.log('Loading text model for embeddings...');
    this._tokenizer = await AutoTokenizer.from_pretrained(this.modelName);
    this._textModel = await CLIPTextModelWithProjection.from_pretrained(this.modelName);

    this._ready = true;
    this.log('CLIP model ready');
  }

  /**
   * Load a RawImage from a Buffer using fromBlob (works with sharp in Node.js)
   */
  async _loadImage(buf) {
    const t = await getTransformers();
    const { RawImage } = t;
    // Detect mime from magic bytes
    let mime = 'image/png';
    if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xd8) mime = 'image/jpeg';
    // Use fromBlob which accepts a Blob with arrayBuffer() method
    const blob = new Blob([buf], { type: mime });
    return RawImage.fromBlob(blob);
  }

  /**
   * Get CLIP image embedding (normalized) from a Buffer.
   * Returns Float32Array.
   */
  async getEmbedding(imageBuffer) {
    if (!this._ready) await this.init();
    const image = await this._loadImage(imageBuffer);
    const inputs = await this._processor(image);
    const { image_embeds } = await this._model(inputs);
    const data = image_embeds.data;
    // Normalize
    let norm = 0;
    for (let i = 0; i < data.length; i++) norm += data[i] * data[i];
    norm = Math.sqrt(norm);
    const normalized = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) normalized[i] = data[i] / norm;
    return normalized;
  }

  /**
   * Cosine similarity between two Float32Array / number[] embeddings.
   */
  cosineSimilarity(a, b) {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }

  /**
   * Zero-shot classify an image against text labels.
   * Returns [{label, score}] sorted descending by score.
   */
  async classify(imageBuffer, labels) {
    if (!this._ready) await this.init();
    const image = await this._loadImage(imageBuffer);
    const output = await this._pipe(image, labels);
    // output is already sorted descending by score from the pipeline
    return output;
  }

  /**
   * Find the index (0-based) of the most similar candidate image to the query image.
   */
  async findMostSimilar(queryBuffer, candidateBuffers) {
    if (!this._ready) await this.init();
    const queryEmb = await this.getEmbedding(queryBuffer);
    let bestIdx = 0;
    let bestSim = -Infinity;
    for (let i = 0; i < candidateBuffers.length; i++) {
      const emb = await this.getEmbedding(candidateBuffers[i]);
      const sim = this.cosineSimilarity(queryEmb, emb);
      this.log(`  candidate[${i}] similarity: ${sim.toFixed(4)}`);
      if (sim > bestSim) {
        bestSim = sim;
        bestIdx = i;
      }
    }
    this.log(`Best match: index ${bestIdx} sim=${bestSim.toFixed(4)}`);
    return bestIdx;
  }

  /**
   * Find all candidate images that match a context described by positive labels
   * (and differ from negative labels) above the given threshold.
   * Returns array of 0-based indices.
   */
  async findMatchingContext(candidateBuffers, positiveLabels, negativeLabels, threshold = 0.2) {
    if (!this._ready) await this.init();
    const allLabels = [...positiveLabels, ...(negativeLabels || [])];
    const matching = [];
    for (let i = 0; i < candidateBuffers.length; i++) {
      const results = await this.classify(candidateBuffers[i], allLabels);
      // Score = sum of positive label scores
      let posScore = 0;
      for (const label of positiveLabels) {
        const r = results.find(x => x.label === label);
        if (r) posScore += r.score;
      }
      // Normalize by number of positive labels
      posScore /= positiveLabels.length;
      this.log(`  candidate[${i}] context score: ${posScore.toFixed(4)}`);
      if (posScore >= threshold) matching.push(i);
    }
    return matching;
  }

  /**
   * Find top-N most similar candidates to a query image.
   * Returns array of indices sorted by similarity (descending).
   */
  async findTopSimilar(queryBuffer, candidateBuffers, topN = 3) {
    if (!this._ready) await this.init();
    const queryEmb = await this.getEmbedding(queryBuffer);
    const sims = [];
    for (let i = 0; i < candidateBuffers.length; i++) {
      const emb = await this.getEmbedding(candidateBuffers[i]);
      sims.push({ idx: i, sim: this.cosineSimilarity(queryEmb, emb) });
    }
    sims.sort((a, b) => b.sim - a.sim);
    return sims.slice(0, topN).map(x => x.idx);
  }
}

// Singleton instance for reuse across calls
let _solver = null;

async function getSolver(opts = {}) {
  if (!_solver) {
    _solver = new CLIPSolver(opts);
    await _solver.init();
  }
  return _solver;
}

module.exports = { CLIPSolver, getSolver };
