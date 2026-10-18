// Minimal Apple XML property-list parser + cocos2d texture-atlas helpers.
// Pure string processing (no DOM), used by tools/build-duelyst-manifest.mjs and by tests.
// Spec: docs/mechanics/duelyst-assets.md ("Atlas format").

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };

function decodeEntities(s) {
  return s.replace(/&(amp|lt|gt|quot|apos);/g, (m) => ENTITIES[m]);
}

/**
 * Parse an XML plist document into plain JS values
 * (dict -> object, array -> array, string/integer/real/true/false -> primitives).
 * @param {string} xml
 * @returns {any} the root value (usually an object)
 */
export function parsePlist(xml) {
  const tokenRe = /<(\/?)([a-zA-Z]+)(?:\s[^>]*?)?(\/?)>|([^<]+)/g;
  /** @type {{type:string, value:any, key:string|null}[]} */
  const stack = [];
  let root;
  let text = '';
  let sawRoot = false;
  const put = (value) => {
    const top = stack[stack.length - 1];
    if (!top) { root = value; sawRoot = true; return; }
    if (top.type === 'array') top.value.push(value);
    else if (top.key !== null) { top.value[top.key] = value; top.key = null; }
    else throw new Error('plist: value without a key inside <dict>');
  };
  const body = xml.replace(/<\?xml[^>]*\?>/, '').replace(/<!DOCTYPE[^>]*>/, '').replace(/<!--[\s\S]*?-->/g, '');
  let m;
  while ((m = tokenRe.exec(body))) {
    if (m[4] !== undefined) { text += m[4]; continue; }
    const closing = m[1] === '/';
    const tag = m[2];
    const selfClosing = m[3] === '/';
    if (tag === 'plist') { text = ''; continue; }
    if (!closing) {
      text = '';
      if (tag === 'dict' || tag === 'array') {
        const value = tag === 'dict' ? {} : [];
        if (selfClosing) put(value);
        else stack.push({ type: tag, value, key: null });
      } else if (tag === 'true' || tag === 'false') {
        put(tag === 'true');
      } else if (selfClosing) {
        if (tag === 'string') put('');
        else if (tag === 'key') stack[stack.length - 1].key = '';
      }
      continue;
    }
    if (tag === 'dict' || tag === 'array') {
      const done = stack.pop();
      if (!done || done.type !== tag) throw new Error(`plist: unbalanced </${tag}>`);
      put(done.value);
    } else if (tag === 'key') {
      const top = stack[stack.length - 1];
      if (!top || top.type !== 'dict') throw new Error('plist: <key> outside <dict>');
      top.key = decodeEntities(text);
    } else if (tag === 'string') {
      put(decodeEntities(text));
    } else if (tag === 'integer' || tag === 'real') {
      put(Number(text.trim()));
    } else if (tag === 'date' || tag === 'data') {
      put(text.trim());
    }
    text = '';
  }
  if (stack.length) throw new Error('plist: unexpected end of document');
  if (!sawRoot) throw new Error('plist: empty document');
  return root;
}

/** Parse a cocos2d brace list such as `{{404,0},{100,100}}` or `{0,-3}` into a flat number array. */
export function parseBraces(str) {
  const nums = String(str).match(/-?\d+(?:\.\d+)?/g);
  return nums ? nums.map(Number) : [];
}

/**
 * @typedef {Object} AtlasFrame
 * @property {string} name   frame key, e.g. `f1_general_attack_000.png`
 * @property {number} x      left edge of the packed region in the sheet
 * @property {number} y      top edge of the packed region in the sheet
 * @property {number} w      UNROTATED width of the trimmed frame
 * @property {number} h      UNROTATED height of the trimmed frame
 * @property {boolean} rot   packed rotated 90deg clockwise (the sheet region is then h x w)
 * @property {number} ox     left offset of the trimmed frame inside the untrimmed source
 * @property {number} oy     top offset of the trimmed frame inside the untrimmed source
 * @property {number} sw     untrimmed source width
 * @property {number} sh     untrimmed source height
 */

/**
 * Normalise a parsed cocos2d atlas plist (format 2 and 3, tolerant of format 0/1 key names).
 * @param {any} plist  result of parsePlist
 * @returns {{ texture: string|null, width: number, height: number, frames: AtlasFrame[] }}
 */
export function parseAtlas(plist) {
  const meta = plist.metadata || {};
  const size = parseBraces(meta.size || '');
  const frames = [];
  for (const [name, f] of Object.entries(plist.frames || {})) {
    let x; let y; let w; let h; let offX = 0; let offY = 0; let sw; let sh; let colorRect = null;
    if (f.frame !== undefined) {
      [x, y, w, h] = parseBraces(f.frame);
      [offX = 0, offY = 0] = parseBraces(f.offset || '');
      [sw = w, sh = h] = parseBraces(f.sourceSize || '');
      if (f.sourceColorRect) colorRect = parseBraces(f.sourceColorRect);
    } else if (f.textureRect !== undefined) { // format 3
      [x, y, w, h] = parseBraces(f.textureRect);
      [offX = 0, offY = 0] = parseBraces(f.spriteOffset || '');
      [sw = w, sh = h] = parseBraces(f.spriteSourceSize || '');
    } else { // format 0
      x = Number(f.x); y = Number(f.y); w = Number(f.width); h = Number(f.height);
      offX = Number(f.offsetX || 0); offY = Number(f.offsetY || 0);
      sw = Number(f.originalWidth || w); sh = Number(f.originalHeight || h);
    }
    const rot = Boolean(f.rotated ?? f.textureRotated ?? false);
    // cocos2d "offset" is the displacement of the trimmed rect's centre from the source centre,
    // with +y pointing UP. Convert to a top-left offset (y down). sourceColorRect, when present
    // and consistent, already holds exactly that.
    let ox = Math.round((sw - w) / 2 + offX);
    let oy = Math.round((sh - h) / 2 - offY);
    if (colorRect && colorRect.length === 4 && colorRect[2] === w && colorRect[3] === h) {
      ox = colorRect[0]; oy = colorRect[1];
    }
    frames.push({ name, x, y, w, h, rot, ox, oy, sw, sh });
  }
  return { texture: meta.textureFileName || meta.realTextureFileName || null, width: size[0] || 0, height: size[1] || 0, frames };
}

/**
 * Split a frame key into animation name and index.
 * `f1_general_attack_000.png` with prefix `f1_general` -> { anim: 'attack', index: 0 }.
 * Frames that are just `<prefix>_007.png` get anim `''` (the default strip).
 * @param {string} frameName
 * @param {string} [prefix]  sheet base name; when the key does not start with it, the last
 *                           underscore-separated word before the index is used as the animation
 */
export function splitFrameName(frameName, prefix) {
  const base = frameName.replace(/\.(png|jpg)$/i, '');
  const m = /^(.*?)_?(\d+)$/.exec(base);
  const stem = m ? m[1] : base;
  const index = m ? Number(m[2]) : 0;
  if (prefix && stem === prefix) return { anim: '', index };
  if (prefix && stem.startsWith(prefix + '_')) return { anim: stem.slice(prefix.length + 1), index };
  const cut = stem.lastIndexOf('_');
  return { anim: cut >= 0 ? stem.slice(cut + 1) : stem, index };
}

/**
 * Compact manifest encoding of one frame: `[x, y]` when the frame is untrimmed, unrotated and has
 * the sheet's common frame size, otherwise `[x, y, w, h, ox, oy, rot(0|1), sw, sh]`.
 */
export function packFrame(f, fw, fh) {
  if (!f.rot && f.ox === 0 && f.oy === 0 && f.w === fw && f.h === fh && f.sw === fw && f.sh === fh) return [f.x, f.y];
  return [f.x, f.y, f.w, f.h, f.ox, f.oy, f.rot ? 1 : 0, f.sw, f.sh];
}

/** Inverse of packFrame. */
export function unpackFrame(a, fw, fh) {
  if (a.length <= 2) return { x: a[0], y: a[1], w: fw, h: fh, ox: 0, oy: 0, rot: false, sw: fw, sh: fh };
  return { x: a[0], y: a[1], w: a[2], h: a[3], ox: a[4], oy: a[5], rot: a[6] === 1, sw: a[7] ?? fw, sh: a[8] ?? fh };
}

/**
 * Group atlas frames into animations and pick the dominant untrimmed frame size.
 * @returns {{ fw: number, fh: number, anims: Record<string, number[][]> }}
 */
export function atlasToAnimations(atlas, prefix) {
  const counts = new Map();
  for (const f of atlas.frames) {
    const k = `${f.sw}x${f.sh}`;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  let best = '0x0'; let bestN = -1;
  for (const [k, n] of counts) if (n > bestN) { best = k; bestN = n; }
  const [fw, fh] = best.split('x').map(Number);
  /** @type {Record<string, {index:number, frame:AtlasFrame}[]>} */
  const groups = {};
  for (const f of atlas.frames) {
    const { anim, index } = splitFrameName(f.name, prefix);
    (groups[anim] ||= []).push({ index, frame: f });
  }
  const anims = {};
  for (const name of Object.keys(groups).sort()) {
    anims[name] = groups[name].sort((a, b) => a.index - b.index).map((g) => packFrame(g.frame, fw, fh));
  }
  return { fw, fh, anims };
}
