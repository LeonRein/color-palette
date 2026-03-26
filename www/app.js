const DEUTAN_SOURCE_XY = [1.4, -0.4];
const EPS = 1e-12;

const DEFAULTS = {
  generatedCount: 8,
  poolSize: 1000,
  refinements: 20,
  minLightness: 0.0,
  confusionWeight: 0.5,
  seed: 42,
};

const state = {
  fixedColors: [],
  generated: [],
  isGenerating: false,
};

const dom = {
  fixedList: document.getElementById("fixedColorsList"),
  rowTemplate: document.getElementById("fixedColorRowTemplate"),
  addFixedBtn: document.getElementById("addFixedBtn"),
  generateBtn: document.getElementById("generateBtn"),
  generatedCount: document.getElementById("generatedCount"),
  poolSize: document.getElementById("poolSize"),
  refinements: document.getElementById("refinements"),
  minLightness: document.getElementById("minLightness"),
  confusionWeight: document.getElementById("confusionWeight"),
  seed: document.getElementById("seed"),
  status: document.getElementById("status"),
  paletteGrid: document.getElementById("paletteGrid"),
  copyAllBtn: document.getElementById("copyAllBtn"),
  downloadBtn: document.getElementById("downloadBtn"),
};

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function normalizeHex(input) {
  if (typeof input !== "string") return null;
  const m = input
    .trim()
    .toUpperCase()
    .match(/^#?([0-9A-F]{6})$/);
  return m ? `#${m[1]}` : null;
}

function hexToRgb01(hex) {
  const h = normalizeHex(hex);
  if (!h) return null;
  return [
    parseInt(h.slice(1, 3), 16) / 255,
    parseInt(h.slice(3, 5), 16) / 255,
    parseInt(h.slice(5, 7), 16) / 255,
  ];
}

function rgb01ToHex(rgb) {
  const toHex = (x) =>
    Math.round(clamp(x, 0, 1) * 255)
      .toString(16)
      .padStart(2, "0")
      .toUpperCase();
  return `#${toHex(rgb[0])}${toHex(rgb[1])}${toHex(rgb[2])}`;
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function rng() {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb(c) {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

function rgbToXyz([r, g, b]) {
  const rl = srgbToLinear(r);
  const gl = srgbToLinear(g);
  const bl = srgbToLinear(b);

  const x = rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375;
  const y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.072175;
  const z = rl * 0.0193339 + gl * 0.119192 + bl * 0.9503041;
  return [x, y, z];
}

function xyzToRgb([x, y, z]) {
  const rl = x * 3.2404542 + y * -1.5371385 + z * -0.4985314;
  const gl = x * -0.969266 + y * 1.8760108 + z * 0.041556;
  const bl = x * 0.0556434 + y * -0.2040259 + z * 1.0572252;
  return [linearToSrgb(rl), linearToSrgb(gl), linearToSrgb(bl)];
}

function xyzToXy([x, y, z]) {
  const sum = x + y + z;
  if (sum <= EPS) return [0, 0];
  return [x / sum, y / sum];
}

function xyzToOklab([x, y, z]) {
  const l = 0.8189330101 * x + 0.3618667424 * y - 0.1288597137 * z;
  const m = 0.0329845436 * x + 0.9293118715 * y + 0.0361456387 * z;
  const s = 0.0482003018 * x + 0.2643662691 * y + 0.633851707 * z;

  const l_ = Math.cbrt(Math.max(l, 0));
  const m_ = Math.cbrt(Math.max(m, 0));
  const s_ = Math.cbrt(Math.max(s, 0));

  return [
    0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  ];
}

function oklabToXyz([L, a, b]) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  return [
    1.2270138511 * l - 0.5577999807 * m + 0.281256149 * s,
    -0.0405801784 * l + 1.1122568696 * m - 0.0716766787 * s,
    -0.0763812845 * l - 0.4214819784 * m + 1.5861632204 * s,
  ];
}

function oklchToOklab([L, C, hDeg]) {
  const h = (hDeg * Math.PI) / 180;
  return [L, C * Math.cos(h), C * Math.sin(h)];
}

function oklabDistance(c1, c2) {
  const dL = c1[0] - c2[0];
  const da = c1[1] - c2[1];
  const db = c1[2] - c2[2];
  return Math.sqrt(dL * dL + da * da + db * db);
}

function midpointXy(c1, c2) {
  return [(c1[0] + c2[0]) * 0.5, (c1[1] + c2[1]) * 0.5];
}

function weightedPairDistance(colorA, colorB, confusionWeight) {
  const d = oklabDistance(colorA.oklab, colorB.oklab);

  const m = midpointXy(colorA.xy, colorB.xy);
  const dx = m[0] - DEUTAN_SOURCE_XY[0];
  const dy = m[1] - DEUTAN_SOURCE_XY[1];
  const norm = Math.sqrt(dx * dx + dy * dy) + EPS;
  const ux = dx / norm;
  const uy = dy / norm;

  const dxyx = colorA.xy[0] - colorB.xy[0];
  const dxyy = colorA.xy[1] - colorB.xy[1];
  const dxyNorm = Math.sqrt(dxyx * dxyx + dxyy * dxyy) + EPS;
  const vx = dxyx / dxyNorm;
  const vy = dxyy / dxyNorm;

  const cosTheta = Math.abs(ux * vx + uy * vy);
  const weight = 1 + confusionWeight * cosTheta;
  return d * weight;
}

function getRandomInGamutColor(rng, minLightness) {
  for (let i = 0; i < 300; i++) {
    const L = minLightness + (1 - minLightness) * rng();
    const C = 0.02 + 0.3 * rng();
    const h = 360 * rng();

    const oklab = oklchToOklab([L, C, h]);
    const xyz = oklabToXyz(oklab);
    const rgb = xyzToRgb(xyz);

    if (rgb.every((v) => v >= 0 && v <= 1)) {
      return {
        rgb,
        hex: rgb01ToHex(rgb),
        xyz,
        xy: xyzToXy(xyz),
        oklab,
      };
    }
  }
  return null;
}

function buildPool(poolSize, minLightness, seed) {
  const rng = mulberry32(seed >>> 0);
  const pool = [];
  while (pool.length < poolSize) {
    const c = getRandomInGamutColor(rng, minLightness);
    if (c) pool.push(c);
  }
  return pool;
}

function hexToColorStruct(hex) {
  const rgb = hexToRgb01(hex);
  if (!rgb) return null;
  const xyz = rgbToXyz(rgb);
  const xy = xyzToXy(xyz);
  const oklab = xyzToOklab(xyz);
  return { hex: normalizeHex(hex), rgb, xyz, xy, oklab };
}

function nearestDistance(candidate, selected, confusionWeight) {
  if (!selected.length) return Infinity;
  let best = Infinity;
  for (const s of selected) {
    const d = weightedPairDistance(candidate, s, confusionWeight);
    if (d < best) best = d;
  }
  return best;
}

function generatePalette({
  generatedCount,
  poolSize,
  refinements,
  minLightness,
  confusionWeight,
  seed,
  fixedHexes,
}) {
  const fixed = fixedHexes.map(hexToColorStruct).filter(Boolean);
  const pool = buildPool(poolSize, minLightness, seed);

  const chosen = [];
  const forbidden = new Set(fixed.map((f) => f.hex));

  for (let i = 0; i < generatedCount; i++) {
    let best = null;
    let bestScore = -Infinity;

    for (const c of pool) {
      if (forbidden.has(c.hex)) continue;
      const score = nearestDistance(c, [...fixed, ...chosen], confusionWeight);
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }

    if (!best) break;
    chosen.push(best);
    forbidden.add(best.hex);
  }

  for (let r = 0; r < refinements; r++) {
    for (let i = 0; i < chosen.length; i++) {
      const context = [...fixed, ...chosen.slice(0, i), ...chosen.slice(i + 1)];
      let current = chosen[i];
      let currentScore = nearestDistance(current, context, confusionWeight);

      for (const c of pool) {
        if (forbidden.has(c.hex) && c.hex !== current.hex) continue;
        const score = nearestDistance(c, context, confusionWeight);
        if (score > currentScore) {
          forbidden.delete(current.hex);
          current = c;
          currentScore = score;
          forbidden.add(current.hex);
        }
      }

      chosen[i] = current;
    }
  }

  return {
    fixed,
    generated: chosen.map((c) => ({
      hex: c.hex,
      rgb: c.rgb,
    })),
  };
}

function cardForColor(hex, label = "") {
  const item = document.createElement("div");
  item.className = "swatch";

  const patch = document.createElement("div");
  patch.className = "swatch-color";
  patch.style.background = hex;

  const meta = document.createElement("div");
  meta.className = "swatch-meta";

  const name = document.createElement("div");
  name.className = "swatch-label";
  name.textContent = label || "Color";

  const value = document.createElement("code");
  value.className = "swatch-hex";
  value.textContent = hex;

  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "btn-secondary swatch-copy";
  copy.textContent = "Copy";
  copy.addEventListener("click", async () => {
    await navigator.clipboard.writeText(hex);
    const old = copy.textContent;
    copy.textContent = "Copied";
    setTimeout(() => (copy.textContent = old), 800);
  });

  meta.appendChild(name);
  meta.appendChild(value);
  meta.appendChild(copy);

  item.appendChild(patch);
  item.appendChild(meta);
  return item;
}

function renderPalette() {
  dom.paletteGrid.innerHTML = "";

  const validFixed = state.fixedColors.map(normalizeHex).filter(Boolean);
  const all = [
    ...validFixed.map((hex, i) => ({ hex, label: `Fixed ${i + 1}` })),
    ...state.generated.map((c, i) => ({
      hex: c.hex,
      label: `Generated ${i + 1}`,
    })),
  ];

  if (!all.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent =
      "No colors yet. Add fixed colors and click Generate Palette.";
    dom.paletteGrid.appendChild(empty);
    return;
  }

  for (const c of all) {
    dom.paletteGrid.appendChild(cardForColor(c.hex, c.label));
  }
}

function makeFixedRow(hex, index) {
  const tpl = dom.rowTemplate;
  const node = tpl.content.firstElementChild.cloneNode(true);

  const picker = node.querySelector(".fixed-color-picker");
  const hexInput = node.querySelector(".fixed-color-hex");
  const removeBtn = node.querySelector(".fixed-color-remove");

  picker.value = hex;
  hexInput.value = hex;

  picker.addEventListener("input", () => {
    const h = normalizeHex(picker.value);
    if (!h) return;
    state.fixedColors[index] = h;
    hexInput.value = h;
    renderPalette();
  });

  hexInput.addEventListener("change", () => {
    const h = normalizeHex(hexInput.value);
    if (!h) {
      hexInput.value = state.fixedColors[index];
      return;
    }
    state.fixedColors[index] = h;
    picker.value = h;
    hexInput.value = h;
    renderPalette();
  });

  removeBtn.addEventListener("click", () => {
    state.fixedColors.splice(index, 1);
    renderFixedColors();
    renderPalette();
  });

  return node;
}

function renderFixedColors() {
  dom.fixedList.innerHTML = "";

  if (!state.fixedColors.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "No fixed colors. Click “+ Add Fixed Color”.";
    dom.fixedList.appendChild(p);
    return;
  }

  state.fixedColors.forEach((hex, i) => {
    dom.fixedList.appendChild(makeFixedRow(hex, i));
  });
}

function setStatus(text, kind = "") {
  dom.status.textContent = text;
  dom.status.classList.remove("ok", "err");
  if (kind) dom.status.classList.add(kind);
}

function setGenerating(flag) {
  state.isGenerating = flag;
  dom.generateBtn.disabled = flag;
  dom.generateBtn.textContent = flag ? "Generating..." : "Generate Palette";
}

function readParams() {
  return {
    generatedCount: clamp(
      parseInt(dom.generatedCount.value, 10) || DEFAULTS.generatedCount,
      1,
      128,
    ),
    poolSize: clamp(
      parseInt(dom.poolSize.value, 10) || DEFAULTS.poolSize,
      100,
      20000,
    ),
    refinements: clamp(
      parseInt(dom.refinements.value, 10) || DEFAULTS.refinements,
      0,
      300,
    ),
    minLightness: clamp(parseFloat(dom.minLightness.value) || 0, 0, 1),
    confusionWeight: clamp(parseFloat(dom.confusionWeight.value) || 0, 0, 3),
    seed: Math.max(0, parseInt(dom.seed.value, 10) || 0),
  };
}

async function onGenerateClick() {
  if (state.isGenerating) return;

  const params = readParams();
  const fixedHexes = state.fixedColors.map(normalizeHex).filter(Boolean);

  try {
    setGenerating(true);
    setStatus("Generating palette...");

    const t0 = performance.now();

    const result = generatePalette({
      ...params,
      fixedHexes,
    });

    state.generated = result.generated;
    renderPalette();

    const ms = Math.round(performance.now() - t0);
    setStatus(`Generated ${state.generated.length} colors in ${ms} ms.`, "ok");
  } catch (e) {
    console.error(e);
    setStatus("Generation failed. Check console for details.", "err");
  } finally {
    setGenerating(false);
  }
}

async function onCopyAllClick() {
  const validFixed = state.fixedColors.map(normalizeHex).filter(Boolean);
  const values = [...validFixed, ...state.generated.map((c) => c.hex)];
  if (!values.length) return;

  await navigator.clipboard.writeText(values.join(", "));
  const original = dom.copyAllBtn.textContent;
  dom.copyAllBtn.textContent = "Copied";
  setTimeout(() => (dom.copyAllBtn.textContent = original), 900);
}

function onDownloadClick() {
  const validFixed = state.fixedColors.map(normalizeHex).filter(Boolean);
  const payload = {
    fixed: validFixed,
    generated: state.generated.map((c) => c.hex),
    meta: {
      generatedCount: state.generated.length,
      createdAt: new Date().toISOString(),
    },
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "palette.json";
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

function addFixedColor(initial = "#000000") {
  state.fixedColors.push(normalizeHex(initial) || "#000000");
  renderFixedColors();
  renderPalette();
}

function requireDom(name, value) {
  if (!value) throw new Error(`Missing required DOM element: ${name}`);
}

function validateDom() {
  Object.entries(dom).forEach(([k, v]) => requireDom(k, v));
}

function wireEvents() {
  dom.addFixedBtn.addEventListener("click", () => addFixedColor("#FFFFFF"));
  dom.generateBtn.addEventListener("click", onGenerateClick);
  dom.copyAllBtn.addEventListener("click", onCopyAllClick);
  dom.downloadBtn.addEventListener("click", onDownloadClick);

  dom.generatedCount.value = String(DEFAULTS.generatedCount);
  dom.poolSize.value = String(DEFAULTS.poolSize);
  dom.refinements.value = String(DEFAULTS.refinements);
  dom.minLightness.value = String(DEFAULTS.minLightness);
  dom.confusionWeight.value = String(DEFAULTS.confusionWeight);
  dom.seed.value = String(DEFAULTS.seed);
}

function init() {
  validateDom();
  wireEvents();
  addFixedColor("#000000");
  renderPalette();
  setStatus("Ready.");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
