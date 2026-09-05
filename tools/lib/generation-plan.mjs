// Optional generation boundary. Existing digest, sidecar and gate semantics stay authoritative.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validateSidecar, CONTRACT_MODES } from './sidecar.mjs';
import { loadStyleProfile } from './style-profile.mjs';

export const STANDARD_TUNING = [64, 59, 55, 50, 45, 40]; // HIGH string first
export const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export function requireThat(ok, message) { if (!ok) throw new Error(message); }
export function keys(value, allowed, where) {
  requireThat(object(value), `${where}: expected an object`);
  for (const key of Object.keys(value)) requireThat(allowed.includes(key), `${where}: unknown field ${key}`);
}
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const hashObject = (value) => sha256(canonical(value));
export const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
export function writeJson(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' }); }

export function validatePlan(plan, digest, mapPath, contractArg = null) {
  keys(plan, ['schemaVersion', 'title', 'transpose', 'tuning', 'maxFret', 'style', 'gain', 'groove', 'bars', 'sidecar'], 'plan');
  requireThat(plan.schemaVersion === 1, 'plan.schemaVersion must be 1');
  for (const k of ['title', 'groove']) requireThat(typeof plan[k] === 'string' && plan[k].trim(), `plan.${k} is required`);
  requireThat(Number.isInteger(plan.transpose) && plan.transpose >= -6 && plan.transpose <= 5, 'plan.transpose must be an integer in -6..5');
  requireThat(canonical(plan.tuning) === canonical(STANDARD_TUNING), 'generation v1 supports standard six-string tuning only');
  requireThat(Number.isInteger(plan.maxFret) && plan.maxFret >= 1 && plan.maxFret <= 36, 'plan.maxFret must be in 1..36');
  requireThat(['high', 'crunch', 'clean'].includes(plan.gain), 'plan.gain must be high, crunch or clean');
  requireThat(['hard-rock', 'metal', 'blues', 'jazz'].includes(plan.style), 'plan.style must name a shipped style');
  const style = loadStyleProfile(plan.style);
  requireThat(style.ok, style.errors?.[0]?.message ?? 'invalid style');
  requireThat(Array.isArray(plan.bars) && plan.bars.length > 0 && plan.bars.length <= 10000, 'plan.bars must be a nonempty ordered bar plan');
  plan.bars.forEach((b, i) => {
    keys(b, ['bar', 'meter', 'tempo'], `plan.bars[${i}]`);
    requireThat(b.bar === i + 1, 'plan bars must be consecutive starting at 1');
    requireThat(Array.isArray(b.meter) && b.meter.length === 2 && Number.isInteger(b.meter[0]) && b.meter[0] >= 1 && b.meter[0] <= 32 && [1, 2, 4, 8, 16].includes(b.meter[1]), `bar ${b.bar}: invalid meter`);
    requireThat(Number.isInteger(b.tempo) && b.tempo >= 20 && b.tempo <= 400, `bar ${b.bar}: tempo must be 20..400`);
  });
  requireThat(Array.isArray(digest?.bars) && digest.bars.length > 0, 'nonempty source digest required');
  const byBar = new Map(digest.bars.map(b => [b.bar, b]));
  requireThat(byBar.size === digest.bars.length, 'duplicate source bar identities');
  for (const b of digest.bars) requireThat(Array.isArray(b.melodySkeleton) && object(b.harmony), `source bar ${b.bar}: missing gate fields`);
  keys(plan.sidecar, ['song', 'contract', 'entries'], 'plan.sidecar');
  const checked = validateSidecar(plan.sidecar, { range: { lo: 1, hi: plan.bars.length }, digest, digestByBar: byBar, mapPath, contractArg });
  requireThat(checked.ok, checked.errors?.[0]?.message ?? 'invalid sidecar');
  let next = 1;
  checked.entries.forEach((e, i) => {
    keys(plan.sidecar.entries[i], ['mode', 'tabBars', 'sourceBars', 'contractPhrase', 'note'], `entry ${i + 1}`);
    requireThat(e.tabBars[0] === next && e.tabBars[1] <= plan.bars.length, 'plan entries must be ordered, contiguous and inside plan bars');
    requireThat(e.tabBars[1] - e.tabBars[0] < 8, 'each generation entry must be at most 8 bars');
    const beats = plan.bars.slice(e.tabBars[0] - 1, e.tabBars[1]).reduce((s, b) => s + b.meter[0] * 4 / b.meter[1], 0);
    requireThat(beats <= 32, 'each generation entry must be at most 32 quarter-note beats');
    requireThat(typeof e.note === 'string' && e.note.trim(), `entry ${i + 1} needs its musical intent in note`);
    if (e.mode === 'free') requireThat(!('sourceBars' in plan.sidecar.entries[i]), 'free entries cannot carry sourceBars');
    if (digest.sourceProfile?.kind === 'noisy-transcription' && e.mode !== 'free') requireThat(CONTRACT_MODES.includes(e.mode), 'noisy source spans require a reviewed melody contract');
    if (e.sourceBars) {
      const source = digest.bars.filter(b => b.bar >= e.sourceBars[0] && b.bar <= e.sourceBars[1]);
      if (e.mode === 'quote') requireThat(source.some(b => b.melodySkeleton.length > 0), 'quote span has zero melody obligations');
      if (!CONTRACT_MODES.includes(e.mode)) requireThat(source.some(b => typeof b.harmony.root === 'string'), 'source span has zero harmony obligations');
    }
    next = e.tabBars[1] + 1;
  });
  return checked;
}

// Locking records a human decision; it cannot authenticate who typed that decision.
// The generator accepts the hash separately and never creates or edits approvals.
export function lockPlan(planPath, digestPath, approval, policyPath = null) {
  requireThat(typeof approval === 'string' && approval.trim(), 'record the actual human Gate A approval');
  const plan = readJson(planPath), digest = readJson(digestPath);
  const checked = validatePlan(plan, digest, planPath);
  const policy = policyPath ? readJson(policyPath) : null;
  const payload = { schemaVersion: 1, approval, approvedAt: new Date().toISOString(), plan, digest,
    contract: checked.contract, policy, styleProfile: loadStyleProfile(plan.style).profile,
    sourceDigestSha256: sha256(fs.readFileSync(digestPath)) };
  return { ...payload, lockSha256: hashObject(payload) };
}

export function loadPlanLock(file, expectedHash) {
  const lock = readJson(file);
  keys(lock, ['schemaVersion', 'approval', 'approvedAt', 'plan', 'digest', 'contract', 'policy', 'styleProfile', 'sourceDigestSha256', 'lockSha256'], 'lock');
  const { lockSha256, ...payload } = lock;
  requireThat(typeof expectedHash === 'string' && /^[a-f0-9]{64}$/.test(expectedHash), 'supply the approved --lock-sha256 printed when locking');
  requireThat(lock.schemaVersion === 1 && lockSha256 === expectedHash && hashObject(payload) === expectedHash, 'approved plan lock hash mismatch');
  requireThat(typeof lock.approval === 'string' && lock.approval.trim(), 'lock lacks human approval evidence');
  return lock;
}

// The gate's own contract validator resolves a file, so materialize the frozen
// contract beside the map. No live project files are consulted during a run.
export function materializeLock(lock, dir) {
  writeJson(path.join(dir, 'source.json'), lock.digest);
  if (lock.contract) writeJson(path.join(dir, 'melody-contract.json'), lock.contract);
  if (lock.policy) writeJson(path.join(dir, 'guitar-policy.json'), lock.policy);
  const plan = structuredClone(lock.plan);
  requireThat(canonical(loadStyleProfile(plan.style).profile) === canonical(lock.styleProfile), 'style profile changed since Gate A; restore it or review a new plan');
  // Freeze the effective configuration locally. Ancestor project configs must
  // not silently add track roles or limits that were absent from this plan.
  writeJson(path.join(dir, 'config.json'), { schemaVersion: 1, style: plan.style,
    gain: plan.gain, instrument: { maxFret: plan.maxFret, stringCount: 6 },
    arrangementMode: 'solo', tracks: { lead: [0], rhythm: [] } });
  if (lock.contract) plan.sidecar.contract = 'melody-contract.json';
  else delete plan.sidecar.contract;
  const checked = validatePlan(plan, lock.digest, path.join(dir, 'sidecar.json'));
  return { plan, entries: checked.entries };
}
