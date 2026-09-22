// Lightweight, fully client-side handwritten-digit recognizer.
//
// This is NOT a general handwriting OCR — it only classifies isolated
// single digits (0-9), using a small MLP (784-128-64-10) trained on
// MNIST and shipped as a ~430KB binary weight blob. It exists to catch
// resident registration numbers that were handwritten into a scanned
// form (so Tesseract, which is a printed-text engine, finds nothing).
//
// Pipeline: binarize a region -> connected-component segmentation to
// isolate ink blobs -> normalize each blob to a 28x28 MNIST-style patch
// -> classify -> assemble the digit string in left-to-right order.
(function (global) {
  const MODEL_URL = "js/digit-ocr/digit_model.bin";
  const SHAPES = {
    W1: [784, 128], b1: [128],
    W2: [128, 64], b2: [64],
    W3: [64, 10], b3: [10],
  };

  let modelPromise = null;

  function loadModel() {
    if (!modelPromise) {
      modelPromise = fetch(MODEL_URL)
        .then((res) => res.arrayBuffer())
        .then((buf) => {
          const flat = new Float32Array(buf);
          let offset = 0;
          const weights = {};
          Object.keys(SHAPES).forEach((key) => {
            const shape = SHAPES[key];
            const size = shape.reduce((a, b) => a * b, 1);
            weights[key] = { data: flat.subarray(offset, offset + size), shape };
            offset += size;
          });
          return weights;
        });
    }
    return modelPromise;
  }

  function relu(arr) {
    for (let i = 0; i < arr.length; i += 1) if (arr[i] < 0) arr[i] = 0;
    return arr;
  }

  // y[out] = x[in] @ W[in,out] + b[out]
  function dense(x, W, b, inDim, outDim) {
    const y = new Float32Array(outDim);
    for (let o = 0; o < outDim; o += 1) {
      let sum = b[o];
      for (let i = 0; i < inDim; i += 1) {
        sum += x[i] * W[i * outDim + o];
      }
      y[o] = sum;
    }
    return y;
  }

  function softmax(x) {
    let max = -Infinity;
    for (let i = 0; i < x.length; i += 1) if (x[i] > max) max = x[i];
    let sum = 0;
    const out = new Float32Array(x.length);
    for (let i = 0; i < x.length; i += 1) {
      out[i] = Math.exp(x[i] - max);
      sum += out[i];
    }
    for (let i = 0; i < x.length; i += 1) out[i] /= sum;
    return out;
  }

  // pixels28: Float32Array(784), values 0..1, foreground(ink)=high, matching MNIST convention.
  function classifyDigit(weights, pixels28) {
    const z1 = dense(pixels28, weights.W1.data, weights.b1.data, 784, 128);
    const a1 = relu(z1);
    const z2 = dense(a1, weights.W2.data, weights.b2.data, 128, 64);
    const a2 = relu(z2);
    const z3 = dense(a2, weights.W3.data, weights.b3.data, 64, 10);
    const probs = softmax(z3);
    let best = 0;
    for (let i = 1; i < 10; i += 1) if (probs[i] > probs[best]) best = i;
    return { digit: best, confidence: probs[best] };
  }

  // --- Image segmentation ---

  // Otsu's method: pick the threshold that best separates ink from paper.
  function otsuThreshold(gray) {
    const hist = new Array(256).fill(0);
    for (let i = 0; i < gray.length; i += 1) hist[gray[i]] += 1;
    const total = gray.length;
    let sum = 0;
    for (let t = 0; t < 256; t += 1) sum += t * hist[t];
    let sumB = 0;
    let wB = 0;
    let maxVar = 0;
    let threshold = 128;
    for (let t = 0; t < 256; t += 1) {
      wB += hist[t];
      if (wB === 0) continue;
      const wF = total - wB;
      if (wF === 0) break;
      sumB += t * hist[t];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      const varBetween = wB * wF * (mB - mF) * (mB - mF);
      if (varBetween > maxVar) {
        maxVar = varBetween;
        threshold = t;
      }
    }
    return threshold;
  }

  // Two-pass connected component labeling (4-connectivity) with union-find.
  function findComponents(binary, width, height) {
    const labels = new Int32Array(width * height);
    const parent = [0];

    function find(x) {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]];
        x = parent[x];
      }
      return x;
    }
    function union(a, b) {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    }

    let nextLabel = 1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const idx = y * width + x;
        if (!binary[idx]) continue;
        const left = x > 0 && binary[idx - 1] ? labels[idx - 1] : 0;
        const up = y > 0 && binary[idx - width] ? labels[idx - width] : 0;
        if (left && up) {
          labels[idx] = Math.min(left, up);
          union(left, up);
        } else if (left || up) {
          labels[idx] = left || up;
        } else {
          labels[idx] = nextLabel;
          parent[nextLabel] = nextLabel;
          nextLabel += 1;
        }
      }
    }

    const boxes = new Map();
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const idx = y * width + x;
        if (!labels[idx]) continue;
        const root = find(labels[idx]);
        if (!boxes.has(root)) {
          boxes.set(root, { x0: x, y0: y, x1: x, y1: y, count: 0 });
        }
        const b = boxes.get(root);
        if (x < b.x0) b.x0 = x;
        if (x > b.x1) b.x1 = x;
        if (y < b.y0) b.y0 = y;
        if (y > b.y1) b.y1 = y;
        b.count += 1;
      }
    }
    return Array.from(boxes.values());
  }

  // Crop+center a blob's ink into a 28x28 MNIST-style patch (foreground
  // scaled to a ~20px box, padded to 28x28, matching the training data's
  // framing so the classifier sees familiar-looking input).
  function blobToPatch(binary, width, blob) {
    const bw = blob.x1 - blob.x0 + 1;
    const bh = blob.y1 - blob.y0 + 1;
    const scale = 20 / Math.max(bw, bh);
    const targetW = Math.max(1, Math.round(bw * scale));
    const targetH = Math.max(1, Math.round(bh * scale));

    const src = document.createElement("canvas");
    src.width = bw;
    src.height = bh;
    const sctx = src.getContext("2d");
    const srcImageData = sctx.createImageData(bw, bh);
    for (let y = 0; y < bh; y += 1) {
      for (let x = 0; x < bw; x += 1) {
        const on = binary[(blob.y0 + y) * width + (blob.x0 + x)];
        const v = on ? 255 : 0;
        const o = (y * bw + x) * 4;
        srcImageData.data[o] = v;
        srcImageData.data[o + 1] = v;
        srcImageData.data[o + 2] = v;
        srcImageData.data[o + 3] = 255;
      }
    }
    sctx.putImageData(srcImageData, 0, 0);

    const dst = document.createElement("canvas");
    dst.width = 28;
    dst.height = 28;
    const dctx = dst.getContext("2d");
    dctx.fillStyle = "#000000";
    dctx.fillRect(0, 0, 28, 28);
    const offX = Math.round((28 - targetW) / 2);
    const offY = Math.round((28 - targetH) / 2);
    dctx.imageSmoothingEnabled = true;
    dctx.drawImage(src, 0, 0, bw, bh, offX, offY, targetW, targetH);

    const out = dctx.getImageData(0, 0, 28, 28).data;
    const pixels = new Float32Array(784);
    for (let i = 0; i < 784; i += 1) pixels[i] = out[i * 4] / 255;
    return pixels;
  }

  // Segments and classifies digits in a canvas region. Returns
  // { text, avgConfidence, boxes: [{x0,y0,x1,y1,digit,confidence}] }
  // in page-canvas pixel coordinates (region.x0/y0 offsets are re-applied),
  // ordered left to right. Returns null if nothing plausible was found.
  async function recognizeDigitsInRegion(sourceCanvas, region) {
    const weights = await loadModel();

    const rx0 = Math.max(0, Math.round(region.x0));
    const ry0 = Math.max(0, Math.round(region.y0));
    const rw = Math.min(sourceCanvas.width - rx0, Math.round(region.x1 - region.x0));
    const rh = Math.min(sourceCanvas.height - ry0, Math.round(region.y1 - region.y0));
    if (rw <= 0 || rh <= 0) return null;

    const ctx = sourceCanvas.getContext("2d");
    const imgData = ctx.getImageData(rx0, ry0, rw, rh);
    const gray = new Uint8ClampedArray(rw * rh);
    for (let i = 0; i < rw * rh; i += 1) {
      const o = i * 4;
      gray[i] = Math.round(0.299 * imgData.data[o] + 0.587 * imgData.data[o + 1] + 0.114 * imgData.data[o + 2]);
    }

    const threshold = otsuThreshold(gray);
    const binary = new Uint8Array(rw * rh);
    for (let i = 0; i < rw * rh; i += 1) binary[i] = gray[i] < threshold ? 1 : 0;

    let blobs = findComponents(binary, rw, rh);
    // Drop specks (noise) and anything wildly larger than a single
    // character (a stray table border line that leaked into the crop).
    const heights = blobs.map((b) => b.y1 - b.y0 + 1).sort((a, b) => a - b);
    const medianH = heights.length ? heights[Math.floor(heights.length / 2)] : 0;
    blobs = blobs.filter((b) => {
      const w = b.x1 - b.x0 + 1;
      const h = b.y1 - b.y0 + 1;
      if (b.count < 6) return false; // speck
      if (medianH > 0 && h < medianH * 0.35) return false; // likely a dash/punctuation
      if (medianH > 0 && h > medianH * 2.5) return false; // likely a stray line
      if (w > rw * 0.6) return false; // spans almost the whole crop, not a single digit
      return true;
    });
    if (blobs.length < 10) return null; // not enough candidate digits to be an RRN

    blobs.sort((a, b) => a.x0 - b.x0);

    let text = "";
    let confSum = 0;
    const boxes = [];
    blobs.forEach((blob) => {
      const patch = blobToPatch(binary, rw, blob);
      const { digit, confidence } = classifyDigit(weights, patch);
      text += String(digit);
      confSum += confidence;
      boxes.push({
        x0: rx0 + blob.x0,
        y0: ry0 + blob.y0,
        x1: rx0 + blob.x1 + 1,
        y1: ry0 + blob.y1 + 1,
        digit,
        confidence,
      });
    });

    return { text, avgConfidence: confSum / blobs.length, boxes };
  }

  global.DigitOCR = { recognizeDigitsInRegion };
})(window);
