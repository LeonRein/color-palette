import {
  clamp,
  DEFAULTS,
  generatePalette,
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
  minLightness: document.getElementById("minLightness"),
  confusionWeight: document.getElementById("confusionWeight"),
  seed: document.getElementById("seed"),
  status: document.getElementById("status"),
  paletteGrid: document.getElementById("paletteGrid"),
  copyAllBtn: document.getElementById("copyAllBtn"),
  downloadBtn: document.getElementById("downloadBtn"),
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
    try {
      await copyToClipboardWithFeedback(copy, hex);
    } catch (e) {
      console.error(e);
      setStatus("Copy failed. Your browser may block clipboard access.", "err");
    }
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

  const generated = state.generated.map((c, i) => ({
    hex: c.hex,
    label: `Generated ${i + 1}`,
  }));

  if (!generated.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent =
      "No generated colors yet. Add fixed colors if needed, then click Generate Palette.";
    dom.paletteGrid.appendChild(empty);
    return;
  }

  for (const c of generated) {
    dom.paletteGrid.appendChild(cardForColor(c.hex, c.label));
  }
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
  const effectiveSeed =
    params.seed === -1
      ? Math.floor(Math.random() * 0x100000000)
      : params.seed;
  const fixedHexes = state.fixedColors.map((item) => normalizeHex(item.hex)).filter(Boolean);

  try {
    setGenerating(true);
    setStatus("Generating palette...");

    const t0 = performance.now();

    const result = generatePalette({
      ...params,
      seed: effectiveSeed,
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
