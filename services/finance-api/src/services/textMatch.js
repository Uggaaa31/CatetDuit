// Pencocokan teks toleran salah ketik (typo) dan singkatan.
//
// Dipakai oleh nlpParser (kategori item) dan budgetService (nama kantong),
// supaya perintah tetap jalan walau user menulis "bnsin" / "internat" / "mkan".
// Semua fungsi murni (tanpa dependensi luar) agar mudah diuji.

'use strict';

/**
 * Jarak edit Levenshtein dengan batas maksimum (early exit) supaya cepat.
 */
function levenshtein(a, b, max = Infinity) {
  const s1 = String(a || '');
  const s2 = String(b || '');
  if (s1 === s2) return 0;
  if (s1.length === 0) return s2.length;
  if (s2.length === 0) return s1.length;
  if (Math.abs(s1.length - s2.length) > max) return max + 1;

  let prev = new Array(s2.length + 1);
  let curr = new Array(s2.length + 1);
  for (let j = 0; j <= s2.length; j++) prev[j] = j;

  for (let i = 1; i <= s1.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= s2.length; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return max + 1;
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }

  return prev[s2.length];
}

/**
 * Skor kemiripan 0..1 (1 = identik).
 */
function similarity(a, b) {
  const s1 = String(a || '');
  const s2 = String(b || '');
  const longest = Math.max(s1.length, s2.length);
  if (longest === 0) return 1;
  return 1 - levenshtein(s1, s2, longest) / longest;
}

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9&\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Kemiripan terbaik antara satu input bebas dengan satu frasa kandidat.
 * Menangani tiga bentuk kesalahan yang paling umum:
 *   1. Salah ketik pada satu kata     -> "bnsin" vs "bensin"
 *   2. Salah ketik pada kata di frasa -> "uang mkan" vs "uang makan"
 *   3. Frasa dengan panjang kata sama -> dibandingkan kata per kata
 */
function bestSimilarity(input, candidate) {
  const a = normalize(input);
  const b = normalize(candidate);
  if (!a || !b) return 0;
  if (a === b) return 1;

  let best = similarity(a, b);

  const aTokens = a.split(' ').filter(Boolean);
  const bTokens = b.split(' ').filter(Boolean);

  // Satu kata input vs kandidat satu kata (kasus typo paling sering).
  if (bTokens.length === 1 && b.length >= 4) {
    for (const token of aTokens) {
      if (token.length < 4) continue;
      best = Math.max(best, similarity(token, b));
    }
  }

  // Frasa vs frasa: bandingkan kata per kata kalau jumlah katanya sama.
  if (aTokens.length === bTokens.length && aTokens.length > 1) {
    let total = 0;
    for (let i = 0; i < aTokens.length; i++) {
      total += similarity(aTokens[i], bTokens[i]);
    }
    best = Math.max(best, total / aTokens.length);
  }

  return best;
}

/**
 * Pilih kandidat terbaik untuk `input`.
 *
 * @param {string} input
 * @param {Array<{phrase: string, value: any}>|Object} candidates
 *        Array objek {phrase, value} atau objek peta {phrase: value}.
 * @param {{minScore?: number, minLen?: number}} [options]
 * @returns {{value: any, phrase: string, score: number}|null}
 */
function fuzzyLookup(input, candidates, options = {}) {
  const minScore = options.minScore != null ? options.minScore : 0.8;
  const minLen = options.minLen != null ? options.minLen : 4;

  const list = Array.isArray(candidates)
    ? candidates
    : Object.entries(candidates || {}).map(([phrase, value]) => ({ phrase, value }));

  const clean = normalize(input);
  if (!clean) return null;

  let winner = null;
  for (const entry of list) {
    const phrase = normalize(entry.phrase);
    if (!phrase || phrase.length < minLen) continue;

    const score = bestSimilarity(clean, phrase);
    if (score < minScore) continue;
    if (!winner || score > winner.score) {
      winner = { value: entry.value, phrase: entry.phrase, score };
    }
  }

  return winner;
}

/**
 * Apakah dua teks "hampir sama" (dipakai untuk menyaring duplikat yang typo).
 */
function isNearMatch(a, b, minScore = 0.8) {
  return bestSimilarity(a, b) >= minScore;
}

module.exports = {
  levenshtein,
  similarity,
  bestSimilarity,
  fuzzyLookup,
  isNearMatch,
};
