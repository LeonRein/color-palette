import {
  clamp,
  DEFAULTS,
  generatePalette,
  hexToXyY,
  normalizeHex,
  PARAM_LIMITS,
} from "./palette-core.js";

const state = {
  fixedColors: [],
  generated: [],
  isGenerating: false,
  nextFixedId: 1,
};

const dom = {
  fixedList: document.getElementById("fixedColorsList"),
  rowTemplate: document.getElementById("fixedColorRowTemplate"),
  addFixedBtn: document.getElementById("addFixedBtn"),
  generateBtn: document.getElementById("generateBtn"),
  generatedCount: document.getElementById("generatedCount"),
  poolSize: document.getElementById("poolSize"),
  refinements: document.getElementById("refinements"),
  randomRestarts: document.getElementById("randomRestarts"),
  minLightness: document.getElementById("minLightness"),
  confusionWeight: document.getElementById("confusionWeight"),
  seed: document.getElementById("seed"),
  status: document.getElementById("status"),
  paletteGrid: document.getElementById("paletteGrid"),
  xyySvg: document.getElementById("xyySvg"),
  xyyEmpty: document.getElementById("xyyEmpty"),
  copyAllBtn: document.getElementById("copyAllBtn"),
  downloadBtn: document.getElementById("downloadBtn"),
};

const SVG_NS = "http://www.w3.org/2000/svg";
const CHART_WIDTH = 420;
const CHART_HEIGHT = 300;
const CHART_PAD = { left: 44, right: 16, top: 16, bottom: 34 };
const X_RANGE = { min: 0.1, max: 0.68, step: 0.05 };
const Y_RANGE = { min: 0.02, max: 0.64, step: 0.05 };
const SRGB_PRIMARIES_XY = {
  r: [0.64, 0.33],
  g: [0.30, 0.60],
  b: [0.15, 0.06],
};

function requireDom(name, value) {
  if (!value) throw new Error(`Missing required DOM element: ${name}`);
}

function validateDom() {
  Object.entries(dom).forEach(([k, v]) => requireDom(k, v));
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

async function copyToClipboardWithFeedback(button, text, copiedText = "Copied") {
  await navigator.clipboard.writeText(text);
  const original = button.textContent;
  button.textContent = copiedText;
  setTimeout(() => {
    button.textContent = original;
  }, 900);
}

function cardForColor(hex, label = "", rgb = null) {
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

  const rgbText =
    Array.isArray(rgb) && rgb.length === 3
      ? `rgb(${rgb
          .map((v) => Math.round(clamp(Number(v), 0, 1) * 255))
          .join(", ")})`
      : "";
  const rgbValue = document.createElement("code");
  rgbValue.className = "swatch-rgb";
  rgbValue.textContent = rgbText;

  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "btn-secondary swatch-copy";
  copy.textContent = "Copy";
  copy.addEventListener("click", async () => {
    try {
      await copyToClipboardWithFeedback(copy, hex);
    } catch (e) {
      console.error(e);
      setStatus("Copy failed. Your browser may block clipboard access.", "err");
    }
  });

  meta.appendChild(name);
  meta.appendChild(value);
  if (rgbText) meta.appendChild(rgbValue);
  meta.appendChild(copy);

  item.appendChild(patch);
  item.appendChild(meta);
  return item;
}

function createSvgEl(name, attrs = {}) {
  const el = document.createElementNS(SVG_NS, name);
  Object.entries(attrs).forEach(([k, v]) => {
    el.setAttribute(k, String(v));
  });
  return el;
}

function xToPlot(x) {
  const width = CHART_WIDTH - CHART_PAD.left - CHART_PAD.right;
  const t = clamp((x - X_RANGE.min) / (X_RANGE.max - X_RANGE.min), 0, 1);
  return CHART_PAD.left + t * width;
}

function yToPlot(y) {
  const height = CHART_HEIGHT - CHART_PAD.top - CHART_PAD.bottom;
  const t = clamp((y - Y_RANGE.min) / (Y_RANGE.max - Y_RANGE.min), 0, 1);
  return CHART_HEIGHT - CHART_PAD.bottom - t * height;
}

function renderXyyVisualizer(generated, fixedHexes) {
  dom.xyySvg.innerHTML = "";

  const hasGenerated = generated.length > 0;
  const hasFixed = fixedHexes.length > 0;

  if (!hasGenerated && !hasFixed) {
    dom.xyyEmpty.hidden = false;
    return;
  }

  dom.xyyEmpty.hidden = true;

  for (let gx = X_RANGE.min; gx <= X_RANGE.max + 1e-9; gx += X_RANGE.step) {
    const x = xToPlot(gx);
    dom.xyySvg.appendChild(
      createSvgEl("line", {
        x1: x,
        y1: yToPlot(Y_RANGE.min),
        x2: x,
        y2: yToPlot(Y_RANGE.max),
        class: "xyy-grid",
      }),
    );
    dom.xyySvg.appendChild(
      createSvgEl("text", {
        x,
        y: CHART_HEIGHT - 8,
        "text-anchor": "middle",
        class: "xyy-label",
      }),
    ).textContent = gx.toFixed(1);
  }

  for (let gy = Y_RANGE.min; gy <= Y_RANGE.max + 1e-9; gy += Y_RANGE.step) {
    const y = yToPlot(gy);
    dom.xyySvg.appendChild(
      createSvgEl("line", {
        x1: xToPlot(X_RANGE.min),
        y1: y,
        x2: xToPlot(X_RANGE.max),
        y2: y,
        class: "xyy-grid",
      }),
    );
    dom.xyySvg.appendChild(
      createSvgEl("text", {
        x: 30,
        y: y + 3,
        "text-anchor": "end",
        class: "xyy-label",
      }),
    ).textContent = gy.toFixed(1);
  }

  dom.xyySvg.appendChild(
    createSvgEl("line", {
      x1: xToPlot(X_RANGE.min),
      y1: yToPlot(Y_RANGE.min),
      x2: xToPlot(X_RANGE.max),
      y2: yToPlot(Y_RANGE.min),
      class: "xyy-axis",
    }),
  );

  dom.xyySvg.appendChild(
    createSvgEl("line", {
      x1: xToPlot(X_RANGE.min),
      y1: yToPlot(Y_RANGE.min),
      x2: xToPlot(X_RANGE.min),
      y2: yToPlot(Y_RANGE.max),
      class: "xyy-axis",
    }),
  );

  dom.xyySvg.appendChild(
    createSvgEl("text", {
      x: xToPlot(X_RANGE.max),
      y: CHART_HEIGHT - 8,
      "text-anchor": "end",
      class: "xyy-label",
    }),
  ).textContent = "x";

  dom.xyySvg.appendChild(
    createSvgEl("text", {
      x: 14,
      y: yToPlot(Y_RANGE.max),
      "text-anchor": "start",
      class: "xyy-label",
    }),
  ).textContent = "y";

  const gamutPoints = [
    SRGB_PRIMARIES_XY.r,
    SRGB_PRIMARIES_XY.g,
    SRGB_PRIMARIES_XY.b,
  ]
    .map(([x, y]) => `${xToPlot(x)},${yToPlot(y)}`)
    .join(" ");

  dom.xyySvg.appendChild(
    createSvgEl("polygon", {
      points: gamutPoints,
      class: "xyy-gamut",
    }),
  );

  fixedHexes.forEach((hex, i) => {
    const p = hexToXyY(hex);
    if (!p) return;
    const cx = xToPlot(p.x);
    const cy = yToPlot(p.y);
    const r = 4 + 8 * clamp(p.Y, 0, 1);
    const d = `M ${cx} ${cy - r} L ${cx + r} ${cy} L ${cx} ${cy + r} L ${cx - r} ${cy} Z`;

    const point = createSvgEl("path", {
      d,
      fill: p.hex,
      class: "xyy-point xyy-point-fixed",
    });

    const title = createSvgEl("title");
    title.textContent = `Fixed ${i + 1}: ${p.hex} | x=${p.x.toFixed(3)}, y=${p.y.toFixed(3)}, Y=${p.Y.toFixed(3)}`;
    point.appendChild(title);
    dom.xyySvg.appendChild(point);
  });

  generated.forEach((color, i) => {
    const p = hexToXyY(color.hex);
    if (!p) return;
    const cx = xToPlot(p.x);
    const cy = yToPlot(p.y);
    const r = 4 + 8 * clamp(p.Y, 0, 1);

    const point = createSvgEl("circle", {
      cx,
      cy,
      r,
      fill: color.hex,
      class: "xyy-point",
    });

    const title = createSvgEl("title");
    title.textContent = `Generated ${i + 1}: ${color.hex} | x=${p.x.toFixed(3)}, y=${p.y.toFixed(3)}, Y=${p.Y.toFixed(3)}`;
    point.appendChild(title);
    dom.xyySvg.appendChild(point);
  });

  const legendX = xToPlot(X_RANGE.max) - 120;
  const legendY = yToPlot(Y_RANGE.max) + 18;

  if (hasGenerated) {
    const genSwatch = createSvgEl("circle", {
      cx: legendX,
      cy: legendY,
      r: 5,
      fill: "#9fbcff",
      class: "xyy-point",
    });
    dom.xyySvg.appendChild(genSwatch);
    dom.xyySvg.appendChild(
      createSvgEl("text", {
        x: legendX + 10,
        y: legendY + 3,
        class: "xyy-label",
      }),
    ).textContent = "Generated";
  }

  if (hasFixed) {
    const fy = legendY + (hasGenerated ? 16 : 0);
    const d = `M ${legendX} ${fy - 5} L ${legendX + 5} ${fy} L ${legendX} ${fy + 5} L ${legendX - 5} ${fy} Z`;
    const fixedSwatch = createSvgEl("path", {
      d,
      fill: "#8de5ff",
      class: "xyy-point xyy-point-fixed",
    });
    dom.xyySvg.appendChild(fixedSwatch);
    dom.xyySvg.appendChild(
      createSvgEl("text", {
        x: legendX + 10,
        y: fy + 3,
        class: "xyy-label",
      }),
    ).textContent = "Fixed anchor";
  }
}

function renderPalette() {
  dom.paletteGrid.innerHTML = "";

  const generated = state.generated.map((c, i) => ({
    hex: c.hex,
    rgb: c.rgb,
    label: `Generated ${i + 1}`,
  }));
  const fixedHexes = state.fixedColors
    .map((item) => normalizeHex(item.hex))
    .filter(Boolean);

  if (!generated.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent =
      "Click Generate Palette to create your first set of colors.";
    dom.paletteGrid.appendChild(empty);
    renderXyyVisualizer([], fixedHexes);
    return;
  }

  for (const c of generated) {
    dom.paletteGrid.appendChild(cardForColor(c.hex, c.label, c.rgb));
  }

  renderXyyVisualizer(generated, fixedHexes);
}

function findFixedColorIndex(id) {
  return state.fixedColors.findIndex((item) => item.id === id);
}

function updateFixedColor(id, nextHex) {
  const idx = findFixedColorIndex(id);
  if (idx < 0) return;
  state.fixedColors[idx].hex = nextHex;
}

function makeFixedRow(item) {
  const node = dom.rowTemplate.content.firstElementChild.cloneNode(true);
  node.dataset.fixedId = String(item.id);

  const picker = node.querySelector(".fixed-color-picker");
  const hexInput = node.querySelector(".fixed-color-hex");
  const removeBtn = node.querySelector(".fixed-color-remove");

  picker.value = item.hex;
  hexInput.value = item.hex;

  picker.addEventListener("input", () => {
    const h = normalizeHex(picker.value);
    if (!h) return;
    updateFixedColor(item.id, h);
    hexInput.value = h;
    renderPalette();
  });

  hexInput.addEventListener("change", () => {
    const h = normalizeHex(hexInput.value);
    if (!h) {
      const idx = findFixedColorIndex(item.id);
      hexInput.value = idx >= 0 ? state.fixedColors[idx].hex : item.hex;
      return;
    }
    updateFixedColor(item.id, h);
    picker.value = h;
    hexInput.value = h;
    renderPalette();
  });

  removeBtn.addEventListener("click", () => {
    const idx = findFixedColorIndex(item.id);
    if (idx < 0) return;
    state.fixedColors.splice(idx, 1);
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
    p.textContent = "No fixed colors. Click \u201c+ Add Fixed Color\u201d.";
    dom.fixedList.appendChild(p);
    return;
  }

  state.fixedColors.forEach((item) => {
    dom.fixedList.appendChild(makeFixedRow(item));
  });
}

function applyNumericInputConfig(input, limits, defaultValue) {
  input.min = String(limits.min);
  if (Number.isFinite(limits.max)) {
    input.max = String(limits.max);
  }
  input.step = String(limits.step);
  input.value = String(defaultValue);
}

function readBoundedInt(input, defaultValue, limits) {
  const parsed = Number.parseInt(input.value, 10);
  const value = Number.isFinite(parsed) ? parsed : defaultValue;
  return clamp(value, limits.min, limits.max);
}

function readBoundedFloat(input, defaultValue, limits) {
  const parsed = Number.parseFloat(input.value);
  const value = Number.isFinite(parsed) ? parsed : defaultValue;
  return clamp(value, limits.min, limits.max);
}

function readParams() {
  return {
    generatedCount: readBoundedInt(
      dom.generatedCount,
      DEFAULTS.generatedCount,
      PARAM_LIMITS.generatedCount,
    ),
    poolSize: readBoundedInt(dom.poolSize, DEFAULTS.poolSize, PARAM_LIMITS.poolSize),
    refinements: readBoundedInt(
      dom.refinements,
      DEFAULTS.refinements,
      PARAM_LIMITS.refinements,
    ),
    randomRestarts: readBoundedInt(
      dom.randomRestarts,
      DEFAULTS.randomRestarts,
      PARAM_LIMITS.randomRestarts,
    ),
    minLightness: readBoundedFloat(
      dom.minLightness,
      DEFAULTS.minLightness,
      PARAM_LIMITS.minLightness,
    ),
    confusionWeight: readBoundedFloat(
      dom.confusionWeight,
      DEFAULTS.confusionWeight,
      PARAM_LIMITS.confusionWeight,
    ),
    seed: readBoundedInt(dom.seed, DEFAULTS.seed, PARAM_LIMITS.seed),
  };
}

async function onGenerateClick() {
  if (state.isGenerating) return;

  const params = readParams();
  const fixedHexes = state.fixedColors.map((item) => normalizeHex(item.hex)).filter(Boolean);

  try {
    setGenerating(true);
    setStatus("Generating palette...");

    const t0 = performance.now();

    let result;
    if (params.seed === -1) {
      let best = null;
      for (let i = 0; i < params.randomRestarts; i++) {
        const trialSeed = Math.floor(Math.random() * 0x100000000);
        const trial = generatePalette({
          ...params,
          seed: trialSeed,
          fixedHexes,
        });
        if (!best || trial.score > best.score) {
          best = trial;
        }
      }
      result = best;
    } else {
      result = generatePalette({
        ...params,
        seed: params.seed,
        fixedHexes,
      });
    }

    state.generated = result.generated;
    renderPalette();

    const ms = Math.round(performance.now() - t0);
    const restartText =
      params.seed === -1
        ? ` (best of ${params.randomRestarts} random starts)`
        : "";
    setStatus(`Generated ${state.generated.length} colors in ${ms} ms${restartText}.`, "ok");
  } catch (e) {
    console.error(e);
    setStatus("Generation failed. Check console for details.", "err");
  } finally {
    setGenerating(false);
  }
}

async function onCopyAllClick() {
  const values = state.generated.map((c) => c.hex);
  if (!values.length) return;

  try {
    await copyToClipboardWithFeedback(dom.copyAllBtn, values.join(", "));
    setStatus(`Copied ${values.length} colors to clipboard.`, "ok");
  } catch (e) {
    console.error(e);
    setStatus("Copy failed. Your browser may block clipboard access.", "err");
  }
}

function onDownloadClick() {
  const fixed = state.fixedColors.map((item) => normalizeHex(item.hex)).filter(Boolean);
  const generated = state.generated.map((c) => c.hex);

  const payload = {
    fixed,
    generated,
    meta: {
      fixedCount: fixed.length,
      generatedCount: generated.length,
      totalCount: fixed.length + generated.length,
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
  const hex = normalizeHex(initial) || "#000000";
  state.fixedColors.push({ id: state.nextFixedId++, hex });
  renderFixedColors();
  renderPalette();
}

function wireEvents() {
  dom.addFixedBtn.addEventListener("click", () => addFixedColor("#FFFFFF"));
  dom.generateBtn.addEventListener("click", onGenerateClick);
  dom.copyAllBtn.addEventListener("click", onCopyAllClick);
  dom.downloadBtn.addEventListener("click", onDownloadClick);

  applyNumericInputConfig(
    dom.generatedCount,
    PARAM_LIMITS.generatedCount,
    DEFAULTS.generatedCount,
  );
  applyNumericInputConfig(dom.poolSize, PARAM_LIMITS.poolSize, DEFAULTS.poolSize);
  applyNumericInputConfig(
    dom.refinements,
    PARAM_LIMITS.refinements,
    DEFAULTS.refinements,
  );
  applyNumericInputConfig(
    dom.randomRestarts,
    PARAM_LIMITS.randomRestarts,
    DEFAULTS.randomRestarts,
  );
  applyNumericInputConfig(
    dom.minLightness,
    PARAM_LIMITS.minLightness,
    DEFAULTS.minLightness,
  );
  applyNumericInputConfig(
    dom.confusionWeight,
    PARAM_LIMITS.confusionWeight,
    DEFAULTS.confusionWeight,
  );
  applyNumericInputConfig(dom.seed, PARAM_LIMITS.seed, DEFAULTS.seed);
}

export function initApp() {
  validateDom();
  wireEvents();
  addFixedColor("#000000");
  renderPalette();
  setStatus("Ready.");
}
