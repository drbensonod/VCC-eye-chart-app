/* ============================================================
   VCC Vision Screening App — Optotype Sets
   ============================================================ */

// Traditional Snellen letter set (9 letters, historically used
// across the classic Snellen chart lineage).
const SNELLEN_LETTERS = ["C", "D", "E", "F", "L", "O", "P", "T", "Z"];

// ETDRS / Sloan letter set — 10 letters selected by Louise Sloan (1959)
// for approximately equal legibility across the set.
const SLOAN_LETTERS = ["C", "D", "H", "K", "N", "O", "R", "S", "V", "Z"];

// HOTV — a 4-letter matching test for pre-readers who know the
// alphabet's shapes but not necessarily its names. Public domain,
// widely endorsed for pediatric screening (unlike the trademarked
// Lea symbols), typically administered as letter-matching rather
// than naming.
const HOTV_LETTERS = ["H", "O", "T", "V"];

// Pediatric numbers — accepted alternative optotype set for children
// who know numerals before letters.
const NUMBER_OPTOTYPES = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

// Landolt C — the international ISO 8596 reference optotype. A ring
// with a gap in one of 8 orientations; the patient indicates which
// way the gap points. Requires no literacy or symbol recognition at
// all, which is why it's the gold-standard non-verbal test — even
// more validated than pediatric picture tests.
const LANDOLT_ORIENTATIONS = [
  { angleDeg: 0,   label: "Right" },
  { angleDeg: 45,  label: "Down-Right" },
  { angleDeg: 90,  label: "Down" },
  { angleDeg: 135, label: "Down-Left" },
  { angleDeg: 180, label: "Left" },
  { angleDeg: 225, label: "Up-Left" },
  { angleDeg: 270, label: "Up" },
  { angleDeg: 315, label: "Up-Right" },
];

// Note: orientation selection reuses the generic pickLetterNoRepeat/
// generateLine functions below — reference equality works correctly
// since orientation objects come from this fixed shared array.

const CHART_TYPES = {
  snellen: { label: "Snellen", letters: SNELLEN_LETTERS, lettersPerLine: null }, // variable, classic
  etdrs:   { label: "ETDRS",   letters: SLOAN_LETTERS,   lettersPerLine: 5 },
  hotv:    { label: "HOTV",    letters: HOTV_LETTERS,    lettersPerLine: null },
  numbers: { label: "Numbers", letters: NUMBER_OPTOTYPES, lettersPerLine: null },
  landolt: { label: "Landolt C", letters: LANDOLT_ORIENTATIONS, lettersPerLine: null }, // "letters" here are orientation objects, not text — see makeOptotypeNode
};

/**
 * Picks a random letter from a set, guaranteeing it differs from
 * `previous` (no immediate repeats). If the set has only one
 * letter, returns it regardless.
 */
function pickLetterNoRepeat(letterSet, previous) {
  if (letterSet.length <= 1) return letterSet[0];
  let candidate;
  do {
    candidate = letterSet[Math.floor(Math.random() * letterSet.length)];
  } while (candidate === previous);
  return candidate;
}

/**
 * Generates a full line of `count` letters, each guaranteed to
 * differ from its immediate left neighbor (not just from the
 * previous chart state) — matches how ETDRS lines are built so
 * no two adjacent optotypes on the same line are identical.
 */
function generateLine(letterSet, count) {
  const line = [];
  let prev = null;
  for (let i = 0; i < count; i++) {
    const letter = pickLetterNoRepeat(letterSet, prev);
    line.push(letter);
    prev = letter;
  }
  return line;
}

/**
 * Regenerates an entire multi-line chart at once (used when the
 * operator double-taps in stacked-line mode). `lineSpecs` is an
 * array of { count } describing how many letters belong on each
 * line, ordered largest-optotype-first.
 */
function generateFullChart(letterSet, lineSpecs) {
  return lineSpecs.map((spec) => generateLine(letterSet, spec.count));
}
