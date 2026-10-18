// Tiny fake <canvas> + 2D context for running src/gfx in Node. It does not rasterise anything:
// every method call and style assignment is appended to a shared log so tests can count draw
// calls, compare signatures and assert determinism.

const METHODS = [
  'save', 'restore', 'translate', 'scale', 'rotate', 'setTransform', 'transform', 'resetTransform',
  'beginPath', 'closePath', 'moveTo', 'lineTo', 'quadraticCurveTo', 'bezierCurveTo', 'arc', 'arcTo', 'ellipse', 'rect',
  'fill', 'stroke', 'clip', 'fillRect', 'strokeRect', 'clearRect', 'fillText', 'strokeText', 'setLineDash', 'drawImage',
];

/** Methods that actually put pixels on the canvas. */
const DRAW_METHODS = new Set(['fill', 'stroke', 'fillRect', 'strokeRect', 'fillText', 'strokeText', 'drawImage']);

const PROPS = [
  'fillStyle', 'strokeStyle', 'lineWidth', 'lineCap', 'lineJoin', 'globalAlpha', 'globalCompositeOperation', 'font',
  'textAlign', 'textBaseline', 'shadowBlur', 'shadowColor', 'shadowOffsetX', 'shadowOffsetY', 'miterLimit',
  'lineDashOffset', 'imageSmoothingEnabled',
];

let gradientSeq = 0;

function fmt(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(v * 1000) / 1000) : `!${v}`;
  if (v && typeof v === 'object') {
    if (v.__gradient) return `grad(${v.kind}:${v.args.map(fmt).join(',')}:${v.stops.join(';')})`;
    if (v.__fakeCanvas) return `canvas(${v.width}x${v.height})`;
    return 'obj';
  }
  return String(v);
}

export class FakeContext {
  constructor(canvas) {
    this.canvas = canvas;
    this.log = [];
    this.draws = 0;
    this.nanArgs = 0;
    this.depth = 0;
    this.maxDepth = 0;
    this._props = {};
  }

  _call(name, args) {
    for (const a of args) if (typeof a === 'number' && !Number.isFinite(a)) this.nanArgs++;
    if (DRAW_METHODS.has(name)) this.draws++;
    if (name === 'save') this.maxDepth = Math.max(this.maxDepth, ++this.depth);
    if (name === 'restore') this.depth--;
    this.log.push(`${name}(${args.map(fmt).join(',')})`);
  }

  createLinearGradient(...args) {
    return makeGradient('linear', args);
  }

  createRadialGradient(...args) {
    return makeGradient('radial', args);
  }

  createPattern() {
    return { __pattern: true };
  }

  measureText(text) {
    return { width: String(text).length * 6 };
  }

  getImageData(x, y, w, h) {
    return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  }

  putImageData() {
    this._call('putImageData', []);
  }

  /** Stable string signature of everything drawn so far. */
  signature() {
    return this.log.join('\n');
  }
}

for (const m of METHODS) {
  FakeContext.prototype[m] = function fakeMethod(...args) {
    this._call(m, args);
  };
}
for (const p of PROPS) {
  Object.defineProperty(FakeContext.prototype, p, {
    get() {
      return this._props[p];
    },
    set(v) {
      this._props[p] = v;
      this.log.push(`${p}=${fmt(v)}`);
    },
  });
}

function makeGradient(kind, args) {
  const gr = {
    __gradient: true, id: ++gradientSeq, kind, args, stops: [],
    addColorStop(t, c) {
      if (!(t >= 0 && t <= 1)) throw new Error(`fakeCanvas: gradient stop offset out of range: ${t}`);
      gr.stops.push(`${fmt(t)}=${c}`);
    },
  };
  return gr;
}

export class FakeCanvas {
  constructor(w, h) {
    this.width = w;
    this.height = h;
    this.__fakeCanvas = true;
    this._ctx = null;
  }

  getContext(type) {
    if (type !== '2d') return null;
    if (!this._ctx) this._ctx = new FakeContext(this);
    return this._ctx;
  }
}

/** Factory for gfx.setCanvasFactory(). */
export function fakeCanvasFactory(w, h) {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) {
    throw new Error(`fakeCanvas: bad canvas size ${w}x${h}`);
  }
  return new FakeCanvas(w, h);
}

/** Convenience accessors for a canvas produced by the fake factory. */
export function drawCount(canvas) {
  return canvas.getContext('2d').draws;
}

export function signature(canvas) {
  return canvas.getContext('2d').signature();
}

export function nanCount(canvas) {
  return canvas.getContext('2d').nanArgs;
}

export function saveBalance(canvas) {
  return canvas.getContext('2d').depth;
}
