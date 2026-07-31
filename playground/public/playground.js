// playground.js — Piano-to-Guitar Gate Playground.
// Pure ES module; alphaTab is imported from the local /alphatab/ prefix.
//
// Behaviour:
//  - On load: wire one alphaTab instance, fetch /seed, fill textareas, auto-run.
//  - Run gate: api.tex(tab) for notation + POST /gate for the report.
//  - Report block mirrors docs/gate-templates.md wording; handles lint mode
//    (no compare) and fidelity mode (map or bar-aligned), incl. the 0/0
//    fail-open guard (§A.2).

import * as alphaTab from '/alphatab/alphaTab.mjs';

// ---- element handles -------------------------------------------------------
const el = {
  tab:       document.getElementById('tab'),
  source:    document.getElementById('source'),
  sidecar:   document.getElementById('sidecar'),
  run:       document.getElementById('run'),
  play:      document.getElementById('play'),
  stop:      document.getElementById('stop'),
  status:    document.getElementById('status'),
  alphaTab:  document.getElementById('alphaTab'),
  report:    document.getElementById('report'),
  errorBanner: document.getElementById('error-banner'),
};

// ---- helpers ---------------------------------------------------------------
function setStatus(msg) {
  el.status.textContent = msg;
}

function showError(msg) {
  // textContent, never innerHTML — AlphaTex error strings are user-controlled.
  el.errorBanner.textContent = msg;
  el.errorBanner.classList.remove('hidden');
}
function hideError() {
  el.errorBanner.classList.add('hidden');
  el.errorBanner.textContent = '';
}

/** Escape a string for safe insertion into innerHTML. */
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---- alphaTab instance (wired once) ---------------------------------------
const settings = {
  core: {
    engine: 'svg',
    fontDirectory: '/alphatab/font/',
    logLevel: 'error',
  },
  player: {
    playerMode: 2, // EnabledSynthesizer
    soundFont: '/alphatab/soundfont/sonivox.sf2',
  },
};

const api = new alphaTab.AlphaTabApi(el.alphaTab, settings);

api.error.on((err) => {
  // tex() never throws; parse errors arrive ONLY here.
  const msg = (err && err.message) ? err.message : String(err);
  showError(msg);
});
api.scoreLoaded.on(() => {
  hideError();
});
api.postRenderFinished.on(() => {
  // sheet visually drawn; nothing required beyond clearing prior errors.
});
api.playerReady.on(() => {
  el.play.disabled = false;
  setStatus('player ready');
});

// ---- run gate --------------------------------------------------------------
async function runGate() {
  const tab = el.tab.value;
  const source = el.source.value.trim();
  const sidecar = el.sidecar.value.trim();

  hideError();

  // 1) notation (async; parse errors come through api.error).
  //    Clear stale DOM first so a failing parse doesn't leave the old score.
  el.alphaTab.innerHTML = '';
  try {
    api.tex(tab);
  } catch (e) {
    // Defensive only — tex() is not expected to throw.
    showError(`render threw: ${(e && e.message) ? e.message : String(e)}`);
  }

  // 2) gate report.
  try {
    setStatus('running gate…');
    const body = { tab };
    if (source)  body.source  = source;
    if (sidecar) body.sidecar = sidecar;

    const res = await fetch('/gate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const txt = await res.text();
        if (txt) detail += `: ${txt}`;
      } catch (_) { /* ignore */ }
      showError(`gate request failed — ${detail}`);
      setStatus('gate failed');
      return;
    }
    const m = await res.json();
    if (m && m.error) {
      showError(`gate error: ${m.error}`);
      setStatus('gate failed');
      return;
    }
    renderReport(m);
    setStatus(m && m.ok ? 'gate: PASS' : 'gate: FAIL');
  } catch (e) {
    showError(`gate failed: ${(e && e.message) ? e.message : String(e)}`);
    setStatus('gate failed');
  }
}

// ---- report rendering ------------------------------------------------------
// Builds an HTML string and injects into #report. The visible block mirrors
// docs/gate-templates.md → "Fidelity report block".
function renderReport(machine) {
  if (!machine) {
    el.report.innerHTML = '';
    return;
  }

  const lines = [];
  const ok = !!machine.ok;
  const mode = machine.mode || (machine.hard && machine.hard.compare ? 'fidelity' : 'lint');

  // ---- header: verdict + mode ----
  const verdictWord = ok ? 'PASS' : 'FAIL';
  const verdictCls  = ok ? 'ok' : 'fail';
  // bar range label, if the compare block carries it (best-effort).
  let barLabel = '';
  const cmp = machine.hard && machine.hard.compare ? machine.hard.compare : null;
  if (cmp && cmp.bars) barLabel = `, bars ${cmp.bars}`;
  else if (machine.bars) barLabel = `, bars ${machine.bars}`;

  lines.push(
    `<span class="report-verdict ${verdictCls}">GATE: ${verdictWord}</span>` +
    `    <span class="muted">(mode: ${esc(mode)}${esc(barLabel)})</span>`
  );
  lines.push(rule());

  const hard = machine.hard || {};

  // ---- HARD: validate --strict ----
  const validate = hard.validate || {};
  if (validate.ok) {
    lines.push(row('validate --strict', '[ OK ]', 'ok', 'HARD'));
  } else if (validate.parseFailed) {
    lines.push(row('validate --strict', '[ FAIL ] (parse failed)', 'fail', 'HARD'));
  } else {
    lines.push(row('validate --strict', '[ FAIL ]', 'fail', 'HARD'));
  }

  // ---- HARD: playability ----
  const playability = hard.playability;
  if (playability === null || playability === undefined) {
    // playability is null only when parse failed.
    lines.push(row('playability', '— (parse failed)', 'fail', 'HARD'));
  } else if (playability.ok) {
    // "(N warnings)" derives from the SOFT playability advisories count
    // (hard.playability carries errors, not warnings). The soft block below
    // lists them in amber; this HARD row stays green because the gate passed.
    const n = (softPlayabilityWarnings(machine) || []).length;
    lines.push(row('playability', `[ OK ]  (${n} warning${n === 1 ? '' : 's'})`, 'ok', 'HARD'));
  } else {
    lines.push(row('playability', '[ FAIL ]', 'fail', 'HARD'));
  }

  // ---- HARD (fidelity only): melodic skeleton + harmonic roots ----
  if (cmp) {
    if (Array.isArray(cmp.mapResults)) {
      // MAP MODE — overall verdict = all entries ok; show per-entry sub-rows.
      const allOk = cmp.mapResults.every((r) => r.ok);
      const headCls = allOk ? 'ok' : 'fail';
      lines.push(row('melodic skeleton / roots (map)', allOk ? '[ OK ] (all spans)' : '[ FAIL ]', headCls, 'HARD'));
      for (const r of cmp.mapResults) {
        const span = `tabBars [${r.tabBars ? r.tabBars.join('-') : '?'}]`;
        const src  = r.sourceBars ? ` sourceBars [${r.sourceBars.join('-')}]` : '';
        const tag  = r.ok ? 'OK' : 'FAIL';
        const cls  = r.ok ? 'ok' : 'fail';
        lines.push(`    <span class="muted">${esc(r.mode || '?')}</span>  ${esc(span)}${esc(src)}  <span class="${cls}">[${esc(tag)}]</span>`);
      }
      // 0/0 guard is N/A for map mode (no covered/total), so nothing extra here.
    } else if (cmp.hardGates) {
      // BAR-ALIGNED MODE.
      const skel = cmp.hardGates.melodicSkeleton || { covered: 0, total: 0, ok: false };
      const root = cmp.hardGates.harmonicRoots   || { covered: 0, total: 0, ok: false };
      lines.push(...gateRow('melodic skeleton', skel));
      lines.push(...gateRow('harmonic roots',   root));
    } else {
      // compare present but shape unrecognized — surface it, don't pretend.
      lines.push(row('melodic skeleton', '[ ? ]', 'fail', 'HARD'));
      lines.push(row('harmonic roots',   '[ ? ]', 'fail', 'HARD'));
    }
  }

  lines.push(rule());

  // ---- SOFT block ----
  const soft = machine.soft || {};
  const compareSoft = soft.compare;

  if (!cmp) {
    // LINT MODE — no fidelity rows exist.
    lines.push(`<span class="soft">Paste a source (+ optional sidecar) to run the fidelity gate (melodic skeleton, harmonic roots).</span>`);
  }

  let softShown = false;

  if (compareSoft) {
    // chord quality
    if (compareSoft.chordQuality) {
      const power = compareSoft.chordQuality.power || 0;
      const exact = compareSoft.chordQuality.exact || 0;
      lines.push(row('chord quality', `${power} power · ${exact} exact`, 'soft', 'soft'));
      softShown = true;
    }
    // density
    if (compareSoft.density && compareSoft.density.percent !== null && compareSoft.density.percent !== undefined) {
      lines.push(row('density', `${compareSoft.density.percent}% of source`, 'soft', 'soft'));
      softShown = true;
    }
    // contour
    if (compareSoft.contour && compareSoft.contour.r !== null && compareSoft.contour.r !== undefined) {
      const r = Number(compareSoft.contour.r);
      const rStr = Number.isFinite(r) ? r.toFixed(2) : esc(String(compareSoft.contour.r));
      lines.push(row('contour', `r=${rStr}`, 'soft', 'soft'));
      softShown = true;
    }
    // dropped notes — one line per bar
    if (Array.isArray(compareSoft.dropped) && compareSoft.dropped.length) {
      for (const d of compareSoft.dropped) {
        const notes = Array.isArray(d.notes) ? d.notes.join(', ') : (d.notes || '');
        lines.push(row('dropped', `bar ${d.bar}: ${esc(notes)}`, 'soft', 'soft'));
      }
      softShown = true;
    }
  }

  // soft playability advisories
  const advisories = softPlayabilityWarnings(machine);
  if (advisories.length) {
    const summary = advisories
      .map((a) => esc(a.type || a.message || 'advisory'))
      .join('; ');
    lines.push(row(`playability advisories (${advisories.length})`, summary, 'soft', 'soft'));
    softShown = true;
  }

  if (!softShown && !cmp) {
    lines.push(`<span class="muted">(no soft signals in lint mode)</span>`);
  }

  // ---- fail reasons ----
  if (Array.isArray(machine.failReasons) && machine.failReasons.length) {
    lines.push(rule());
    lines.push(`<span class="fail">failed: ${esc(machine.failReasons.join(', '))}</span>`);
  }

  // ---- assemble ----
  const verdictClass = ok ? 'verdict-pass' : 'verdict-fail';
  const html = `<pre class="report-block ${verdictClass}">${lines.join('\n')}</pre>`;
  el.report.innerHTML = html;
}

/** A HARD gate row from a {covered,total,ok} object, including the 0/0 guard. */
function gateRow(label, gate) {
  const covered = gate.covered || 0;
  const total   = gate.total || 0;
  const out = [];
  if (total === 0) {
    // §A.2 fail-open guard: 0/0 is a trivial PASS — surface it in amber,
    // even if `ok` is true, because it protects nothing.
    out.push(row(label, `${covered}/${total}   [ OK ]`, 'ok', 'HARD'));
    out.push(`    <span class="soft">0/0 is a trivial PASS — totals must be non-zero</span>`);
  } else if (gate.ok) {
    out.push(row(label, `${covered}/${total}   [ OK ]`, 'ok', 'HARD'));
  } else {
    out.push(row(label, `${covered}/${total}   [ FAIL ]`, 'fail', 'HARD'));
  }
  return out;
}

/** Format one report line: label, value (colored), and a right-aligned tag. */
function row(label, valueHtml, valueCls, tag) {
  const tagText = tag ? `<span class="hard-tag">  ← ${esc(tag)}</span>` : '';
  // pad label to a fixed column for alignment within a <pre>.
  const padded = padLabel(label);
  return `${padded} <span class="${valueCls}">${valueHtml}</span>${tagText}`;
}

function padLabel(s) {
  // 22 chars gives room for "melodic skeleton / roots (map)".
  const W = 22;
  return s.length >= W ? esc(s) : esc(s) + ' '.repeat(W - s.length);
}

function rule() {
  return `<span class="muted">${'─'.repeat(58)}</span>`;
}

/** Pull soft.playability[] warnings out of the machine object. */
function softPlayabilityWarnings(machine) {
  const soft = machine && machine.soft;
  if (!soft) return [];
  if (Array.isArray(soft.playability)) return soft.playability;
  return [];
}

// ---- wiring ----------------------------------------------------------------
el.run.addEventListener('click', () => { void runGate(); });
el.play.addEventListener('click', () => { api.playPause(); });
el.stop.addEventListener('click', () => { api.stop(); });

// ---- initial load ----------------------------------------------------------
window.addEventListener('DOMContentLoaded', async () => {
  setStatus('loading seed…');
  try {
    const res = await fetch('/seed');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const seed = await res.json();
    if (typeof seed.tab === 'string')     el.tab.value     = seed.tab;
    if (typeof seed.source === 'string')  el.source.value  = seed.source;
    if (typeof seed.sidecar === 'string') el.sidecar.value = seed.sidecar;
  } catch (e) {
    showError(`could not load /seed: ${(e && e.message) ? e.message : String(e)}`);
    setStatus('seed failed');
    return;
  }
  setStatus('loading soundfont…');
  await runGate();
});
