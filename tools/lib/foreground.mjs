// tools/lib/foreground.mjs — perceptual-foreground candidate analysis
// (PTG-native, Improve_Plan §3).
//
// WHAT THIS MODULE DECIDES — AND WHAT IT REFUSES TO DECIDE
// --------------------------------------------------------
// On a noisy transcription the "highest sounding voice" is a CANDIDATE for the
// melody, not perceptual truth: Basic Pitch scatters one piano line across
// voices, tops it with isolated octave artifacts, and floats a chord bed under
// short punctuations. This module scores candidate lines per bar using musical
// EVIDENCE (continuity, recurrence, cross-source agreement, rhythm, contour)
// and reports ALTERNATIVES WITH CONFIDENCE — it never silently collapses a
// genuine ambiguity. The human (or the melody contract, Improve_Plan §4)
// resolves what stays ambiguous; Gate A reads the ambiguous-bars list.
//
// INPUT is the digest's per-bar `foregroundEvidence` attack graph (§2):
// pitch-specific durations (tie-chain merged), raw + normalized onsets,
// sustained pitches per gesture. Nothing here re-reads the score.
//
// CLASSIFICATIONS (§3.3):
//   foreground              a note of the winning candidate line
//   foreground-punctuation  a short winning note sounding over a sustained bed
//   foreground-handoff      a winning note continuing the line in a NEW voice
//   harmonic-bed            long tone with later attacks above it
//   bass-punctuation        short lowest-register tick far below the line
//   octave-doubling         short note exactly 12 above a same-slot note
//   ornament                sub-sixteenth note outside the winning line
//   uncertain               everything the evidence cannot place

import { strongBeats } from './analysis.mjs';

const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
const round4 = (x) => Math.round((x + Number.EPSILON) * 1e4) / 1e4;
const mod12 = (x) => ((x % 12) + 12) % 12;

// --------------------------------------------------------------------------- //
// slots: gestures merged onto the normalized grid
// --------------------------------------------------------------------------- //
/**
 * Merge a bar's raw gestures by normalizedOnset. Notes carry their gesture's
 * raw onset so nothing is lost; `sounding` is unioned.
 */
export function normalizedSlots(bar) {
  const slots = new Map();
  for (const g of bar.foregroundEvidence || []) {
    const key = g.normalizedOnset;
    if (!slots.has(key)) {
      slots.set(key, { onset: key, notes: [], sounding: new Map(), rawOnsets: [] });
    }
    const slot = slots.get(key);
    slot.rawOnsets.push(g.onset);
    for (const n of g.notes) slot.notes.push({ ...n, rawOnset: g.onset });
    for (const s of g.sounding || []) if (!slot.sounding.has(s.midi)) slot.sounding.set(s.midi, s);
  }
  return [...slots.values()]
    .map((s) => ({ ...s, sounding: [...s.sounding.values()], notes: s.notes.sort((a, b) => b.midi - a.midi) }))
    .sort((a, b) => a.onset - b.onset);
}

// --------------------------------------------------------------------------- //
// pre-pass: structural classification of obvious non-foreground notes
// --------------------------------------------------------------------------- //
/** Tag each slot note with a preliminary role: 'artifact' | 'bed' | 'bassPunct'
 *  | null (a melodic candidate). Mutates copies, returns tagged slots. */
export function prePass(slots) {
  const allNotes = slots.flatMap((s) => s.notes);
  if (!allNotes.length) return slots;
  const barLow = Math.min(...allNotes.map((n) => n.midi));
  const barHigh = Math.max(...allNotes.map((n) => n.midi));
  for (const slot of slots) {
    for (const n of slot.notes) {
      n.pre = null;
      // Isolated octave doubling: short, exactly 12 above a same-slot note
      // that lasts at least as long. The lower note is the real event.
      const lower = slot.notes.find((m) => m !== n && n.midi - m.midi === 12
        && n.duration <= m.duration);
      if (lower && n.duration < 1.0) { n.pre = 'artifact'; continue; }
      // Harmonic bed: a long tone with someone attacking ABOVE it later in
      // the bar — the texture keeps moving over it.
      if (n.duration >= 2.0) {
        const movesAbove = slots.some((s2) => s2.onset > slot.onset
          && s2.notes.some((m) => m.midi > n.midi));
        if (movesAbove) { n.pre = 'bed'; continue; }
      }
      // Bass punctuation: a short tick at the very bottom, an octave or more
      // below the bar's ceiling.
      if (n.duration <= 0.5 && n.midi <= barLow + 2 && barHigh - n.midi >= 12) {
        n.pre = 'bassPunct';
      }
    }
  }
  return slots;
}

// --------------------------------------------------------------------------- //
// candidate construction
// --------------------------------------------------------------------------- //
const iv = (a, b) => Math.abs(a - b);

/** Node quality: duration weight + strong-beat placement. 0..1. */
function nodeScore(n, strongSet) {
  const dur = Math.min(n.duration, 2) / 2;
  const strong = strongSet.has(round4(n.slotOnset)) ? 1 : 0;
  return 0.6 * dur + 0.4 * strong;
}

/**
 * Candidate lines for one bar:
 *   top        — highest attack per melodic slot (the register diagnostic;
 *                artifacts INCLUDED on purpose: this is the line the old
 *                heuristic would have chosen).
 *   continuity — DP path over melodic slots maximizing stepwise motion +
 *                note quality; artifacts and beds excluded.
 *   voice:<v>  — each voice's own attacks (>= 2 notes).
 * Deduped by (name@onset) signature.
 */
export function buildCandidates(slots, timeSig, barBeats) {
  const [num, den] = timeSig.split('/').map(Number);
  const strongSet = new Set(strongBeats(num, den, barBeats).map(round4));

  const melodicSlots = slots
    .map((s) => ({
      onset: s.onset,
      sounding: s.sounding,
      options: s.notes.filter((n) => n.pre !== 'bed' && n.pre !== 'bassPunct'),
    }))
    .filter((s) => s.options.length > 0);
  if (!melodicSlots.length) return { candidates: [], melodicSlots };

  const wrap = (n, slot) => ({ ...n, slotOnset: slot.onset, sounding: slot.sounding });

  const candidates = [];

  // -- top line (artifacts included: the diagnostic the digest already has) --
  candidates.push({
    id: 'top',
    notes: melodicSlots.map((s) => wrap(s.options[0], s)),
  });

  // -- continuity line (DP; artifacts excluded) ------------------------------
  const dpSlots = melodicSlots
    .map((s) => ({ ...s, options: s.options.filter((n) => n.pre !== 'artifact') }))
    .filter((s) => s.options.length > 0);
  if (dpSlots.length) {
    let prev = dpSlots[0].options.map((n) => ({
      note: wrap(n, dpSlots[0]), score: nodeScore(wrap(n, dpSlots[0]), strongSet), back: null,
    }));
    for (let i = 1; i < dpSlots.length; i++) {
      const cur = dpSlots[i].options.map((n) => {
        const wrapped = wrap(n, dpSlots[i]);
        let best = null;
        for (const p of prev) {
          const step = 1 - Math.min(iv(p.note.midi, wrapped.midi), 12) / 12;
          const sameVoice = p.note.voice === wrapped.voice && p.note.track === wrapped.track;
          const s = p.score + step + (sameVoice ? 0.15 : 0);
          if (!best || s > best.score) best = { score: s, back: p };
        }
        return { note: wrapped, score: (best?.score ?? 0) + nodeScore(wrapped, strongSet), back: best?.back ?? null };
      });
      prev = cur;
    }
    let tail = prev.reduce((a, b) => (b.score > a.score ? b : a));
    const path = [];
    while (tail) { path.unshift(tail.note); tail = tail.back; }
    candidates.push({ id: 'continuity', notes: path });
  }

  // -- per-voice lines --------------------------------------------------------
  const byVoice = new Map();
  for (const s of melodicSlots) {
    for (const n of s.options) {
      if (n.pre === 'artifact') continue;
      const key = `${n.track}:${n.voice}`;
      if (!byVoice.has(key)) byVoice.set(key, []);
      byVoice.get(key).push(wrap(n, s));
    }
  }
  for (const [key, notes] of byVoice) {
    if (notes.length >= 2) candidates.push({ id: `voice:${key}`, notes });
  }

  // -- dedup -------------------------------------------------------------------
  const seen = new Set();
  const unique = [];
  for (const c of candidates) {
    const sig = c.notes.map((n) => `${n.name}@${n.slotOnset}`).join('|');
    if (seen.has(sig)) continue;
    seen.add(sig);
    unique.push(c);
  }
  return { candidates: unique, melodicSlots, strongSet };
}

// --------------------------------------------------------------------------- //
// evidence scoring
// --------------------------------------------------------------------------- //
/** "onset:midi" key set for a bar's attack graph (normalized onsets). */
function barKeySet(bar) {
  const keys = new Set();
  for (const g of bar.foregroundEvidence || []) {
    for (const n of g.notes) keys.add(`${g.normalizedOnset}:${n.midi}`);
  }
  return keys;
}

/** Pitch-class multiset similarity between two bars' attack graphs (0..1). */
function barPcSimilarity(a, b) {
  const count = (bar) => {
    const c = new Map();
    for (const g of bar.foregroundEvidence || []) {
      for (const n of g.notes) c.set(mod12(n.midi), (c.get(mod12(n.midi)) || 0) + 1);
    }
    return c;
  };
  const ca = count(a);
  const cb = count(b);
  let inter = 0;
  for (const [k, v] of ca) inter += Math.min(v, cb.get(k) || 0);
  const sa = [...ca.values()].reduce((x, y) => x + y, 0);
  const sb = [...cb.values()].reduce((x, y) => x + y, 0);
  return inter / Math.max(sa, sb, 1);
}

/** Fraction of candidate notes present (midi-exact, same normalized onset) in
 *  the reference bar. Midi-exact on purpose: an octave artifact shares its
 *  pitch CLASS with the true note — only the octave betrays it. */
function agreement(candidate, refKeys) {
  if (!candidate.notes.length) return 0;
  let hit = 0;
  for (const n of candidate.notes) if (refKeys.has(`${n.slotOnset}:${n.midi}`)) hit++;
  return hit / candidate.notes.length;
}

// --------------------------------------------------------------------------- //
// per-bar analysis
// --------------------------------------------------------------------------- //
const AMBIGUITY_MARGIN = 0.15;

export function analyzeBar(bar, ctx) {
  const [num, den] = bar.timeSig.split('/').map(Number);
  const barBeats = (num * 4) / den;
  const slots = prePass(normalizedSlots(bar));
  const { candidates, melodicSlots, strongSet } = buildCandidates(slots, bar.timeSig, barBeats);

  if (!candidates.length) {
    return {
      bar: bar.bar,
      foregroundCandidates: [],
      classifications: classifyLeftovers(slots, new Set()),
      ambiguous: false,
    };
  }

  const scored = candidates.map((c) => {
    const evidence = [];
    const warnings = [];
    const features = []; // [weight, value]

    // quality: duration + strong beats
    const q = c.notes.reduce((a, n) => a + nodeScore(n, strongSet ?? new Set()), 0) / c.notes.length;
    features.push([0.30, q]);
    const meanDur = c.notes.reduce((a, n) => a + n.duration, 0) / c.notes.length;
    if (meanDur >= 1) evidence.push('rhythmic prominence');
    const strongHits = c.notes.filter((n) => (strongSet ?? new Set()).has(round4(n.slotOnset))).length;
    if (strongHits / c.notes.length >= 0.5) evidence.push('strong-beat placement');

    // contour: singable, small intervals
    let contour = 0.5;
    if (c.notes.length >= 2) {
      const ivs = [];
      for (let i = 1; i < c.notes.length; i++) ivs.push(iv(c.notes[i].midi, c.notes[i - 1].midi));
      const meanIv = ivs.reduce((a, b) => a + b, 0) / ivs.length;
      const span = Math.max(...c.notes.map((n) => n.midi)) - Math.min(...c.notes.map((n) => n.midi));
      contour = Math.max(0, 1 - meanIv / 12) - (span > 19 ? 0.2 : 0);
      if (meanIv <= 2.5) evidence.push('motif continuity');
      if (contour >= 0.75) evidence.push('singable contour');
      if (meanIv >= 5 || span > 19) warnings.push('angular contour');
    }
    features.push([0.20, Math.max(0, contour)]);

    // coverage of the melodic slots
    const coverage = melodicSlots.length ? c.notes.length / melodicSlots.length : 0;
    features.push([0.15, coverage]);
    if (coverage < 0.6) warnings.push('sparse coverage');

    // recurrence: agreement with similar (returning) bars
    if (ctx.similarBars.length) {
      const rec = ctx.similarBars.reduce((a, ref) => a + agreement(c, ref.keys), 0)
        / ctx.similarBars.length;
      features.push([0.20, rec]);
      if (rec >= 0.7) evidence.push('return agreement');
      else if (rec < 0.3) warnings.push('no recurrence support');
    }

    // cross-source consensus
    if (ctx.crossKeys.length) {
      const cs = ctx.crossKeys.reduce((a, keys) => a + agreement(c, keys), 0) / ctx.crossKeys.length;
      features.push([0.15, cs]);
      if (cs >= 0.7) evidence.push('cross-source consensus');
      else if (cs < 0.3) warnings.push('no cross-source support');
    }

    // octave artifacts riding the line
    const artifactFrac = c.notes.filter((n) => n.pre === 'artifact').length / c.notes.length;
    if (artifactFrac > 0) warnings.push('isolated highest-note overlaps');

    // voice handoffs (informational evidence when smooth)
    let handoffs = 0;
    for (let i = 1; i < c.notes.length; i++) {
      const a = c.notes[i - 1];
      const b = c.notes[i];
      if ((a.voice !== b.voice || a.track !== b.track) && iv(a.midi, b.midi) <= 4) handoffs++;
    }
    if (handoffs > 0 && artifactFrac === 0) evidence.push('continuation across voice handoffs');

    // cadential arrival
    const last = c.notes[c.notes.length - 1];
    if (last && last.duration >= 1 && ctx.harmonyPcset.has(mod12(last.midi))) {
      evidence.push('cadential arrival');
    }

    const wsum = features.reduce((a, [w]) => a + w, 0);
    const confidence = round2(Math.max(0, Math.min(1,
      features.reduce((a, [w, v]) => a + w * v, 0) / wsum - 0.25 * artifactFrac)));

    return {
      id: c.id,
      line: c.notes.map((n) => n.name),
      onsets: c.notes.map((n) => n.slotOnset),
      notes: c.notes,
      confidence,
      evidence,
      warnings,
    };
  });

  scored.sort((a, b) => b.confidence - a.confidence);
  const winner = scored[0];
  const ambiguous = scored.length > 1
    && (scored[0].confidence - scored[1].confidence) < AMBIGUITY_MARGIN
    && scored[1].line.join('|') !== scored[0].line.join('|');

  // ---- per-note classifications -------------------------------------------
  const winnerKeys = new Set(winner.notes.map((n) => `${n.slotOnset}:${n.midi}:${n.track}:${n.voice}`));
  const classifications = classifyLeftovers(slots, winnerKeys, winner);

  return {
    bar: bar.bar,
    foregroundCandidates: scored.map(({ notes, ...rest }) => ({
      ...rest,
      notes: notes.map((n) => ({
        name: n.name, midi: n.midi, onset: n.slotOnset, duration: n.duration,
        track: n.track, voice: n.voice,
      })),
    })),
    classifications,
    ambiguous,
  };
}

/** Classify every slot note relative to the winning line (or none). */
function classifyLeftovers(slots, winnerKeys, winner = null) {
  const out = [];
  let prevWinnerVoice = null;
  for (const slot of slots) {
    for (const n of slot.notes) {
      const key = `${slot.onset}:${n.midi}:${n.track}:${n.voice}`;
      let cls;
      if (winnerKeys.has(key)) {
        cls = 'foreground';
        if (prevWinnerVoice !== null
          && (prevWinnerVoice.voice !== n.voice || prevWinnerVoice.track !== n.track)) {
          cls = 'foreground-handoff';
        }
        if (n.duration <= 0.5
          && (slot.sounding.length > 0
            || slot.notes.some((m) => m !== n && m.pre === 'bed'))) {
          cls = 'foreground-punctuation';
        }
        prevWinnerVoice = { voice: n.voice, track: n.track };
      } else if (n.pre === 'artifact') cls = 'octave-doubling';
      else if (n.pre === 'bed') cls = 'harmonic-bed';
      else if (n.pre === 'bassPunct') cls = 'bass-punctuation';
      else if (n.duration < 0.25) cls = 'ornament';
      else cls = 'uncertain';
      out.push({
        onset: slot.onset, name: n.name, midi: n.midi,
        track: n.track, voice: n.voice, duration: n.duration, class: cls,
      });
    }
  }
  return out;
}

// --------------------------------------------------------------------------- //
// whole-piece analysis
// --------------------------------------------------------------------------- //
const SIMILAR_MIN = 0.7;
const SIMILAR_CAP = 4;

/**
 * Analyze a digest (plus optional additional source digests of the SAME piece)
 * into a foreground document.
 */
export function buildForeground(digest, opts = {}) {
  const others = opts.others ?? [];
  const lo = opts.barLo ?? 1;
  const hi = opts.barHi ?? digest.bars.length;

  // Precompute per-bar key sets + pairwise similarity for recurrence evidence.
  const keySets = digest.bars.map(barKeySet);
  const results = [];
  const ambiguousBars = [];

  for (let i = 0; i < digest.bars.length; i++) {
    const bar = digest.bars[i];
    if (bar.bar < lo || bar.bar > hi) continue;

    const sims = [];
    for (let j = 0; j < digest.bars.length; j++) {
      if (j === i) continue;
      const s = barPcSimilarity(bar, digest.bars[j]);
      if (s >= SIMILAR_MIN) sims.push({ bar: digest.bars[j].bar, sim: s, keys: keySets[j] });
    }
    sims.sort((a, b) => b.sim - a.sim);

    const crossKeys = [];
    for (const other of others) {
      const ob = other.bars.find((b) => b.bar === bar.bar);
      if (ob) crossKeys.push(barKeySet(ob));
    }

    const harmonyPcset = new Set(bar.harmony?.pcset ?? []);
    const res = analyzeBar(bar, {
      similarBars: sims.slice(0, SIMILAR_CAP),
      crossKeys,
      harmonyPcset,
    });
    if (res.ambiguous) ambiguousBars.push(bar.bar);
    results.push(res);
  }

  return {
    song: digest.song,
    sourceFile: digest.sourceFile,
    sourceKind: digest.sourceProfile?.kind ?? null,
    crossSources: others.map((o) => o.sourceFile || o.song),
    bars: results,
    summary: {
      bars: results.length,
      ambiguousBars,
      barsWithCandidates: results.filter((r) => r.foregroundCandidates.length).length,
    },
  };
}

// --------------------------------------------------------------------------- //
// human-readable map
// --------------------------------------------------------------------------- //
export function renderForegroundMap(doc) {
  const L = [];
  L.push(`# Foreground map -- ${doc.song}`);
  L.push('');
  L.push(`- Source: \`${doc.sourceFile}\`  |  kind: **${doc.sourceKind ?? 'unknown'}**`);
  if (doc.crossSources.length) {
    L.push(`- Cross-checked against: ${doc.crossSources.map((s) => `\`${s}\``).join(', ')}`);
  }
  L.push(`- Bars analyzed: **${doc.summary.bars}**  |  ambiguous: **${doc.summary.ambiguousBars.length}**`);
  L.push('');
  L.push('This map proposes a perceptual foreground per bar WITH ALTERNATIVES. It is');
  L.push('Gate A evidence, not a decision: review it (especially the ambiguous bars),');
  L.push('then fix the result in a melody contract before drafting.');
  L.push('');
  if (doc.summary.ambiguousBars.length) {
    L.push(`## Ambiguous bars (need a human decision)`);
    L.push('');
    L.push(doc.summary.ambiguousBars.join(', '));
    L.push('');
  }
  L.push('## Bars');
  L.push('');
  L.push('| bar | proposed foreground | conf | runner-up | conf | flags |');
  L.push('|---|---|---|---|---|---|');
  for (const r of doc.bars) {
    const [w, ru] = r.foregroundCandidates;
    const flags = [
      r.ambiguous ? 'AMBIGUOUS' : '',
      (w?.warnings ?? []).join(', '),
    ].filter(Boolean).join('; ');
    L.push(`| ${r.bar} | ${w ? w.line.join(' ') : '(none)'} | ${w?.confidence ?? ''} `
      + `| ${ru ? ru.line.join(' ') : ''} | ${ru?.confidence ?? ''} | ${flags} |`);
  }
  L.push('');
  L.push('## Evidence detail (winning candidates)');
  L.push('');
  for (const r of doc.bars) {
    const w = r.foregroundCandidates[0];
    if (!w) continue;
    const ev = w.evidence.length ? w.evidence.join(', ') : 'none';
    const warn = w.warnings.length ? `  |  warnings: ${w.warnings.join(', ')}` : '';
    L.push(`- bar ${r.bar}: ${w.line.join(' ')} (conf ${w.confidence}) — ${ev}${warn}`);
  }
  L.push('');
  return L.join('\n');
}
