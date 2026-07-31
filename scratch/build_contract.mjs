import fs from 'fs';

const source = JSON.parse(fs.readFileSync('projects/your-love-is-a-drug/source.json', 'utf8'));

function midiToPitch(midi) {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const pc = midi % 12;
  const octave = Math.floor(midi / 12) - 1;
  return names[pc] + octave;
}

const phraseDefs = [
  { id: 'theme-a', sourceBars: [1, 8] },
  { id: 'theme-a-8va', sourceBars: [9, 16] },
  { id: 'verse-1', sourceBars: [17, 24] },
  { id: 'verse-1-8va', sourceBars: [25, 32] },
  { id: 'chorus-1', sourceBars: [33, 40] },
  { id: 'chorus-ext', sourceBars: [41, 48] },
  { id: 'chorus-climax', sourceBars: [49, 56] },
  { id: 'outro', sourceBars: [57, 59] }
];

const relocationGroups = [
  {
    sourceBars: [1, 8],
    semitones: -12,
    reason: "Main theme melody (G5..D6) exceeds standard guitar ceiling E5; relocated -12 semitones (G4..D5) for ideal electric guitar vocal register"
  },
  {
    sourceBars: [9, 16],
    semitones: -24,
    reason: "8va high synth theme (G6..D7) exceeds 21-fret ceiling; relocated -24 semitones (G4..D5) to match primary theme register"
  },
  {
    sourceBars: [17, 24],
    semitones: -12,
    reason: "Verse melody (D5..G5) relocated -12 semitones (D4..G4) to stay in guitar range and maintain smooth voice leading"
  },
  {
    sourceBars: [25, 32],
    semitones: -24,
    reason: "8va verse melody (D6..G6) relocated -24 semitones (D4..G4) to match primary verse register"
  },
  {
    sourceBars: [33, 40],
    semitones: -12,
    reason: "Chorus 1 melody (D5..F5) relocated -12 semitones (D4..F4) into solid guitar midrange"
  },
  {
    sourceBars: [41, 48],
    semitones: -12,
    reason: "Chorus extension melody (F4..F5) relocated -12 semitones (F3..F4) to keep complete phrase within guitar window"
  },
  {
    sourceBars: [49, 56],
    semitones: -12,
    reason: "Chorus climax melody (Bb4..G5) relocated -12 semitones (Bb3..G4) into powerful guitar midrange"
  },
  {
    sourceBars: [57, 59],
    semitones: -12,
    reason: "Outro sustained arrival (Eb5, D5) relocated -12 semitones (Eb4, D4)"
  }
];

const phrases = phraseDefs.map(pDef => {
  const events = [];
  for (let bNum = pDef.sourceBars[0]; bNum <= pDef.sourceBars[1]; bNum++) {
    const bar = source.bars.find(b => b.bar === bNum);
    if (!bar) continue;

    const voice0 = bar.voices[0];
    if (!voice0) continue;

    // Group notes by onset to select highest pitch (perceptual melody note)
    const onsetMap = new Map();
    for (const note of voice0.notes) {
      if (note.attack === false) continue; // skip tied continuations
      const key = Math.round(note.onset * 1000) / 1000;
      if (!onsetMap.has(key) || note.midi > onsetMap.get(key).midi) {
        onsetMap.set(key, note);
      }
    }

    for (const [onsetKey, note] of onsetMap.entries()) {
      const dur = note.beats || 0.5;
      events.push({
        bar: bNum,
        onset: note.onset,
        pitch: midiToPitch(note.midi),
        duration: Math.min(dur, 2.0),
        sourceDuration: dur,
        required: true,
        role: "foreground",
        attacks: 1,
        allowReattack: true
      });
    }
  }

  return {
    id: pDef.id,
    sourceBars: pDef.sourceBars,
    events,
    allowedReductions: {
      omitConcurrentSupport: true,
      octaveRelocation: null
    },
    forbidden: [
      { kind: "chords-on-fast-attacks", maxDuration: 0.25 }
    ]
  };
});

const contract = {
  version: 1,
  song: "Your Love is a Drug",
  phrases,
  relocationGroups
};

fs.writeFileSync('projects/your-love-is-a-drug/melody-contract.json', JSON.stringify(contract, null, 2));
console.log('Successfully updated projects/your-love-is-a-drug/melody-contract.json with single top-pitch foreground events');
