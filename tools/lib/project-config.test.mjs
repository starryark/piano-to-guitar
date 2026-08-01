// project-config.test.mjs — self-test for tools/lib/project-config.mjs
// (contract C5). Run: node tools/lib/project-config.test.mjs
// Exit 0 = all green, 1 = a readable assertion diff on stderr.
//
// WHAT THIS SUITE IS FOR
// ----------------------
// Configuration is the quietest place a toolchain can break. A typo'd key, a
// string where a number belongs, or a precedence rule applied backwards all
// produce a tool that RUNS and reports a verdict — just not the verdict anyone
// asked for. So the assertions here are mostly about REFUSAL, and the
// precedence assertions read the `sources` provenance map rather than only the
// merged value: a resolved `maxFret: 22` proves nothing on its own, because it
// is also the default. `sources.maxFret === 'cli'` is the actual claim.
//
// Scratch trees are built under out/ (gitignored) and removed afterwards.

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONFIG_SCHEMA_VERSION,
  DEFAULTS,
  REPO_ROOT,
  findProjectConfig,
  loadProjectConfig,
  resolveConfig,
} from './project-config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SCRATCH = path.join(ROOT, 'out', 'project-config-test');

fs.rmSync(SCRATCH, { recursive: true, force: true });
fs.mkdirSync(SCRATCH, { recursive: true });

/** Build `out/project-config-test/<slug>/` with an optional config.json + a tab. */
function project(slug, config) {
  const dir = path.join(SCRATCH, slug);
  fs.mkdirSync(dir, { recursive: true });
  const tab = path.join(dir, 'cover.alphatab');
  fs.writeFileSync(tab, '\\title "t"\n.\n\\ts 4 4\n3.6.4 r.4 r.2 |\n');
  let cfg = null;
  if (config !== undefined) {
    cfg = path.join(dir, 'config.json');
    fs.writeFileSync(cfg, typeof config === 'string' ? config : JSON.stringify(config, null, 2));
  }
  return { dir, tab, cfg };
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ---------------------------------------------------------------------------
// Defaults — "a project without a config behaves exactly as it does today"
// ---------------------------------------------------------------------------

test('no config anywhere: every value is a built-in default, provenance says so', () => {
  const { tab } = project('no-config');
  const r = resolveConfig({ anchorPath: tab });
  assert.equal(r.ok, true, `unexpected errors: ${r.errors.join('; ')}`);
  assert.equal(r.configPath, null, 'no config.json should have been found');
  assert.equal(r.schemaVersion, CONFIG_SCHEMA_VERSION);
  assert.equal(r.style, 'hard-rock');
  assert.equal(r.instrument.maxFret, 22, 'the pre-Wave-1 fret count is the default');
  assert.equal(r.instrument.stringCount, 6);
  assert.equal(r.arrangementMode, 'solo', 'C11.3: solo guitar is the default');
  assert.deepEqual(r.tracks, { lead: [0], rhythm: [] });
  assert.equal(r.gain, 'high');
  for (const [k, v] of Object.entries(r.sources)) {
    assert.equal(v, 'default', `sources.${k} should be "default", got "${v}"`);
  }
});

test('resolveConfig without an anchorPath never touches the filesystem', () => {
  const r = resolveConfig({ cli: { maxFret: 24 } });
  assert.equal(r.ok, true);
  assert.equal(r.configPath, null);
  assert.equal(r.instrument.maxFret, 24);
  assert.equal(r.sources.maxFret, 'cli');
});

test('the DEFAULTS export is frozen — nobody can mutate the bottom of the ladder', () => {
  assert.throws(() => { DEFAULTS.style = 'metal'; }, TypeError);
  assert.throws(() => { DEFAULTS.instrument.maxFret = 24; }, TypeError);
  // And a resolved object must not alias them: mutating a result is harmless.
  const a = resolveConfig({});
  a.tracks.lead.push(9);
  const b = resolveConfig({});
  assert.deepEqual(b.tracks.lead, [0], 'DEFAULTS.tracks.lead leaked by reference');
});

// ---------------------------------------------------------------------------
// findProjectConfig — the upward walk
// ---------------------------------------------------------------------------

test('findProjectConfig walks from the tab\'s directory up to the repo root', () => {
  const { tab, cfg } = project('walk-here', { schemaVersion: 1 });
  assert.equal(findProjectConfig(tab), cfg, 'config beside the tab');

  // A config on a PARENT directory is found from a nested tab.
  const nested = path.join(SCRATCH, 'walk-parent', 'chunks', 'section-2');
  fs.mkdirSync(nested, { recursive: true });
  const nestedTab = path.join(nested, 'cover.alphatab');
  fs.writeFileSync(nestedTab, '\\title "t"\n.\n');
  const parentCfg = path.join(SCRATCH, 'walk-parent', 'config.json');
  fs.writeFileSync(parentCfg, JSON.stringify({ schemaVersion: 1 }));
  assert.equal(findProjectConfig(nestedTab), parentCfg, 'config two directories up');

  // The NEAREST one wins — that is what makes a per-chunk override possible.
  const nearCfg = path.join(nested, 'config.json');
  fs.writeFileSync(nearCfg, JSON.stringify({ schemaVersion: 1 }));
  assert.equal(findProjectConfig(nestedTab), nearCfg, 'the nearest config must win');

  // A directory anchor is accepted as-is, not reduced to its parent.
  assert.equal(findProjectConfig(nested), nearCfg);
  // A path that does not exist yet still resolves against its directory.
  assert.equal(findProjectConfig(path.join(nested, 'not-written-yet.alphatab')), nearCfg);
});

test('findProjectConfig stops at the repo root and never returns null-ish junk', () => {
  const bare = path.join(SCRATCH, 'bare');
  fs.mkdirSync(bare, { recursive: true });
  const tab = path.join(bare, 'cover.alphatab');
  fs.writeFileSync(tab, '\\title "t"\n.\n');
  // out/ and the repo root carry no config.json, so the walk must terminate.
  assert.equal(findProjectConfig(tab), null);
  assert.equal(fs.existsSync(path.join(REPO_ROOT, 'config.json')), false,
    'this assertion is only meaningful while the repo root has no config.json');
  assert.throws(() => findProjectConfig(''), TypeError);
  assert.throws(() => findProjectConfig(null), TypeError);
});

// ---------------------------------------------------------------------------
// Fail closed — unknown keys and bad types
// ---------------------------------------------------------------------------

test('an unknown key is REFUSED — a typo must never silently weaken anything', () => {
  // The motivating case: lower-case "f" would otherwise leave the gate at 22
  // while the file looks like it raised it.
  const { cfg } = project('typo', { schemaVersion: 1, instrument: { maxfret: 24 } });
  const loaded = loadProjectConfig(cfg);
  assert.equal(loaded.ok, false, 'instrument.maxfret must not be accepted');
  assert.match(loaded.errors.join('\n'), /Unknown config key "instrument\.maxfret"/);

  const top = project('typo-top', { schemaVersion: 1, instruments: { maxFret: 24 } });
  assert.equal(loadProjectConfig(top.cfg).ok, false, 'a misspelled top-level key must be refused');

  const tracks = project('typo-tracks', { schemaVersion: 1, tracks: { leed: [0] } });
  assert.equal(loadProjectConfig(tracks.cfg).ok, false, 'a misspelled tracks key must be refused');

  // And it propagates: resolveConfig is not allowed to shrug and use defaults.
  const r = resolveConfig({ anchorPath: path.join(SCRATCH, 'typo', 'cover.alphatab') });
  assert.equal(r.ok, false);
  assert.ok(r.errors.length > 0, 'errors must reach the CLI boundary');
  assert.equal(r.instrument.maxFret, 22, 'a refused config resolves to the SAFE default, not its own value');
});

test('bad value types are REFUSED, one message per problem', () => {
  const cases = [
    [{ schemaVersion: 2 }, /schemaVersion must be 1/],
    [{ instrument: { maxFret: '24' } }, /instrument\.maxFret must be an integer/],
    [{ instrument: { maxFret: 0 } }, /instrument\.maxFret must be an integer/],
    [{ instrument: { maxFret: 22.5 } }, /instrument\.maxFret must be an integer/],
    [{ instrument: { maxFret: 240 } }, /instrument\.maxFret must be an integer/],
    [{ instrument: { stringCount: true } }, /instrument\.stringCount must be an integer/],
    [{ instrument: 24 }, /instrument must be an object/],
    [{ style: '' }, /style must be a non-empty string/],
    [{ style: 7 }, /style must be a non-empty string/],
    [{ arrangementMode: 'trio' }, /arrangementMode must be one of/],
    // C9: roles are track INDICES, never names. Refusing a name here is what
    // keeps role inference from creeping in one project at a time.
    [{ tracks: { lead: ['Lead Guitar'] } }, /tracks\.lead must be an array of non-negative track INDICES/],
    [{ tracks: { rhythm: [-1] } }, /tracks\.rhythm must be an array of non-negative track INDICES/],
    [{ tracks: [0] }, /tracks must be an object/],
  ];
  cases.forEach(([config, re], i) => {
    const { cfg } = project(`bad-${i}`, config);
    const loaded = loadProjectConfig(cfg);
    assert.equal(loaded.ok, false, `${JSON.stringify(config)} should have been refused`);
    assert.equal(loaded.config, null, 'a refused config must not be handed back');
    assert.match(loaded.errors.join('\n'), re);
  });

  // Every problem is reported at once — a hand-edited file should not take four
  // round trips to fix.
  const multi = project('bad-multi', { instrument: { maxFret: 0, stringCount: 'six' }, arrangementMode: 'trio' });
  assert.equal(loadProjectConfig(multi.cfg).errors.length, 3);

  // Unreadable / unparseable files are ordinary refusals, not crashes.
  const broken = project('bad-json', '{ "schemaVersion": 1, }');
  assert.equal(loadProjectConfig(broken.cfg).ok, false);
  assert.match(loadProjectConfig(broken.cfg).errors[0], /Cannot read config/);
  assert.equal(loadProjectConfig(path.join(SCRATCH, 'nope', 'config.json')).ok, false);
  const arr = project('bad-array', [1, 2, 3]);
  assert.match(loadProjectConfig(arr.cfg).errors[0], /must be a JSON object/);
});

test('bad CLI values are refused by the SAME validators as the file', () => {
  // A flag checked more loosely than a file is how the file's guarantee gets
  // bypassed, so `--max-fret 0` and `"maxFret": 0` must fail identically.
  for (const bad of [0, -1, 22.5, '24', 240, null]) {
    const r = resolveConfig({ cli: { maxFret: bad } });
    assert.equal(r.ok, false, `--max-fret ${JSON.stringify(bad)} should be refused`);
    assert.match(r.errors.join('\n'), /--max-fret must be an integer/);
  }
  assert.equal(resolveConfig({ cli: { gain: 'searing' } }).ok, false);
  assert.equal(resolveConfig({ cli: { arrangementMode: 'trio' } }).ok, false);
  // An unrecognized override is a WIRING bug in a tool — never "silently ignored".
  const unknown = resolveConfig({ cli: { maxFrets: 24 } });
  assert.equal(unknown.ok, false);
  assert.match(unknown.errors.join('\n'), /Unknown CLI override "maxFrets"/);
  // `undefined` means "not given on the CLI" and must not count as a key.
  assert.equal(resolveConfig({ cli: { maxFret: undefined } }).ok, true);
  assert.throws(() => resolveConfig({ cli: 'nope' }), TypeError);
});

// ---------------------------------------------------------------------------
// Precedence — CLI > config.json > style profile > built-in
// ---------------------------------------------------------------------------

test('project config beats the built-in default', () => {
  const { tab } = project('cfg-wins', {
    schemaVersion: 1,
    style: 'metal',
    instrument: { maxFret: 24, stringCount: 7 },
    arrangementMode: 'dual-guitar',
    tracks: { lead: [0], rhythm: [1] },
  });
  const r = resolveConfig({ anchorPath: tab });
  assert.equal(r.ok, true, r.errors.join('; '));
  assert.equal(r.instrument.maxFret, 24);
  assert.equal(r.sources.maxFret, 'config');
  assert.equal(r.instrument.stringCount, 7);
  assert.equal(r.sources.stringCount, 'config');
  assert.equal(r.style, 'metal');
  assert.equal(r.sources.style, 'config');
  assert.equal(r.arrangementMode, 'dual-guitar');
  assert.deepEqual(r.tracks, { lead: [0], rhythm: [1] });
  assert.equal(r.sources.rhythm, 'config');
});

test('CLI OVERRIDES project config — asserted through the provenance map', () => {
  const { tab } = project('cli-wins', {
    schemaVersion: 1,
    style: 'metal',
    instrument: { maxFret: 24, stringCount: 7 },
  });
  const r = resolveConfig({ anchorPath: tab, cli: { maxFret: 22 } });
  assert.equal(r.ok, true, r.errors.join('; '));
  assert.equal(r.instrument.maxFret, 22, 'the CLI value must win');
  assert.equal(r.sources.maxFret, 'cli',
    'the value alone proves nothing — 22 is also the default; provenance is the claim');
  // Fields the CLI did NOT set keep coming from the file.
  assert.equal(r.instrument.stringCount, 7);
  assert.equal(r.sources.stringCount, 'config');
  assert.equal(r.style, 'metal');
  assert.equal(r.sources.style, 'config');
});

test('a style profile sits between config and built-in, and CLI still beats it', () => {
  // Wave 3 (contract C6) supplies the profile; the SLOT is wired now so that
  // wave adds a source, not a precedence rule.
  const { tab } = project('profile', { schemaVersion: 1 });
  const profile = { name: 'blues', defaultGain: 'crunch' };
  const r = resolveConfig({ anchorPath: tab, styleProfile: profile });
  assert.equal(r.gain, 'crunch');
  assert.equal(r.sources.gain, 'style-profile');
  const withCli = resolveConfig({ anchorPath: tab, cli: { gain: 'clean' }, styleProfile: profile });
  assert.equal(withCli.gain, 'clean');
  assert.equal(withCli.sources.gain, 'cli');
  // With no profile at all, gain falls back to playability's historical default.
  assert.equal(resolveConfig({ anchorPath: tab }).gain, 'high');
  assert.equal(resolveConfig({ anchorPath: tab }).sources.gain, 'default');
});

test('gain uses the FULL C5 ladder: cli > config > style profile > built-in', () => {
  // gain is the only field with a live contributor at every rung, so it is the
  // one that actually proves the ladder rather than just exercising it. The
  // style profile's defaultGain is the GENRE's usual voice; the config's gain is
  // this arrangement's Gate A decision and must be able to outrank it without
  // the arranger re-typing --gain on every command.
  const profile = { name: 'jazz', defaultGain: 'clean' };
  const { tab } = project('gain-ladder', { schemaVersion: 1, gain: 'crunch' });

  const fromConfig = resolveConfig({ anchorPath: tab, styleProfile: profile });
  assert.equal(fromConfig.gain, 'crunch', 'config gain outranks the profile default');
  assert.equal(fromConfig.sources.gain, 'config');

  const fromCli = resolveConfig({ anchorPath: tab, cli: { gain: 'high' }, styleProfile: profile });
  assert.equal(fromCli.gain, 'high', '--gain outranks everything');
  assert.equal(fromCli.sources.gain, 'cli');

  // Drop the config rung and the profile takes over again.
  const { tab: bare } = project('gain-ladder-bare', { schemaVersion: 1 });
  const fromProfile = resolveConfig({ anchorPath: bare, styleProfile: profile });
  assert.equal(fromProfile.gain, 'clean');
  assert.equal(fromProfile.sources.gain, 'style-profile');
});

test('a bad config gain is REFUSED, like every other closed-set field', () => {
  const { tab } = project('gain-bad', { schemaVersion: 1, gain: 'overdrive' });
  const r = resolveConfig({ anchorPath: tab });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /config gain must be one of high\|crunch\|clean/.test(e)),
    `expected a gain refusal, got ${JSON.stringify(r.errors)}`);
  // ...and the resolved value falls back to a SAFE default so a reporting
  // caller needs no null checks, even though the CLI boundary must exit 2.
  assert.equal(r.gain, DEFAULTS.gain);
});

test('an explicit configPath skips the search entirely', () => {
  const near = project('explicit-near', { schemaVersion: 1, instrument: { maxFret: 24 } });
  const far = project('explicit-far', { schemaVersion: 1, instrument: { maxFret: 20 } });
  const r = resolveConfig({ anchorPath: near.tab, configPath: far.cfg });
  assert.equal(r.instrument.maxFret, 20);
  assert.equal(r.configPath, far.cfg);
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    process.stdout.write(`ok   ${name}\n`);
  } catch (err) {
    failed++;
    process.stderr.write(`FAIL ${name}\n`);
    process.stderr.write(`${err.stack ?? err.message}\n\n`);
  }
}
fs.rmSync(SCRATCH, { recursive: true, force: true });
process.stdout.write(`\n${tests.length - failed}/${tests.length} passed\n`);
process.exit(failed ? 1 : 0);
