/* ============================================================
   VCC Vision Screening App — State & Calibration Module
   No patient data is ever stored. Only device calibration and
   the operator's last-used settings persist (localStorage).
   ============================================================ */

const APP_VERSION = "1.0.0-core";

const BENCHMARK_DISTANCES = [
  { id: "12in",  label: "12 in",  inches: 12,  isNearPoint: true  },
  { id: "16in",  label: "16 in",  inches: 16,  isNearPoint: true  },
  { id: "26in",  label: "26 in",  inches: 26,  isNearPoint: true  },
  { id: "6ft",   label: "6 ft",   inches: 72,  isNearPoint: false },
  { id: "10ft",  label: "10 ft",  inches: 120, isNearPoint: false },
  { id: "13ft",  label: "13 ft",  inches: 156, isNearPoint: false },
  { id: "20ft",  label: "20 ft",  inches: 240, isNearPoint: false },
];

// Standard acuity levels expressed as the Snellen denominator's
// scale factor relative to 20/20 (i.e. factor = denom / 20).
// Extended up to 20/500 per field testing — single-letter/single-line
// modes need a coarser ceiling than 20/200 for very reduced vision.
const ACUITY_LEVELS = [
  { snellen: "20/500", factor: 25,   logmar:  1.40 },
  { snellen: "20/400", factor: 20,   logmar:  1.30 },
  { snellen: "20/320", factor: 16,   logmar:  1.20 },
  { snellen: "20/250", factor: 12.5, logmar:  1.10 },
  { snellen: "20/200", factor: 10,   logmar:  1.00 },
  { snellen: "20/160", factor: 8,    logmar:  0.90 },
  { snellen: "20/125", factor: 6.25, logmar:  0.80 },
  { snellen: "20/100", factor: 5,    logmar:  0.70 },
  { snellen: "20/80",  factor: 4,    logmar:  0.60 },
  { snellen: "20/63",  factor: 3.15, logmar:  0.50 },
  { snellen: "20/50",  factor: 2.5,  logmar:  0.40 },
  { snellen: "20/40",  factor: 2,    logmar:  0.30 },
  { snellen: "20/32",  factor: 1.6,  logmar:  0.20 },
  { snellen: "20/25",  factor: 1.25, logmar:  0.10 },
  { snellen: "20/20",  factor: 1,    logmar:  0.00 },
  { snellen: "20/16",  factor: 0.8,  logmar: -0.10 },
  { snellen: "20/12.5",factor: 0.625,logmar: -0.20 },
  { snellen: "20/10",  factor: 0.5,  logmar: -0.30 },
];

/**
 * Near-point M-notation scale — generated independently of the
 * Snellen factor table above, since M-value is a fixed physical
 * letter size (not something to derive after the fact from a
 * distance-testing fraction). Steps by ~25% (matching the Snellen
 * progression convention) from a 0.4M floor (below which strokes
 * are too fine to be a meaningful clinical target) up to a 50M
 * ceiling, rounded to clean, standard values (nearest 0.5 above
 * 1M, nearest 0.1 below) so labels read naturally.
 */
function buildNearMLevels() {
  const raw = [];
  let v = 50.0; // exact ceiling, per requested target
  while (v > 0.4) {
    raw.push(v);
    v = v / 1.25;
  }
  raw.push(0.4); // exact floor
  const rounded = raw.map((val) => {
    if (val <= 0.4) return 0.4;
    if (val < 1) return Math.round(val * 10) / 10; // nearest 0.1 below 1M
    return Math.round(val * 2) / 2; // nearest 0.5 at/above 1M
  });
  // Dedupe consecutive equal values after rounding (already descending).
  const deduped = [];
  for (const val of rounded) {
    if (deduped.length === 0 || deduped[deduped.length - 1] !== val) deduped.push(val);
  }
  return deduped; // largest (50.0) first, 0.4 last
}
const NEAR_M_LEVELS = buildNearMLevels();

/**
 * Returns the ordered (largest-to-smallest) level series appropriate
 * for the current distance type. Near-point uses raw M-value numbers;
 * far uses the {snellen, factor} objects above.
 */
function getLevelSeries(isNearPoint) {
  return isNearPoint ? NEAR_M_LEVELS : ACUITY_LEVELS;
}

/** Converts a level entry from either series into the Snellen-equivalent
 *  "factor" needed by optotypeHeightMM. */
function factorForLevel(level, isNearPoint, distanceInches) {
  if (isNearPoint) {
    const distanceMeters = distanceInches * 0.0254;
    return level / distanceMeters; // level is a raw M-value here
  }
  return level.factor;
}

/** Human-readable label for a level entry from either series. */
function labelForLevel(level, isNearPoint) {
  if (isNearPoint) return `M${level.toFixed(1)}`;
  return level.snellen;
}

const CONTRAST_PRESETS = [
  { id: "100", label: "100%", weberPercent: 100 },
  { id: "25",  label: "25%",  weberPercent: 25  },
  { id: "10",  label: "10%",  weberPercent: 10  },
  { id: "5",   label: "5%",   weberPercent: 5   },
  { id: "2.5", label: "2.5%", weberPercent: 2.5 },
];

const IN_TO_MM = 25.4;

// Fixation target — a solid, bright circle used for Maddox rod and
// cover testing. Size locked in at 0.75 inches based on typical
// clinical fixation target sizing (large enough to hold gaze from
// across the room, small enough to demand a precise single fixation
// point).
const FIXATION_CIRCLE_DIAMETER_IN = 0.75;

/**
 * Converts a light wavelength (nm) to an approximate display RGB
 * value (Dan Bruton's well-known visible-spectrum approximation,
 * with the standard intensity/gamma correction near the visible
 * range's edges). Used to derive the duochrome test's red/green
 * backgrounds from their literature-specified wavelengths, rather
 * than picking or guessing a hue.
 */
function wavelengthToRGB(nm) {
  let R = 0, G = 0, B = 0;
  if (nm >= 380 && nm < 440) { R = -(nm - 440) / (440 - 380); G = 0; B = 1; }
  else if (nm >= 440 && nm < 490) { R = 0; G = (nm - 440) / (490 - 440); B = 1; }
  else if (nm >= 490 && nm < 510) { R = 0; G = 1; B = -(nm - 510) / (510 - 490); }
  else if (nm >= 510 && nm < 580) { R = (nm - 510) / (580 - 510); G = 1; B = 0; }
  else if (nm >= 580 && nm < 645) { R = 1; G = -(nm - 645) / (645 - 580); B = 0; }
  else if (nm >= 645 && nm <= 780) { R = 1; G = 0; B = 0; }

  let factor = 1;
  if (nm >= 380 && nm < 420) factor = 0.3 + 0.7 * (nm - 380) / (420 - 380);
  else if (nm >= 701 && nm <= 780) factor = 0.3 + 0.7 * (780 - nm) / (780 - 700);

  const gammaCorrect = (c) => (c === 0 ? 0 : Math.round(255 * Math.pow(c * factor, 0.8)));
  return `rgb(${gammaCorrect(R)}, ${gammaCorrect(G)}, ${gammaCorrect(B)})`;
}

// British Standard 3668 duochrome wavelengths — dioptrically
// equidistant (~0.25D) from the 570nm yellow reference point that
// the test's refraction logic is built on.
const DUOCHROME_GREEN_NM = 535;
const DUOCHROME_RED_NM = 620;
const DUOCHROME_GREEN_COLOR = wavelengthToRGB(DUOCHROME_GREEN_NM);
const DUOCHROME_RED_COLOR = wavelengthToRGB(DUOCHROME_RED_NM);

/**
 * Core visual-angle sizing formula.
 * Returns the full optotype height in millimeters for a given
 * viewing distance and acuity factor, based on the 5-arcminute
 * standard (each optotype subtends 5' of arc at the specified
 * denominator distance; strokes/gaps subtend 1' of arc).
 */
function optotypeHeightMM(distanceInches, acuityFactor) {
  const distanceMM = distanceInches * IN_TO_MM;
  const halfAngleRad = (2.5 / 60) * (Math.PI / 180); // 2.5 arcmin half-angle, in radians
  const heightAt20_20 = 2 * distanceMM * Math.tan(halfAngleRad);
  return heightAt20_20 * acuityFactor;
}

/* ---------------- Calibration state (device-specific, persisted) --------------- */

const CAL_KEY = "vcc_calibration_v1";
const SETTINGS_KEY = "vcc_settings_v1";

function saveCalibration(pxPerMM) {
  localStorage.setItem(CAL_KEY, JSON.stringify({ pxPerMM, calibratedAt: Date.now() }));
}

function loadCalibration() {
  try {
    const raw = localStorage.getItem(CAL_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function defaultSettings() {
  return {
    lastDistanceId: "10ft",
    lastCustomDistanceInches: null,
    lastChartType: "snellen",
    lastContrastId: "100",
    lastDisplayMode: "stacked",
    activeTest: "chart", // "chart" | "duochrome"
  };
}
