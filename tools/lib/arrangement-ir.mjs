// Arrangement IR 1.0: one guitar, one rhythmic voice, explicit rests and attacks.
// This is an output representation, not another piano parser or source format.
import { positionsFor, isPlayableVoicing } from './fretboard.mjs';
import { gripKey, staticCost, optimizePhrase } from './fingering.mjs';
import { keys, requireThat, canonical } from './generation-plan.mjs';

const TECHNIQUES = ['palm-mute', 'vibrato', 'accent', 'staccato'];
const EFFECT = { 'palm-mute': 'pm', vibrato: 'v', accent: 'ac', staccato: 'st' };
const VALUES = [1, 2, 4, 8, 16, 32, 64];
export const ARRANGEMENT_IR_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Piano-to-guitar Arrangement IR 1.0', type: 'object', additionalProperties: false,
  required: ['schemaVersion', 'section', 'tabBars', 'events', 'deliberateLosses', 'additions'],
  properties: {
    schemaVersion: { const: '1.0' }, section: { type: 'string', minLength: 1 },
    tabBars: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'integer', minimum: 1 } },
    deliberateLosses: { type: 'array', items: { type: 'string', minLength: 1 } },
    additions: { type: 'array', items: { type: 'string', minLength: 1 } },
    events: { type: 'array', minItems: 1, maxItems: 2048, items: {
      type: 'object', additionalProperties: false, required: ['bar', 'beat', 'duration', 'pitches', 'techniques'],
      properties: {
        bar: { type: 'integer', minimum: 1 }, beat: { type: 'number', minimum: 0 },
        duration: { type: 'object', additionalProperties: false, required: ['value', 'dots'], properties: {
          value: { enum: VALUES }, dots: { enum: [0, 1, 2] }, triplet: { type: 'boolean' },
        } },
        pitches: { type: 'array', maxItems: 6, items: { type: 'integer', minimum: 0, maximum: 127 } },
        techniques: { type: 'array', uniqueItems: true, items: { enum: TECHNIQUES } },
        preferredString: { type: 'integer', minimum: 1, maximum: 6 },
        preferredPosition: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'integer', minimum: 0, maximum: 36 } },
      },
    } },
  },
};

export function durationTicks(d) {
  keys(d, ['value', 'dots', 'triplet'], 'duration');
  requireThat(VALUES.includes(d.value) && [0, 1, 2].includes(d.dots), 'unsupported duration value/dots');
  requireThat(d.triplet === undefined || typeof d.triplet === 'boolean', 'duration.triplet must be boolean');
  const ticks = 960 * 4 / d.value * [1, 1.5, 1.75][d.dots] * (d.triplet ? 2 / 3 : 1);
  requireThat(Number.isInteger(ticks), 'duration must resolve to whole alphaTab ticks');
  return ticks;
}

export function validateArrangementIR(ir, plan, entry) {
  keys(ir, ['schemaVersion', 'section', 'tabBars', 'events', 'deliberateLosses', 'additions'], 'IR');
  requireThat(ir.schemaVersion === '1.0', 'IR.schemaVersion must be 1.0');
  requireThat(typeof ir.section === 'string' && ir.section.trim(), 'IR.section is required');
  requireThat(canonical(ir.tabBars) === canonical(entry.tabBars), 'IR cannot change approved tabBars');
  for (const k of ['deliberateLosses', 'additions']) requireThat(Array.isArray(ir[k]) && ir[k].every(s => typeof s === 'string' && s.trim()), `IR.${k} must be a string array`);
  requireThat(Array.isArray(ir.events) && ir.events.length > 0 && ir.events.length <= 2048, 'IR.events must contain 1..2048 events');
  let bar = entry.tabBars[0], tick = 0, attacks = 0;
  for (const e of ir.events) {
    keys(e, ['bar', 'beat', 'duration', 'pitches', 'techniques', 'preferredString', 'preferredPosition'], 'event');
    requireThat(e.bar === bar && bar <= entry.tabBars[1], `event: expected bar ${bar}`);
    requireThat(typeof e.beat === 'number' && Number.isFinite(e.beat) && Math.abs(e.beat * 960 - tick) < 1e-6, `bar ${bar}: overlap or gap; write explicit rests at beat ${tick / 960}`);
    requireThat(Array.isArray(e.pitches) && e.pitches.length <= 6 && e.pitches.every(p => Number.isInteger(p) && p >= 0 && p <= 127), 'pitches must be 0..6 MIDI integers');
    requireThat(Array.isArray(e.techniques) && new Set(e.techniques).size === e.techniques.length && e.techniques.every(t => TECHNIQUES.includes(t)), 'unsupported or duplicate technique');
    requireThat(e.pitches.length || (e.techniques.length === 0 && e.preferredString === undefined && e.preferredPosition === undefined), 'rest cannot have techniques or position preferences');
    if (e.preferredString !== undefined) requireThat(Number.isInteger(e.preferredString) && e.preferredString >= 1 && e.preferredString <= 6, 'preferredString must be 1..6 (high first)');
    if (e.preferredPosition !== undefined) requireThat(Array.isArray(e.preferredPosition) && e.preferredPosition.length === 2 && e.preferredPosition.every(f => Number.isInteger(f) && f >= 0 && f <= plan.maxFret) && e.preferredPosition[0] <= e.preferredPosition[1], 'invalid preferredPosition');
    tick += durationTicks(e.duration);
    attacks += e.pitches.length ? 1 : 0;
    const b = plan.bars[bar - 1], end = b.meter[0] * 4 / b.meter[1] * 960;
    requireThat(tick <= end, `bar ${bar}: overfull; cross-bar sustains are unsupported in IR 1.0`);
    if (tick === end) { bar++; tick = 0; }
  }
  requireThat(bar === entry.tabBars[1] + 1 && tick === 0, 'IR does not fill every approved bar');
  requireThat(attacks > 0, 'IR has zero attacks');
  return ir;
}

function candidates(e, maxFret) {
  const perPitch = e.pitches.map(p => positionsFor(p, { maxFret }).filter(pos => !e.techniques.includes('vibrato') || pos.fret > 0));
  const found = [];
  function visit(i, positions) {
    if (i < perPitch.length) {
      for (const p of perPitch[i]) if (!positions.some(x => x.string === p.string)) visit(i + 1, [...positions, p]);
      return;
    }
    if (!isPlayableVoicing(positions, { maxFret }).ok) return;
    const strings = positions.map(p => p.string);
    if (positions.length >= 3 && Math.max(...strings) - Math.min(...strings) + 1 !== positions.length) return;
    let cost = staticCost(positions);
    const top = positions.reduce((a, b) => a.midi >= b.midi ? a : b);
    if (e.preferredString !== undefined) cost += Math.abs(top.string - e.preferredString) * 3;
    if (e.preferredPosition) for (const p of positions) cost += Math.max(0, e.preferredPosition[0] - p.fret, p.fret - e.preferredPosition[1]);
    found.push({ positions, key: gripKey(positions), staticCost: cost });
  }
  visit(0, []);
  found.sort((a, b) => a.staticCost - b.staticCost || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  requireThat(found.length > 0, `bar ${e.bar}, beat ${e.beat}: no legal voicing for ${e.pitches.join(',')}`);
  return found.slice(0, 48);
}

export function compileArrangementIR(ir, plan, entry, prefix = '') {
  validateArrangementIR(ir, plan, entry);
  requireThat((entry.tabBars[0] === 1) === !prefix, 'later chunks require the approved AlphaTex prefix');
  const positions = new Map();
  let phrase = [];
  function flush() {
    if (!phrase.length) return;
    const optimized = optimizePhrase(phrase);
    // The existing analyzer may restart an impossible search because it is SOFT.
    // A compiler must refuse that discontinuity rather than serialize it.
    requireThat(!optimized.discontinuities.length && optimized.path.length === phrase.length, 'no legal phrase fingering; revise pitches/rhythm');
    phrase.forEach((e, i) => positions.set(e.index, optimized.path[i].positions));
    phrase = [];
  }
  ir.events.forEach((e, index) => {
    if (!e.pitches.length) { flush(); return; }
    phrase.push({ index, barNum: e.bar, durationBeats: durationTicks(e.duration) / 960,
      durationValue: e.duration.value, link: null, slidesOut: false, candidates: candidates(e, plan.maxFret) });
    if (durationTicks(e.duration) >= 1920) flush();
  });
  flush();
  // JSON string escaping is valid for title text; never interpolate model text
  // as an AlphaTex directive or shell command.
  let tex = prefix || `\\title ${JSON.stringify(plan.title)}\n\\tempo ${plan.bars[0].tempo}\n.\n\\track "Guitar"\n\\staff {tabs}\n\\tuning (E4 B3 G3 D3 A2 E2)\n\\instrument ${plan.gain === 'high' ? 30 : plan.gain === 'crunch' ? 29 : 27}\n`;
  if (!tex.endsWith('\n')) tex += '\n';
  let index = 0;
  for (let bar = entry.tabBars[0]; bar <= entry.tabBars[1]; bar++) {
    const b = plan.bars[bar - 1];
    tex += `\\ts (${b.meter.join(' ')}) \\tempo ${b.tempo}\n`;
    const tokens = [];
    while (index < ir.events.length && ir.events[index].bar === bar) {
      const e = ir.events[index], ps = positions.get(index);
      const effects = e.techniques.map(t => EFFECT[t]).join(' ');
      const notes = ps?.map(p => `${p.fret}.${p.string}${effects ? `{${effects}}` : ''}`);
      const head = !notes ? 'r' : notes.length === 1 ? notes[0] : `(${notes.join(' ')})`;
      const beatEffects = [...(e.duration.dots ? [e.duration.dots === 1 ? 'd' : 'dd'] : []), ...(e.duration.triplet ? ['tu 3'] : [])];
      tokens.push(`${head}.${e.duration.value}${beatEffects.length ? `{${beatEffects.join(' ')}}` : ''}`);
      index++;
    }
    tex += `${tokens.join(' ')} |\n`;
  }
  return { alphatex: tex, positions: [...positions].map(([event, notes]) => ({ event, notes })) };
}
