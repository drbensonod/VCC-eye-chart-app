/* ============================================================
   VCC Vision Screening App â Main Controller
   ============================================================ */

const state = {
  settings: loadSettings() || defaultSettings(),
  calibration: loadCalibration(),
  currentChart: [],      // current letters on screen (array of arrays, one per line)
  currentLevels: [],     // acuity levels matching currentChart lines
  lastDoubleTapTime: 0,
  singleModeLevelIndex: null, // index into the current level series; null = not yet initialized for this distance/mode
  stackedRangeOffset: 0,      // how far into the level series the stacked/column chart starts (0 = largest that fits)
  duochromeLetters: null,     // fixed letter set shown on both duochrome halves; null until first generated
  oknLevelIndex: 0,           // index into OKN_LEVELS; 0 = coarsest (20/200-equivalent)
};

const el = {
  calibrationScreen: null,
  mainScreen: null,
  stimulusArea: null,
  marginLabel: null,
  menuDrawer: null,
  versionTag: null,
};

async function init() {
  el.calibrationScreen = document.getElementById("calibration-screen");
  el.mainScreen = document.getElementById("main-screen");
  el.stimulusArea = document.getElementById("stimulus-area");
  el.marginLabel = document.getElementById("margin-label");
  el.menuDrawer = document.getElementById("menu-drawer");
  el.versionTag = document.getElementById("version-tag");
  el.versionTag.textContent = `v${APP_VERSION}`;

  document.getElementById("reset-home-btn").addEventListener("click", resetToHome);
  document.getElementById("recalibrate-btn").addEventListener("click", showCalibrationScreen);
  document.getElementById("validation-mode-btn").addEventListener("click", showValidationScreen);
  document.getElementById("close-validation-btn").addEventListener("click", hideValidationScreen);

  setupMenuControls();
  setupGestures();
  setupCalibrationScreen();

  requestWakeLockAndBrightness();

  // Critical: wait for the real Optician Sans font to finish loading
  // before ANY font-metric measurement or chart render happens.
  // Custom web fonts don't load instantly â measuring or rendering
  // too early silently falls back to a system font with different
  // proportions, causing a systematic (but hard-to-notice) sizing
  // error once the real font swaps in afterward. This is what the
  // v7 validation testing caught (~20-27% consistent under-sizing).
  await ensureOpticianSansLoaded();

  if (state.calibration && state.calibration.pxPerMM) {
    showMainScreen();
  } else {
    showCalibrationScreen();
  }
}

/** Explicitly forces the browser to load the custom optotype font
 *  and waits for confirmation, rather than assuming it's ready. */
async function ensureOpticianSansLoaded() {
  if (!("fonts" in document)) return; // very old Safari fallback â proceeds without the guarantee
  try {
    await document.fonts.load(`200px ${OPTOTYPE_FONT_FAMILY}`);
    await document.fonts.ready;
  } catch (e) {
    console.warn("Font load check failed, proceeding anyway:", e);
  }
}

/* ---------------- Screen switching ---------------- */

function showCalibrationScreen() {
  el.calibrationScreen.classList.remove("hidden");
  el.mainScreen.classList.add("hidden");
}

function showMainScreen() {
  el.calibrationScreen.classList.add("hidden");
  el.mainScreen.classList.remove("hidden");
  measureFontHeightRatio();
  renderCurrentChart();
}

function resetToHome() {
  // Crash/error recovery: collapses any open UI state and
  // redraws the chart fresh, without touching calibration or
  // settings â a safe "get back to a known-good state" action.
  el.menuDrawer.classList.remove("open");
  closeValidationScreen_ifOpen();
  if (state.calibration && state.calibration.pxPerMM) {
    showMainScreen();
  } else {
    showCalibrationScreen();
  }
}

function closeValidationScreen_ifOpen() {
  const v = document.getElementById("validation-screen");
  if (v) v.classList.add("hidden");
}

/* ---------------- Calibration (Option B: physical object match) ---------------- */

const CREDIT_CARD_WIDTH_MM = 85.60; // ISO/IEC 7810 ID-1 standard

function setupCalibrationScreen() {
  const slider = document.getElementById("cal-slider");
  const guide = document.getElementById("cal-guide-box");
  const confirmBtn = document.getElementById("cal-confirm-btn");

  slider.addEventListener("input", () => {
    const widthPx = parseFloat(slider.value);
    guide.style.width = `${widthPx}px`;
  });

  confirmBtn.addEventListener("click", () => {
    const widthPx = parseFloat(slider.value);
    const pxPerMM = widthPx / CREDIT_CARD_WIDTH_MM;
    saveCalibration(pxPerMM);
    state.calibration = { pxPerMM, calibratedAt: Date.now() };
    showMainScreen();
  });

  // Reasonable default starting width so the slider isn't at zero.
  slider.value = 320;
  guide.style.width = "320px";
}

/* ---------------- Distance & chart state ---------------- */

function getCurrentDistanceInches() {
  if (state.settings.lastDistanceId === "custom" && state.settings.lastCustomDistanceInches) {
    return state.settings.lastCustomDistanceInches;
  }
  const found = BENCHMARK_DISTANCES.find((d) => d.id === state.settings.lastDistanceId);
  return found ? found.inches : 120; // default 10ft
}

function isCurrentDistanceNearPoint() {
  const found = BENCHMARK_DISTANCES.find((d) => d.id === state.settings.lastDistanceId);
  return found ? found.isNearPoint : false;
}

function renderCurrentChart() {
  if (!state.calibration) return;
  const pxPerMM = state.calibration.pxPerMM;
  const distanceInches = getCurrentDistanceInches();
  const nearPoint = isCurrentDistanceNearPoint();

  if (state.settings.activeTest === "duochrome") {
    renderDuochromeMode(pxPerMM, distanceInches);
    return;
  }
  if (state.settings.activeTest === "fixation") {
    renderFixationMode(pxPerMM);
    return;
  }
  if (state.settings.activeTest === "okn") {
    renderOKNMode(pxPerMM);
    return;
  }

  const chartType = CHART_TYPES[state.settings.lastChartType];
  const chartTypeId = state.settings.lastChartType;
  const screenH = el.stimulusArea.clientHeight;
  const screenW = el.stimulusArea.clientWidth;
  const series = getLevelSeries(nearPoint);

  const mode = state.settings.lastDisplayMode;

  if (mode === "single-letter" || mode === "single-line") {
    const requiredCount = mode === "single-line" ? (chartType.lettersPerLine || 5) : 1;
    if (state.singleModeLevelIndex === null) {
      // First render in this mode/distance: start at the largest
      // size that actually fits the screen, so "swipe down" from
      // the start immediately shows meaningful headroom.
      state.singleModeLevelIndex = findLargestFittingIndex(
        series, chartTypeId, distanceInches, screenW, screenH, pxPerMM, nearPoint, requiredCount
      );
    }
    const idx = Math.min(state.singleModeLevelIndex, series.length - 1);
    const levelEntry = series[idx];
    const factor = factorForLevel(levelEntry, nearPoint, distanceInches);
    const heightPx = optotypeHeightMM(distanceInches, factor) * pxPerMM;
    const label = labelForLevel(levelEntry, nearPoint);

    if (mode === "single-letter") {
      const letter = generateLine(chartType.letters, 1)[0];
      state.currentChart = [[letter]];
      renderSingleLetter(el.stimulusArea, letter, heightPx, state.settings.lastContrastId, chartTypeId);
    } else {
      const letters = generateLine(chartType.letters, requiredCount);
      state.currentChart = [letters];
      renderSingleLine(el.stimulusArea, letters, heightPx, state.settings.lastContrastId, chartTypeId);
    }
    el.marginLabel.textContent = label;
  } else if (mode === "stacked") {
    const levels = buildStackedLevels(chartTypeId, distanceInches, screenH, screenW, pxPerMM, nearPoint, state.stackedRangeOffset);
    const lineSpecs = levels.map((lvl) => ({ count: lvl.count }));
    const chart = generateFullChart(chartType.letters, lineSpecs);
    state.currentChart = chart;
    const labels = levels.map((l) => l.label);
    renderStackedLines(el.stimulusArea, chart, levels, chartType.letters, state.settings.lastContrastId, labels, chartTypeId);
    el.marginLabel.textContent = "";
  } else if (mode === "column") {
    const levels = buildStackedLevels(chartTypeId, distanceInches, screenH, screenW, pxPerMM, nearPoint, state.stackedRangeOffset);
    const letters = levels.map(() => pickLetterNoRepeat(chartType.letters, null));
    state.currentChart = [letters];
    const labels = levels.map((l) => l.label);
    renderVerticalColumn(el.stimulusArea, letters, levels.map((l) => l.heightPx), state.settings.lastContrastId, labels, chartTypeId);
    el.marginLabel.textContent = "";
  }
}

/* ---------------- Fixation target mode ---------------- */

function renderFixationMode(pxPerMM) {
  const diameterPx = FIXATION_CIRCLE_DIAMETER_IN * IN_TO_MM * pxPerMM;
  renderFixationTarget(el.stimulusArea, diameterPx);
  el.marginLabel.textContent = "";
}

/* ---------------- OKN drum mode ---------------- */

function renderOKNMode(pxPerMM) {
  const idx = Math.min(Math.max(state.oknLevelIndex, 0), OKN_LEVELS.length - 1);
  const level = OKN_LEVELS[idx];
  const cycleWidthMM = oknCycleWidthMM(OKN_VIEWING_DISTANCE_IN, level.cpd);
  const cycleWidthPx = cycleWidthMM * pxPerMM;
  const durationSec = 1 / OKN_TEMPORAL_FREQUENCY_HZ; // constant across all levels, see state.js note
  renderOKN(el.stimulusArea, cycleWidthPx, durationSec);
  el.marginLabel.textContent = `${level.snellen}-equiv \u00b7 ${level.cpd} cpd`;
}

/* ---------------- Duochrome mode ---------------- */

const DUOCHROME_ACUITY_FACTOR = 2; // fixed ~20/40-equivalent size â a "moderate" refraction-refinement size, not tied to the acuity-testing level system
const DUOCHROME_LETTER_COUNT = 3;

function renderDuochromeMode(pxPerMM, distanceInches) {
  if (!state.duochromeLetters) {
    state.duochromeLetters = generateLine(SNELLEN_LETTERS, DUOCHROME_LETTER_COUNT);
  }
  const heightPx = optotypeHeightMM(distanceInches, DUOCHROME_ACUITY_FACTOR) * pxPerMM;
  renderDuochrome(el.stimulusArea, state.duochromeLetters, heightPx);
  el.marginLabel.textContent = "";
}

function cycleDuochromeLetters() {
  state.duochromeLetters = generateLine(SNELLEN_LETTERS, DUOCHROME_LETTER_COUNT);
  renderCurrentChart();
}

/* ---------------- Manual size stepping ---------------- */
// Single-letter / single-line: swipe steps through individual acuity
// levels one at a time. Stacked / column: swipe shifts which portion
// of the range is displayed (since those modes already show many
// sizes at once).

function decreaseSize() {
  // Swipe up: move toward SMALLER (finer/harder) sizes.
  if (state.settings.activeTest === "okn") {
    if (state.oknLevelIndex < OKN_LEVELS.length - 1) {
      state.oknLevelIndex += 1;
      renderCurrentChart();
    }
    return;
  }
  const mode = state.settings.lastDisplayMode;
  if (mode === "single-letter" || mode === "single-line") {
    const nearPoint = isCurrentDistanceNearPoint();
    const series = getLevelSeries(nearPoint);
    if (state.singleModeLevelIndex === null) state.singleModeLevelIndex = 0;
    if (state.singleModeLevelIndex < series.length - 1) {
      state.singleModeLevelIndex += 1;
      renderCurrentChart();
    }
  } else if (mode === "stacked" || mode === "column") {
    const nearPoint = isCurrentDistanceNearPoint();
    const series = getLevelSeries(nearPoint);
    if (state.stackedRangeOffset < series.length - 1) {
      state.stackedRangeOffset += 1;
      renderCurrentChart();
    }
  }
}

function increaseSize() {
  // Swipe down: move toward LARGER (coarser/easier) sizes.
  if (state.settings.activeTest === "okn") {
    if (state.oknLevelIndex > 0) {
      state.oknLevelIndex -= 1;
      renderCurrentChart();
    }
    return;
  }
  const mode = state.settings.lastDisplayMode;
  if (mode === "single-letter" || mode === "single-line") {
    const nearPoint = isCurrentDistanceNearPoint();
    const series = getLevelSeries(nearPoint);
    const chartTypeId = state.settings.lastChartType;
    const requiredCount = mode === "single-line" ? (CHART_TYPES[chartTypeId].lettersPerLine || 5) : 1;
    const distanceInches = getCurrentDistanceInches();
    const pxPerMM = state.calibration.pxPerMM;
    const screenW = el.stimulusArea.clientWidth;
    const screenH = el.stimulusArea.clientHeight;
    const maxIndex = findLargestFittingIndex(series, chartTypeId, distanceInches, screenW, screenH, pxPerMM, nearPoint, requiredCount);
    if (state.singleModeLevelIndex === null) state.singleModeLevelIndex = maxIndex;
    if (state.singleModeLevelIndex > maxIndex) {
      state.singleModeLevelIndex -= 1;
      renderCurrentChart();
    }
  } else if (mode === "stacked" || mode === "column") {
    if (state.stackedRangeOffset > 0) {
      state.stackedRangeOffset -= 1;
      renderCurrentChart();
    }
  }
}

/** Resets manual size-stepping state â called whenever distance,
 *  chart type, or display mode changes, since the previous index
 *  may no longer be meaningful (near vs far use different series
 *  entirely, and ETDRS vs Snellen fit differently). */
function resetSizeStepping() {
  state.singleModeLevelIndex = null;
  state.stackedRangeOffset = 0;
}

/* ---------------- Cycling (double-tap) ---------------- */

function cycleCurrentChart() {
  if (state.settings.activeTest === "duochrome") {
    cycleDuochromeLetters();
    return;
  }
  if (state.settings.activeTest === "okn" || state.settings.activeTest === "fixation") {
    return; // no letters to cycle in these modes
  }
  const mode = state.settings.lastDisplayMode;
  const chartType = CHART_TYPES[state.settings.lastChartType];
  if (mode === "stacked") {
    // Regenerate the WHOLE chart at once, per spec.
    const pxPerMM = state.calibration.pxPerMM;
    const distanceInches = getCurrentDistanceInches();
    const nearPoint = isCurrentDistanceNearPoint();
    const levels = buildStackedLevels(state.settings.lastChartType, distanceInches, el.stimulusArea.clientHeight, el.stimulusArea.clientWidth, pxPerMM, nearPoint, state.stackedRangeOffset);
    const lineSpecs = levels.map((lvl) => ({ count: lvl.count }));
    state.currentChart = generateFullChart(chartType.letters, lineSpecs);
    const labels = levels.map((l) => l.label);
    renderStackedLines(el.stimulusArea, state.currentChart, levels, chartType.letters, state.settings.lastContrastId, labels, state.settings.lastChartType);
  } else {
    // Single-letter, single-line, column: regenerate in place at current sizes.
    renderCurrentChart();
  }
}

/* ---------------- Gestures ---------------- */

function setupGestures() {
  el.stimulusArea.addEventListener("dblclick", cycleCurrentChart);

  let lastTouchTime = 0;
  el.stimulusArea.addEventListener("touchend", () => {
    const now = Date.now();
    if (now - lastTouchTime < 300) {
      cycleCurrentChart();
    }
    lastTouchTime = now;
  });

  // Edge-swipe to open menu (right edge), and vertical swipe on the
  // stimulus area to step optotype size up/down one line at a time
  // (single-letter / single-line modes only â see decreaseSize/increaseSize).
  let touchStartX = null;
  let touchStartY = null;
  document.addEventListener("touchstart", (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  });
  document.addEventListener("touchend", (e) => {
    if (touchStartX === null) return;
    const touch = (e.changedTouches && e.changedTouches[0]) || null;
    const endX = touch ? touch.clientX : touchStartX;
    const endY = touch ? touch.clientY : touchStartY;
    const deltaX = touchStartX - endX;
    const deltaY = touchStartY - endY;
    const startedNearRightEdge = touchStartX > window.innerWidth - 40;
    const SWIPE_THRESHOLD = 50;

    if (startedNearRightEdge && deltaX > 60 && Math.abs(deltaX) > Math.abs(deltaY)) {
      openMenu();
    } else if (Math.abs(deltaY) > SWIPE_THRESHOLD && Math.abs(deltaY) > Math.abs(deltaX)) {
      if (deltaY > 0) {
        decreaseSize(); // finger moved up -> smaller optotype
      } else {
        increaseSize(); // finger moved down -> larger optotype
      }
    }
    touchStartX = null;
    touchStartY = null;
  });

  document.getElementById("menu-tab").addEventListener("click", openMenu);
  document.getElementById("menu-close-btn").addEventListener("click", closeMenu);
}

function openMenu() {
  el.menuDrawer.classList.add("open");
}
function closeMenu() {
  el.menuDrawer.classList.remove("open");
  // Per spec: menu can be seen briefly, but screen returns to a
  // clean field with only the stimulus after adjustment.
  renderCurrentChart();
}

/* ---------------- Menu controls ---------------- */

function setupMenuControls() {
  const clearRefractionTestButtons = () => {
    document.getElementById("duochrome-btn").classList.remove("selected");
    document.getElementById("fixation-btn").classList.remove("selected");
    document.getElementById("okn-btn").classList.remove("selected");
  };

  // Chart type
  document.querySelectorAll("[data-chart-type]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.settings.activeTest = "chart";
      state.settings.lastChartType = btn.dataset.chartType;
      persistSettings();
      resetSizeStepping();
      renderCurrentChart();
      highlightSelected("[data-chart-type]", btn);
      clearRefractionTestButtons();
    });
  });

  // Display mode
  document.querySelectorAll("[data-display-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.settings.activeTest = "chart";
      state.settings.lastDisplayMode = btn.dataset.displayMode;
      persistSettings();
      resetSizeStepping();
      renderCurrentChart();
      highlightSelected("[data-display-mode]", btn);
      clearRefractionTestButtons();
    });
  });

  // Duochrome test toggle
  document.getElementById("duochrome-btn").addEventListener("click", (e) => {
    state.settings.activeTest = "duochrome";
    persistSettings();
    renderCurrentChart();
    clearRefractionTestButtons();
    e.target.classList.add("selected");
  });

  // Fixation target toggle
  document.getElementById("fixation-btn").addEventListener("click", (e) => {
    state.settings.activeTest = "fixation";
    persistSettings();
    renderCurrentChart();
    clearRefractionTestButtons();
    e.target.classList.add("selected");
  });

  // OKN drum toggle
  document.getElementById("okn-btn").addEventListener("click", (e) => {
    state.settings.activeTest = "okn";
    state.oknLevelIndex = 0;
    persistSettings();
    renderCurrentChart();
    clearRefractionTestButtons();
    e.target.classList.add("selected");
  });

  // Contrast
  document.querySelectorAll("[data-contrast]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.settings.lastContrastId = btn.dataset.contrast;
      persistSettings();
      renderCurrentChart();
      highlightSelected("[data-contrast]", btn);
    });
  });

  // Distance â benchmarks
  document.querySelectorAll("[data-distance]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.settings.lastDistanceId = btn.dataset.distance;
      persistSettings();
      resetSizeStepping();
      renderCurrentChart();
      highlightSelected("[data-distance]", btn);
    });
  });

  // Custom distance input
  const customInput = document.getElementById("custom-distance-input");
  document.getElementById("custom-distance-apply").addEventListener("click", () => {
    const val = parseFloat(customInput.value);
    if (!isNaN(val) && val > 0) {
      state.settings.lastDistanceId = "custom";
      state.settings.lastCustomDistanceInches = val;
      persistSettings();
      resetSizeStepping();
      renderCurrentChart();
    }
  });
}

function highlightSelected(selector, activeBtn) {
  document.querySelectorAll(selector).forEach((b) => b.classList.remove("selected"));
  activeBtn.classList.add("selected");
}

function persistSettings() {
  saveSettings(state.settings);
}

/* ---------------- Validation / self-test mode ---------------- */

function showValidationScreen() {
  const screen = document.getElementById("validation-screen");
  screen.classList.remove("hidden");
  closeMenu();
  renderValidationTable();
}

function hideValidationScreen() {
  document.getElementById("validation-screen").classList.add("hidden");
}

function renderValidationTable() {
  const container = document.getElementById("validation-table-body");
  container.innerHTML = "";
  const pxPerMM = state.calibration.pxPerMM;
  const distanceInches = getCurrentDistanceInches();
  const nearPoint = isCurrentDistanceNearPoint();
  const series = getLevelSeries(nearPoint);

  series.forEach((levelEntry) => {
    const factor = factorForLevel(levelEntry, nearPoint, distanceInches);
    const heightMM = optotypeHeightMM(distanceInches, factor);
    const row = document.createElement("div");
    row.className = "validation-row";
    row.innerHTML = `
      <span class="val-label">${labelForLevel(levelEntry, nearPoint)}</span>
      <span class="val-optotype" style="font-size:${fontSizeForHeightPx(heightMM * pxPerMM)}px">C</span>
      <span class="val-expected">Expected: ${heightMM.toFixed(2)} mm</span>
    `;
    container.appendChild(row);
  });
}

/* ---------------- Brightness / wake lock ---------------- */

let wakeLockRef = null;
async function requestWakeLockAndBrightness() {
  try {
    if ("wakeLock" in navigator) {
      wakeLockRef = await navigator.wakeLock.request("screen");
    }
  } catch (e) {
    // Non-fatal: brightness/wake-lock APIs vary across iOS Safari
    // versions. The app still functions; screen may dim on its own
    // per the device's normal auto-lock settings.
    console.warn("Wake lock unavailable:", e);
  }
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "visible" && "wakeLock" in navigator) {
      try {
        wakeLockRef = await navigator.wakeLock.request("screen");
      } catch (e) {}
    }
  });
}

document.addEventListener("DOMContentLoaded", init);
