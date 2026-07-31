// tools/lib/contract.mjs — the melody-contract schema, loader and validator
// (PTG-native, Improve_Plan §4).
//
// WHAT A MELODY CONTRACT IS
// -------------------------
// On a noisy transcription the digest's melodySkeleton (highest-voice
// heuristic) is a DIAGNOSTIC, not the perceptual truth — so the fidelity gate
// needs a project-specific, human-reviewed statement of what the arrangement
// MUST preserve. That statement is `melody-contract.json`: octave-exact
// pitches with onsets, per-event duration policy, required gaps (breaths),
// forbidden textures, and whole-phrase octave relocations. compare.mjs
// enforces it for sidecar spans with mode "contract" / "contract-recompose".
//
// SCHEMA v1 (all durations/onsets in quarter-note beats, source timing):
// {
//   "version": 1,
//   "song": "…",                              // informational
//   "phrases": [{
//     "id": "theme-a-1",                      // unique, required
//     "sourceBars": [17, 24],                 // inclusive; must exist in the digest
//     "events": [{
//       "bar": 17,                            // within sourceBars
//       "onset": 0,                           // beats from bar start
//       "pitch": "A4",                        // scientific, OCTAVE-EXACT
//       "duration": 0.5,                      // minimum sounding duration (the obligation)
//       "sourceDuration": 0.5,                // optional: exact source duration (info)
//       "required": true,                     // default true; false = advisory only
//       "role": "foreground",                 // informational classification (§3.3)
//       "attacks": 1,                         // required DISTINCT attacks (default 1)
//       "allowReattack": true,                // may the tab restate mid-sustain (default true)
//       "allowLetRingThroughGap": 0,          // tolerated sustain gap in beats (default 0)
//       "octaveRelocation": null              // per-event override (semitones, multiple of 12)
//     }],
//     "allowedReductions": {
//       "omitConcurrentSupport": true,        // informational
//       "octaveRelocation": null              // phrase-wide relocation (semitones, multiple of 12)
//     },
//     "requiredGaps": [{ "bar": 18, "fromOnset": 2, "toOnset": 4 }], // NO attacks allowed inside
//     "forbidden": [                          // optional texture prohibitions (§5.4)
//       { "kind": "added-attacks" },          //   nothing but contract events may attack
//       { "kind": "bass-ticks" },             //   no attack >= 7 semitones below the phrase floor
//       { "kind": "chords-on-fast-attacks", "maxDuration": 0.25 }
//     ]
//   }],
//   "relocationGroups": [{                    // complete phrases moved coherently
//     "sourceBars": [57, 64],
//     "semitones": -12,
//     "reason": "complete solo phrase exceeds the physical fret limit",
//     "allowMidPhrase": false                 // boundaries inside a phrase need this + reason
//   }]
// }
//
// The validator FAILS CLOSED (§4.3): contradictions, nonexistent bars,
// impossible relocated pitches, invalid duration policies, mid-phrase
// relocation boundaries without justification, required events whose only
// source evidence is a tied continuation, and vacuous phrases are all errors.

import * as fs from 'fs';
import { GUITAR_LOW, GUITAR_HIGH } from './analysis.mjs';

const FORBIDDEN_KINDS = new Set(['added-attacks', 'bass-ticks', 'chords-on-fast-attacks']);

// ---- pitch parsing -----------------------------------------------------------
const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "F#4" | "Bb3" | "A4" -> MIDI number, or null. Octave-exact on purpose. */
export function pitchToMidi(pitch) {
  const m = /^([A-Ga-g])([#b]*)(-?\d+)$/.exec(String(pitch).trim());
  if (!m) return null;
  let pc = LETTER_PC[m[1].toUpperCase()];
  for (const ch of m[2]) pc += ch === '#' ? 1 : -1;
  return pc + (Number(m[3]) + 1) * 12;
}

// ---- loading -------------------------------------------------------------------
export function loadContract(contractPath) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
  } catch (e) {
    return { ok: false, errors: [{ where: contractPath, message: `contract unreadable: ${e.message}` }] };
  }
  return { ok: true, contract: parsed };
}

// ---- validation ------------------------------------------------------------------
const isIntRange = (r) => Array.isArray(r) && r.length === 2
  && Number.isInteger(r[0]) && Number.isInteger(r[1]) && r[0] >= 1 && r[1] >= r[0];

/**
 * Validate a contract, optionally against the source digest (bar existence and
 * tied-continuation evidence need it). Returns:
 *   { ok, errors: [{where, message}], warnings: [...],
 *     stats: { phrases, requiredEvents, durationObligations, requiredGaps,
 *              relocationGroups, forbiddenRules } }
 */
export function validateContract(contract, digest = null) {
  const errors = [];
  const warnings = [];
  const err = (where, message) => errors.push({ where, message });
  const warn = (where, message) => warnings.push({ where, message });

  if (!contract || typeof contract !== 'object') {
    return { ok: false, errors: [{ where: 'root', message: 'contract is not an object' }], warnings, stats: null };
  }
  if (contract.version !== 1) err('root', `unsupported version ${contract.version} (expected 1)`);
  if (!Array.isArray(contract.phrases) || contract.phrases.length === 0) {
    err('root', 'contract carries no phrases — a vacuous contract protects nothing');
  }

  const digestBars = digest ? new Map(digest.bars.map((b) => [b.bar, b])) : null;
  const phraseIds = new Set();
  const phraseRanges = [];
  const eventIndex = new Map(); // "bar:onset:midi" -> {phrase, ev} for contradiction checks
  let requiredEvents = 0;
  let durationObligations = 0;
  let requiredGaps = 0;

  // ---- relocation groups (validated first: events need their semitones) ----
  const relocationGroups = Array.isArray(contract.relocationGroups) ? contract.relocationGroups : [];
  relocationGroups.forEach((g, i) => {
    const where = `relocationGroups[${i}]`;
    if (!isIntRange(g.sourceBars)) { err(where, `bad sourceBars ${JSON.stringify(g.sourceBars)}`); return; }
    if (!Number.isInteger(g.semitones) || g.semitones === 0 || g.semitones % 12 !== 0) {
      err(where, `semitones must be a non-zero multiple of 12 (octave relocation), got ${g.semitones}`);
    }
    if (!g.reason) warn(where, 'relocation without a stated reason');
    if (digestBars) {
      for (let b = g.sourceBars[0]; b <= g.sourceBars[1]; b++) {
        if (!digestBars.has(b)) err(where, `sourceBars references bar ${b}, absent from the digest`);
      }
    }
  });
  for (let i = 0; i < relocationGroups.length; i++) {
    for (let j = i + 1; j < relocationGroups.length; j++) {
      const a = relocationGroups[i].sourceBars;
      const b = relocationGroups[j].sourceBars;
      if (isIntRange(a) && isIntRange(b) && a[0] <= b[1] && b[0] <= a[1]) {
        err(`relocationGroups[${i}]/[${j}]`, `overlapping groups [${a}] and [${b}]`);
      }
    }
  }
  /** Relocation in force for a source bar (0 when none). */
  const relocationFor = (bar) => {
    const g = relocationGroups.find((r) => isIntRange(r.sourceBars)
      && bar >= r.sourceBars[0] && bar <= r.sourceBars[1]);
    return g ? (Number.isInteger(g.semitones) ? g.semitones : 0) : 0;
  };

  // ---- phrases ----------------------------------------------------------------
  for (const phrase of (Array.isArray(contract.phrases) ? contract.phrases : [])) {
    const pw = `phrase "${phrase?.id ?? '?'}"`;
    if (!phrase || typeof phrase !== 'object') { err('phrases', 'phrase is not an object'); continue; }
    if (!phrase.id || typeof phrase.id !== 'string') err(pw, 'missing id');
    else if (phraseIds.has(phrase.id)) err(pw, 'duplicate phrase id');
    else phraseIds.add(phrase.id);
    if (!isIntRange(phrase.sourceBars)) { err(pw, `bad sourceBars ${JSON.stringify(phrase.sourceBars)}`); continue; }
    const [pS, pE] = phrase.sourceBars;
    phraseRanges.push({ id: phrase.id, lo: pS, hi: pE });
    if (digestBars) {
      for (let b = pS; b <= pE; b++) {
        if (!digestBars.has(b)) err(pw, `sourceBars references bar ${b}, absent from the digest`);
      }
    }

    const events = Array.isArray(phrase.events) ? phrase.events : [];
    const phraseRequired = events.filter((e) => e?.required !== false);
    const gaps = Array.isArray(phrase.requiredGaps) ? phrase.requiredGaps : [];
    const forbidden = Array.isArray(phrase.forbidden) ? phrase.forbidden : [];
    // §5.3 anti-vacuity, at the contract level too: a phrase that protects
    // NOTHING is a lie waiting to read as PASS.
    if (!phraseRequired.length && !gaps.length && !forbidden.length) {
      err(pw, 'phrase protects nothing (no required events, gaps, or forbidden rules)');
    }

    const phraseReloc = phrase.allowedReductions?.octaveRelocation ?? null;
    if (phraseReloc !== null && phraseReloc !== undefined
      && (!Number.isInteger(phraseReloc) || phraseReloc % 12 !== 0 || phraseReloc === 0)) {
      err(pw, `allowedReductions.octaveRelocation must be a non-zero multiple of 12, got ${phraseReloc}`);
    }

    events.forEach((ev, i) => {
      const ew = `${pw} events[${i}]`;
      const midi = pitchToMidi(ev?.pitch);
      if (midi === null) { err(ew, `bad pitch ${JSON.stringify(ev?.pitch)}`); return; }
      if (!Number.isInteger(ev.bar) || ev.bar < pS || ev.bar > pE) {
        err(ew, `bar ${ev.bar} outside phrase sourceBars [${pS}, ${pE}]`);
        return;
      }
      if (!Number.isFinite(ev.onset) || ev.onset < 0) err(ew, `bad onset ${ev.onset}`);
      // duration policy (§4.2)
      if (ev.duration !== undefined && (!Number.isFinite(ev.duration) || ev.duration <= 0)) {
        err(ew, `duration must be > 0, got ${ev.duration}`);
      }
      if (ev.sourceDuration !== undefined && ev.duration !== undefined
        && ev.duration > ev.sourceDuration + 1e-9) {
        err(ew, `minimum sounding duration ${ev.duration} exceeds sourceDuration ${ev.sourceDuration}`);
      }
      if (ev.allowLetRingThroughGap !== undefined
        && (!Number.isFinite(ev.allowLetRingThroughGap) || ev.allowLetRingThroughGap < 0)) {
        err(ew, `allowLetRingThroughGap must be >= 0`);
      }
      if (ev.attacks !== undefined && (!Number.isInteger(ev.attacks) || ev.attacks < 1)) {
        err(ew, `attacks must be an integer >= 1, got ${ev.attacks}`);
      }
      const evReloc = ev.octaveRelocation ?? phraseReloc ?? relocationFor(ev.bar) ?? 0;
      if (ev.octaveRelocation !== undefined && ev.octaveRelocation !== null
        && (!Number.isInteger(ev.octaveRelocation) || ev.octaveRelocation % 12 !== 0)) {
        err(ew, `octaveRelocation must be a multiple of 12, got ${ev.octaveRelocation}`);
      }
      // impossible pitch under the declared relocation (§4.3)
      const sounded = midi + (Number.isInteger(evReloc) ? evReloc : 0);
      if (ev.required !== false && (sounded < GUITAR_LOW || sounded > GUITAR_HIGH)) {
        err(ew, `pitch ${ev.pitch}${evReloc ? ` relocated ${evReloc > 0 ? '+' : ''}${evReloc}` : ''} `
          + `lands at MIDI ${sounded}, outside the guitar range ${GUITAR_LOW}..${GUITAR_HIGH}`);
      }
      // contradictions: same source moment, same pitch, different obligations
      const key = `${ev.bar}:${ev.onset}:${midi}`;
      const prior = eventIndex.get(key);
      if (prior && ev.required !== false && prior.ev.required !== false) {
        const conflict = (prior.ev.duration ?? null) !== (ev.duration ?? null)
          || (prior.ev.attacks ?? 1) !== (ev.attacks ?? 1)
          || (prior.evReloc ?? 0) !== (evReloc ?? 0);
        if (conflict) {
          err(ew, `contradicts ${prior.where}: same event ${ev.pitch}@${ev.bar}:${ev.onset} `
            + 'with different duration/attacks/relocation obligations');
        }
      }
      eventIndex.set(key, { where: ew, ev, evReloc });

      if (ev.required !== false) {
        requiredEvents++;
        if (ev.duration !== undefined) durationObligations++;
        // §4.3: a required event whose source evidence is ONLY a tied
        // continuation is not a real attack — the transcription's tie dust
        // must not become an obligation the source never stated.
        if (digestBars && digestBars.has(ev.bar)) {
          const bar = digestBars.get(ev.bar);
          let asAttack = false;
          let asContinuation = false;
          for (const g of bar.foregroundEvidence || []) {
            const onsetHit = Math.abs(g.normalizedOnset - ev.onset) <= 0.03
              || Math.abs(g.onset - ev.onset) <= 0.03;
            if (!onsetHit) continue;
            if (g.notes.some((n) => n.midi === midi)) asAttack = true;
          }
          if (!asAttack) {
            for (const v of bar.voices || []) {
              for (const n of v.notes || []) {
                if (n.midi === midi && Math.abs(n.onset - ev.onset) <= 0.03
                  && n.attack === false) asContinuation = true;
              }
            }
            if (asContinuation) {
              err(ew, `${ev.pitch}@${ev.bar}:${ev.onset} exists in the source only as a tied `
                + 'continuation — not an attack. Point the event at the chain head instead.');
            } else {
              warn(ew, `${ev.pitch}@${ev.bar}:${ev.onset} has no attack evidence in the digest `
                + '(check octave, onset, and bar)');
            }
          }
        }
      }
    });

    gaps.forEach((g, i) => {
      const gw = `${pw} requiredGaps[${i}]`;
      if (!Number.isInteger(g?.bar) || g.bar < pS || g.bar > pE) {
        err(gw, `bar ${g?.bar} outside phrase sourceBars`);
        return;
      }
      if (!Number.isFinite(g.fromOnset) || !Number.isFinite(g.toOnset) || g.toOnset <= g.fromOnset) {
        err(gw, `bad gap [${g.fromOnset}, ${g.toOnset}]`);
      }
      requiredGaps++;
    });

    forbidden.forEach((f, i) => {
      const fw = `${pw} forbidden[${i}]`;
      if (!FORBIDDEN_KINDS.has(f?.kind)) {
        err(fw, `unknown kind ${JSON.stringify(f?.kind)} (expected one of ${[...FORBIDDEN_KINDS].join(', ')})`);
      }
      if (f?.kind === 'chords-on-fast-attacks' && f.maxDuration !== undefined
        && (!Number.isFinite(f.maxDuration) || f.maxDuration <= 0)) {
        err(fw, `maxDuration must be > 0`);
      }
    });
  }

  // relocation-group boundaries inside a phrase need explicit justification (§4.3)
  relocationGroups.forEach((g, i) => {
    if (!isIntRange(g.sourceBars) || g.allowMidPhrase === true) return;
    const [gS, gE] = g.sourceBars;
    for (const p of phraseRanges) {
      const startsInside = gS > p.lo && gS <= p.hi;
      const endsInside = gE >= p.lo && gE < p.hi;
      if (startsInside || endsInside) {
        err(`relocationGroups[${i}]`,
          `boundary [${gS}, ${gE}] cuts through phrase "${p.id}" [${p.lo}, ${p.hi}] — a phrase `
          + 'relocates COMPLETELY or not at all (set allowMidPhrase + reason to override)');
      }
    }
  });

  const stats = {
    phrases: phraseIds.size,
    requiredEvents,
    durationObligations,
    requiredGaps,
    relocationGroups: relocationGroups.length,
    forbiddenRules: (Array.isArray(contract.phrases) ? contract.phrases : [])
      .reduce((a, p) => a + (Array.isArray(p?.forbidden) ? p.forbidden.length : 0), 0),
  };
  if (!errors.length && requiredEvents === 0 && requiredGaps === 0 && stats.forbiddenRules === 0) {
    errors.push({ where: 'root', message: 'contract carries ZERO obligations — vacuous, refusing' });
  }
  return { ok: errors.length === 0, errors, warnings, stats };
}

/** Resolve the phrase for a contract-mode sidecar entry (id must exist). */
export function findPhrase(contract, phraseId) {
  return (contract.phrases || []).find((p) => p && p.id === phraseId) ?? null;
}

/** Effective relocation for an event within a phrase (event > phrase > group). */
export function effectiveRelocation(contract, phrase, ev) {
  if (ev && ev.octaveRelocation !== undefined && ev.octaveRelocation !== null) {
    return ev.octaveRelocation;
  }
  const pr = phrase?.allowedReductions?.octaveRelocation;
  if (pr !== undefined && pr !== null) return pr;
  const groups = Array.isArray(contract.relocationGroups) ? contract.relocationGroups : [];
  const g = groups.find((r) => isIntRange(r.sourceBars) && ev
    && ev.bar >= r.sourceBars[0] && ev.bar <= r.sourceBars[1]);
  return g ? g.semitones : 0;
}
