/* ============================================================
   VCC Vision Screening App — Chart Rendering Engine
   ============================================================ */

const OPTOTYPE_FONT_FAMILY = "OpticianSans";

// Measured once per session: ratio of actual rendered cap height
// to the CSS font-size used to render it. Fonts don't fill their
// full em box, so we measure Optician Sans directly rather than
// assume a ratio — this is what makes the physical-mm sizing
// promise (Section 3 of the spec) actually true on screen.
let _fontHeightRatio = null;

function measureFontHeightRatio() {
  const refSize = 200; // px — large enough for sub-pixel accuracy, cheap to measure
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  ctx.font = `${refSize}px ${OPTOTYPE_FONT_FAMILY}`;
  // "H" is a full-height, flat-top/flat-bottom glyph — a reliable
  // reference for cap-height across the Sloan/Snellen letter sets.
  const metrics = ctx.measureText("H");
  const measuredHeight =
    (metrics.actualBoundingBoxAscent || 0) + (metrics.actualBoundingBoxDescent || 0);
  _fontHeightRatio = measuredHeight / refSize;
  return _fontHeightRatio;
}

/** Converts a target physical cap-height in px into the CSS font-size needed. */
function fontSizeForHeightPx(targetHeightPx) {
  if (!_fontHeightRatio) measureFontHeightRatio();
  return targetHeightPx / _fontHeightRatio;
}

/**
 * Returns the "size" value each render/measurement call site should
 * use: for font-based optotypes (Snellen/ETDRS/HOTV/Numbers) that's
 * the font-size needed to achieve the target physical height (since
 * glyphs don't fill their full em-box). For Landolt C — a directly
 * drawn vector shape with no font em-box quirk — the target height
 * IS the rendered size, exactly, with no conversion needed.
 */
function effectiveOptotypeSizePx(chartTypeId, heightPx) {
  return chartTypeId === "landolt" ? heightPx : fontSizeForHeightPx(heightPx);
}

/**
 * Creates the actual visual node for one optotype — a text span for
 * font-based charts, or an SVG ring for Landolt C — so every render
 * function can stay agnostic to which kind of chart is active.
 */
function makeOptotypeNode(content, sizePx, colorCss, chartTypeId) {
  if (chartTypeId === "landolt") {
    const svg = createLandoltCElement(sizePx, content.angleDeg, colorCss);
    svg.classList.add("optotype-svg");
    return svg;
  }
  const span = document.createElement("span");
  span.className = "optotype";
  span.style.fontSize = `${sizePx}px`;
  span.style.color = colorCss;
  span.textContent = content;
  return span;
}

// Cache of max-character-width-to-font-size ratio, keyed by chart
// type, so width-fit math doesn't re-measure the canvas every call.
const _charWidthRatioCache = {}; // worst-case (widest letter) — used for ETDRS
const _avgCharWidthRatioCache = {}; // average — used for Snellen (looser validity requirement, so a rare tight fit is an acceptable tradeoff for meaningfully bigger usable sizes)

/**
 * Measures the WIDEST letter in a given optotype set (worst case,
 * so any random letter combination is guaranteed to fit) and
 * returns its width as a ratio of font-size.
 */
function measureMaxCharWidthRatio(chartTypeId, letterSet) {
  if (chartTypeId === "landolt") return 1.0; // exact square bounding box, no measurement needed
  if (_charWidthRatioCache[chartTypeId]) return _charWidthRatioCache[chartTypeId];
  const refSize = 200;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  ctx.font = `${refSize}px ${OPTOTYPE_FONT_FAMILY}`;
  let maxWidth = 0;
  letterSet.forEach((ch) => {
    const w = ctx.measureText(ch).width;
    if (w > maxWidth) maxWidth = w;
  });
  const ratio = maxWidth / refSize;
  _charWidthRatioCache[chartTypeId] = ratio;
  return ratio;
}

/**
 * Measures the AVERAGE letter width across a set. Used for Snellen,
 * where letter-by-letter validity isn't a hard clinical requirement
 * (unlike ETDRS) — trading a small chance of an occasional tight
 * fit on an unlucky all-wide-letters draw for a meaningfully larger
 * usable size range.
 */
function measureAvgCharWidthRatio(chartTypeId, letterSet) {
  if (chartTypeId === "landolt") return 1.0; // exact square bounding box, no measurement needed
  if (_avgCharWidthRatioCache[chartTypeId]) return _avgCharWidthRatioCache[chartTypeId];
  const refSize = 200;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  ctx.font = `${refSize}px ${OPTOTYPE_FONT_FAMILY}`;
  let total = 0;
  letterSet.forEach((ch) => {
    total += ctx.measureText(ch).width;
  });
  const ratio = total / letterSet.length / refSize;
  _avgCharWidthRatioCache[chartTypeId] = ratio;
  return ratio;
}

const LETTER_GAP_EM = 0.4; // must match .optotype-row gap in styles.css

/* ---------------- Landolt C geometry ---------------- */

/**
 * Builds the SVG path for a Landolt C ring at a given pixel size
 * and gap orientation, following the standard proportions: stroke
 * width = 1/5 of overall diameter, gap width = 1/5 of diameter
 * (measured at the ring's mean radius) — the same ratio used for
 * the letter strokes/gaps in every other optotype in this app.
 */
function landoltCPathD(sizePx, angleDeg) {
  const cx = sizePx / 2;
  const cy = sizePx / 2;
  const rOuter = sizePx / 2;
  const strokeWidth = sizePx / 5;
  const rInner = rOuter - strokeWidth;
  const rMean = rOuter - strokeWidth / 2;

  // Gap angular width, in radians, derived so its LINEAR width at
  // the ring's mean radius equals the stroke width (1/5 diameter) —
  // this ratio is constant regardless of overall size.
  const gapAngleRad = strokeWidth / rMean;
  const gapAngleDeg = (gapAngleRad * 180) / Math.PI;

  const startAngleDeg = angleDeg + gapAngleDeg / 2;
  const endAngleDeg = angleDeg - gapAngleDeg / 2 + 360; // sweep almost all the way around

  const toXY = (deg, r) => {
    const rad = (deg * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  };

  const outerStart = toXY(startAngleDeg, rOuter);
  const outerEnd = toXY(endAngleDeg, rOuter);
  const innerEnd = toXY(endAngleDeg, rInner);
  const innerStart = toXY(startAngleDeg, rInner);

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${rOuter} ${rOuter} 0 1 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${rInner} ${rInner} 0 1 0 ${innerStart.x} ${innerStart.y}`,
    "Z",
  ].join(" ");
}

function createLandoltCElement(sizePx, angleDeg, colorCss) {
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("width", sizePx);
  svg.setAttribute("height", sizePx);
  svg.setAttribute("viewBox", `0 0 ${sizePx} ${sizePx}`);
  const path = document.createElementNS(svgNS, "path");
  path.setAttribute("d", landoltCPathD(sizePx, angleDeg));
  path.setAttribute("fill", colorCss);
  svg.appendChild(path);
  return svg;
}

/**
 * How many letters of a given font-size can fit on one line within
 * the available screen width, using the widest letter in the set
 * as the worst-case width so nothing ever runs off-screen.
 */
function maxLettersFittingWidth(fontSizePx, screenWidthPx, chartTypeId, letterSet) {
  const charWidthRatio = chartTypeId === "etdrs"
    ? measureMaxCharWidthRatio(chartTypeId, letterSet)
    : measureAvgCharWidthRatio(chartTypeId, letterSet);
  const charWidthPx = fontSizePx * charWidthRatio;
  const gapPx = fontSizePx * LETTER_GAP_EM;
  const usablePx = screenWidthPx * 0.92; // small safety margin from screen edges
  const n = Math.floor((usablePx + gapPx) / (charWidthPx + gapPx));
  return Math.max(1, n);
}

/**
 * Logarithmic line-progression step for a chart type.
 * Modernized Snellen: 25% size increase per line (1.25x).
 * ETDRS: strict 0.1 log unit per line -> 10^0.1 ≈ 1.2589x.
 */
function progressionStep(chartTypeId) {
  return chartTypeId === "etdrs" ? Math.pow(10, 0.1) : 1.25;
}

const LINE_GAP_RATIO = 0.45; // gap between stacked lines, as a fraction of line height — a real chart's line gap is well under a full extra line-height; the previous 1.0 (double-height) was the root cause of "stuck at one line"/blank-screen bugs

/**
 * Builds the ordered list of levels to use for a stacked chart or
 * vertical column, largest-to-smallest, walking the appropriate
 * discrete level series (far Snellen-equivalent steps, or the
 * near-point M-value scale) rather than a continuous multiplicative
 * loop — this keeps every displayed size aligned to a clean,
 * labelable step.
 *
 * `startOffset` lets the operator shift which portion of the range
 * is shown (via swipe up/down in stacked/column modes): 0 starts
 * from the largest level that fits on screen; higher values skip
 * further into the smaller end of the series.
 *
 * Sizing rules:
 *   - ETDRS requires exactly 5 letters per line for valid scoring.
 *     Any level that can't fit 5 letters at its width is skipped
 *     entirely (never shown as a short invalid line).
 *   - Snellen allows the letter count to shrink to whatever fits
 *     (minimum 1) — consistent with the original chart's single
 *     giant letter on its largest line.
 *   - A level whose single line doesn't even fit the screen HEIGHT
 *     is skipped (not treated as a hard stop) — this is what fixes
 *     "blank screen" at long distances, where the coarsest levels
 *     can be taller than the whole display.
 */
/**
 * The conventional "top of chart" starting point for stacked/column
 * mode — NOT the same as the extended ceiling used for single-letter
 * mode's max ("as big as the screen allows"). Starting a multi-line
 * chart at that extreme ceiling would consume the entire vertical
 * budget on one giant line, leaving no room for the rest. Far
 * distance testing conventionally starts near 20/200; near-point
 * testing conventionally starts around 8M on most standard cards.
 */
function defaultStackedStartIndex(series, isNearPoint) {
  const target = isNearPoint ? 8.0 : 10; // 8.0M, or Snellen factor 10 (20/200)
  let bestIdx = 0;
  let bestDiff = Infinity;
  series.forEach((entry, i) => {
    const value = isNearPoint ? entry : entry.factor;
    const diff = Math.abs(value - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    }
  });
  return bestIdx;
}

function buildStackedLevels(chartTypeId, distanceInches, screenHeightPx, screenWidthPx, pxPerMM, isNearPoint, startOffset) {
  const chartType = CHART_TYPES[chartTypeId];
  const targetCount = chartType.lettersPerLine || 5;
  const series = getLevelSeries(isNearPoint);
  const offset = startOffset || 0;
  const baseStart = defaultStackedStartIndex(series, isNearPoint);
  const startIdx = Math.min(Math.max(baseStart + offset, 0), series.length - 1);

  const levels = [];
  let usedHeight = 0;
  let started = false;

  for (let i = startIdx; i < series.length; i++) {
    const levelEntry = series[i];
    const factor = factorForLevel(levelEntry, isNearPoint, distanceInches);
    const heightMM = optotypeHeightMM(distanceInches, factor);
    const heightPx = heightMM * pxPerMM;
    const fontSizePx = effectiveOptotypeSizePx(chartTypeId, heightPx);
    const maxFit = maxLettersFittingWidth(fontSizePx, screenWidthPx, chartTypeId, chartType.letters);

    let count;
    if (chartTypeId === "etdrs") {
      if (maxFit < targetCount) continue; // invalid ETDRS line at this size — skip, don't stop
      count = targetCount;
    } else {
      count = Math.min(targetCount, maxFit);
    }

    // Real occupied vertical space per line is the full font-size
    // box (since line-height:1 makes the line box = 1em), NOT the
    // smaller visible cap-height — this is the same em-vs-cap-height
    // gap noted in the sizing engine, here affecting the height
    // budget rather than the width one. Using fontSizePx here (not
    // heightPx) is what fixes the overflow/cutoff bug.
    const lineHeightPx = fontSizePx * (1 + LINE_GAP_RATIO);

    if (!started) {
      // Before the first line is placed, a too-tall level is simply
      // skipped (try the next smaller one) rather than producing a
      // blank chart.
      if (lineHeightPx > screenHeightPx) continue;
      started = true;
    } else if (usedHeight + lineHeightPx > screenHeightPx) {
      break; // vertical budget used up — stop adding smaller lines
    }

    levels.push({ factor, heightPx, count, label: labelForLevel(levelEntry, isNearPoint) });
    usedHeight += lineHeightPx;
  }
  return levels;
}

/**
 * Finds the largest index in a level series whose rendered size
 * fits the screen for a given mode (single-letter=count 1, or
 * single-line=chart's target letter count), checking both width
 * and height. Used to cap swipe-to-enlarge at "as big as the
 * screen allows" rather than overflowing.
 */
function findLargestFittingIndex(series, chartTypeId, distanceInches, screenWidthPx, screenHeightPx, pxPerMM, isNearPoint, requiredCount) {
  const chartType = CHART_TYPES[chartTypeId];
  for (let i = 0; i < series.length; i++) {
    const factor = factorForLevel(series[i], isNearPoint, distanceInches);
    const heightMM = optotypeHeightMM(distanceInches, factor);
    const heightPx = heightMM * pxPerMM;
    const fontSizePx = effectiveOptotypeSizePx(chartTypeId, heightPx);
    const maxFit = maxLettersFittingWidth(fontSizePx, screenWidthPx, chartTypeId, chartType.letters);
    const fitsWidth = maxFit >= requiredCount;
    const fitsHeight = fontSizePx <= screenHeightPx * 0.85; // leave room for the margin label; real occupied height is the font-size box, not just cap-height
    if (fitsWidth && fitsHeight) return i;
  }
  return series.length - 1; // fall back to the smallest/safest level
}

/* ---------------- DOM rendering ---------------- */

function clearStimulusArea(el) {
  el.innerHTML = "";
}

function renderSingleLetter(container, content, heightPx, contrastId, chartTypeId) {
  clearStimulusArea(container);
  const sizePx = effectiveOptotypeSizePx(chartTypeId, heightPx);
  const node = makeOptotypeNode(content, sizePx, colorForContrast(contrastId), chartTypeId);
  const wrap = document.createElement("div");
  wrap.className = "stimulus-center";
  wrap.appendChild(node);
  container.appendChild(wrap);
}

function renderSingleLine(container, items, heightPx, contrastId, chartTypeId) {
  clearStimulusArea(container);
  const row = document.createElement("div");
  row.className = "optotype-row";
  const sizePx = effectiveOptotypeSizePx(chartTypeId, heightPx);
  row.style.gap = `${sizePx * LETTER_GAP_EM}px`;
  items.forEach((item) => {
    row.appendChild(makeOptotypeNode(item, sizePx, colorForContrast(contrastId), chartTypeId));
  });
  const wrap = document.createElement("div");
  wrap.className = "stimulus-center";
  wrap.appendChild(row);
  container.appendChild(wrap);
}

function renderStackedLines(container, chart, levels, letterSet, contrastId, labels, chartTypeId) {
  clearStimulusArea(container);
  const stack = document.createElement("div");
  stack.className = "optotype-stack";
  levels.forEach((level, i) => {
    const lineWrap = document.createElement("div");
    lineWrap.className = "optotype-line-wrap";

    const sizePx = effectiveOptotypeSizePx(chartTypeId, level.heightPx);
    // Match the exact gap the vertical-fit budget math assumed
    // (LINE_GAP_RATIO × this line's size), so what's rendered is
    // what was actually budgeted for — no CSS/JS mismatch.
    if (i < levels.length - 1) {
      lineWrap.style.marginBottom = `${sizePx * LINE_GAP_RATIO}px`;
    }

    const label = document.createElement("span");
    label.className = "line-label";
    label.textContent = labels ? labels[i] : "";
    lineWrap.appendChild(label);

    const row = document.createElement("div");
    row.className = "optotype-row";
    row.style.gap = `${sizePx * LETTER_GAP_EM}px`;
    chart[i].forEach((item) => {
      row.appendChild(makeOptotypeNode(item, sizePx, colorForContrast(contrastId), chartTypeId));
    });
    lineWrap.appendChild(row);

    stack.appendChild(lineWrap);
  });
  container.appendChild(stack);
}

function renderVerticalColumn(container, items, heightsPx, contrastId, labels, chartTypeId) {
  clearStimulusArea(container);
  const col = document.createElement("div");
  col.className = "optotype-column";
  items.forEach((item, i) => {
    const rowWrap = document.createElement("div");
    rowWrap.className = "optotype-line-wrap";

    const sizePx = effectiveOptotypeSizePx(chartTypeId, heightsPx[i]);
    if (i < items.length - 1) {
      rowWrap.style.marginBottom = `${sizePx * LINE_GAP_RATIO}px`;
    }

    const label = document.createElement("span");
    label.className = "line-label";
    label.textContent = labels ? labels[i] : "";
    rowWrap.appendChild(label);

    rowWrap.appendChild(makeOptotypeNode(item, sizePx, colorForContrast(contrastId), chartTypeId));

    col.appendChild(rowWrap);
  });
  container.appendChild(col);
}

function colorForContrast(contrastId) {
  const preset = CONTRAST_PRESETS.find((c) => c.id === contrastId) || CONTRAST_PRESETS[0];
  // Weber contrast = (Lbackground - Lforeground) / Lbackground, where L
  // is true photometric luminance — NOT raw sRGB pixel value. Screens
  // apply a gamma curve (~2.2), so converting a target luminance back
  // into an 8-bit pixel value requires the inverse-gamma step below.
  // Skipping this (naive linear pixel math) would render meaningfully
  // less real contrast than the labeled percentage at every preset
  // except 100%.
  const GAMMA = 2.2;
  const targetLuminanceFraction = 1 - preset.weberPercent / 100; // fraction of background luminance
  const v = Math.round(255 * Math.pow(targetLuminanceFraction, 1 / GAMMA));
  return `rgb(${v}, ${v}, ${v})`;
}

/* ---------------- Duochrome (red/green refraction) test ---------------- */

/**
 * Renders the traditional duochrome layout: a bipartite red/green
 * field (colors derived from the literature wavelengths, not an
 * arbitrary hue) with the SAME black letters shown on both halves
 * at a fixed, moderate size — this is a refraction-refinement tool,
 * not an acuity measurement, so it deliberately does NOT scale with
 * the calibrated distance/acuity system the rest of the app uses.
 */
function renderDuochrome(container, letters, heightPx) {
  clearStimulusArea(container);
  const wrap = document.createElement("div");
  wrap.className = "duochrome-wrap";

  const redHalf = document.createElement("div");
  redHalf.className = "duochrome-half";
  redHalf.style.background = DUOCHROME_RED_COLOR;

  const greenHalf = document.createElement("div");
  greenHalf.className = "duochrome-half";
  greenHalf.style.background = DUOCHROME_GREEN_COLOR;

  [redHalf, greenHalf].forEach((half) => {
    const row = document.createElement("div");
    row.className = "optotype-row";
    row.style.gap = `${heightPx * LETTER_GAP_EM}px`;
    letters.forEach((letter) => {
      const span = document.createElement("span");
      span.className = "optotype";
      span.style.fontSize = `${fontSizeForHeightPx(heightPx)}px`;
      span.style.color = "#000000"; // fixed black, per the traditional test — not tied to contrast presets
      span.textContent = letter;
      row.appendChild(span);
    });
    half.appendChild(row);
  });

  wrap.appendChild(redHalf);
  wrap.appendChild(greenHalf);
  container.appendChild(wrap);
}
