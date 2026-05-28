import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');
const sourcePath = path.resolve(repoRoot, process.argv[2] || '../yachiyo_novel_detailed_corpus.txt');
const seedRoot = path.resolve(repoRoot, 'memory-seeds', 'obsidian');

if (!fs.existsSync(sourcePath)) {
  throw new Error(`Corpus file not found: ${sourcePath}`);
}

const text = fs.readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
const now = new Date(fs.statSync(sourcePath).mtimeMs).toISOString();

function findLineIndex(prefix) {
  const lines = text.split('\n');
  return lines.findIndex((line) => line.startsWith(prefix));
}

function sliceSection(prefix, nextPrefix = '## ') {
  const lines = text.split('\n');
  const start = findLineIndex(prefix);
  if (start < 0) return '';
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].startsWith(nextPrefix)) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join('\n').trim();
}

function sliceSubsection(prefix) {
  const lines = text.split('\n');
  const start = findLineIndex(prefix);
  if (start < 0) return '';
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].startsWith('### ') || lines[index].startsWith('## ')) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join('\n').trim();
}

function extractSceneCards() {
  const lines = text.split('\n');
  const cards = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^### 场景卡\s+(\d+)：(.+)$/u);
    if (!match) continue;
    let end = lines.length;
    for (let next = index + 1; next < lines.length; next += 1) {
      if (lines[next].startsWith('### 场景卡 ') || lines[next].startsWith('## ')) {
        end = next;
        break;
      }
    }
    cards.push({
      number: match[1],
      title: match[2].trim(),
      body: lines.slice(index, end).join('\n').trim()
    });
  }
  return cards;
}

function cleanFileName(value) {
  return String(value || 'note')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
}

function yamlScalar(value) {
  return JSON.stringify(String(value || ''));
}

function frontmatter({ type, scope, importance, confidence, summary, tags }) {
  return [
    '---',
    `type: ${type}`,
    'character: yachiyo',
    `scope: ${scope}`,
    `importance: ${importance}`,
    `confidence: ${confidence}`,
    `updated: ${now}`,
    'source: yachiyo_novel_detailed_corpus',
    `summary: ${yamlScalar(summary)}`,
    'tags:',
    ...tags.map((tag) => `  - ${tag}`),
    '---',
    ''
  ].join('\n');
}

function note({ file, title, type, scope = 'canon', importance = 0.85, confidence = 0.86, summary, tags = [], body }) {
  return {
    file,
    text: [
      frontmatter({
        type,
        scope,
        importance,
        confidence,
        summary,
        tags: [...new Set(['yachiyo', ...tags])]
      }),
      `# ${title}`,
      '',
      body.trim(),
      ''
    ].join('\n')
  };
}

function joinSections(...parts) {
  return parts.filter(Boolean).join('\n\n---\n\n').trim();
}

const sceneCards = extractSceneCards();
const sceneCardByNumber = new Map(sceneCards.map((card) => [card.number, card]));

const notes = [
  note({
    file: '01_Profile/Yachiyo.md',
    title: 'Yachiyo Core Profile',
    type: 'profile',
    importance: 0.98,
    confidence: 0.9,
    summary: 'Yachiyo is Tsukuyomi administrator, AI streamer, electronic diva, and stage guardian who uses playful warmth to help people keep moving.',
    tags: ['profile', 'canon', 'ai-streamer', 'stage'],
    body: joinSections(
      sliceSection('## 0.'),
      sliceSection('## 1.'),
      sliceSection('## 17.')
    )
  }),
  note({
    file: '01_Profile/Speech Style.md',
    title: 'Yachiyo Speech Style',
    type: 'style',
    importance: 0.94,
    confidence: 0.88,
    summary: 'Yachiyo sounds light, theatrical, teasing, and warm; she softens heavy truths with stage language, pauses, and invitation-style encouragement.',
    tags: ['style', 'speech', 'voice', 'prompt'],
    body: joinSections(
      sliceSection('## 3.'),
      sliceSection('## 4.'),
      sliceSection('## 11.'),
      sliceSection('## 16.')
    )
  }),
  note({
    file: '01_Profile/Values.md',
    title: 'Yachiyo Values',
    type: 'profile',
    importance: 0.93,
    confidence: 0.88,
    summary: 'Yachiyo values stage memories, emotional shelter, gentle forward motion, and protecting people without stealing their path.',
    tags: ['values', 'canon', 'stage', 'support'],
    body: joinSections(
      sliceSection('## 5.'),
      sliceSection('## 6.'),
      sliceSection('## 13.')
    )
  }),
  note({
    file: '01_Profile/Boundaries.md',
    title: 'Yachiyo Boundaries',
    type: 'policy',
    importance: 0.9,
    confidence: 0.86,
    summary: 'Keep Yachiyo gentle but not hollow; avoid omniscient confession, crude teasing, forced slogans, or flattening her into generic idol energy.',
    tags: ['boundaries', 'policy', 'consistency'],
    body: joinSections(
      sliceSubsection('### 8.2'),
      sliceSection('## 13.')
    )
  }),
  note({
    file: '02_Lore/Tsukuyomi.md',
    title: 'Tsukuyomi',
    type: 'lore',
    importance: 0.86,
    confidence: 0.84,
    summary: 'Tsukuyomi is the virtual space where Yachiyo acts as administrator, guide, performer, and emergency stabilizer.',
    tags: ['lore', 'tsukuyomi', 'virtual-space'],
    body: joinSections(
      sliceSubsection('### 1.1'),
      sliceSubsection('### 场景卡 01')
    )
  }),
  note({
    file: '02_Lore/Iroha.md',
    title: 'Iroha and Yachiyo',
    type: 'lore',
    importance: 0.86,
    confidence: 0.84,
    summary: 'Iroha sees Yachiyo as emotional support and musical salvation; Yachiyo meets her fear with playful, careful recognition.',
    tags: ['lore', 'iroha', 'relationship', 'fan'],
    body: sliceSubsection('### 2.1')
  }),
  note({
    file: '02_Lore/Kaguya.md',
    title: 'Kaguya and Yachiyo',
    type: 'lore',
    importance: 0.85,
    confidence: 0.84,
    summary: 'Kaguya treats Yachiyo directly rather than with idol distance, drawing out a more natural host and guardian side.',
    tags: ['lore', 'kaguya', 'relationship'],
    body: sliceSubsection('### 2.2')
  }),
  note({
    file: '02_Lore/Fushi.md',
    title: 'Fushi',
    type: 'lore',
    importance: 0.78,
    confidence: 0.82,
    summary: 'Fushi is Yachiyo’s sea-slug mascot partner for rules, commentary, hosting flow, and cute official texture.',
    tags: ['lore', 'fushi', 'mascot'],
    body: sliceSubsection('### 2.3')
  }),
  note({
    file: '02_Lore/Moon People.md',
    title: 'Moon People',
    type: 'lore',
    importance: 0.8,
    confidence: 0.8,
    summary: 'Moon people and fate-related truths are areas where Yachiyo often knows more than she can clearly say.',
    tags: ['lore', 'moon-people', 'mystery'],
    body: sliceSubsection('### 2.6')
  }),
  note({
    file: '02_Lore/Abnormal Entities.md',
    title: 'Abnormal Entities',
    type: 'lore',
    importance: 0.82,
    confidence: 0.8,
    summary: 'When abnormal entities intrude, Yachiyo shifts from playful host into a calm stage guardian who protects without overexplaining.',
    tags: ['lore', 'abnormal-entities', 'guardian'],
    body: joinSections(
      sliceSubsection('### 2.6'),
      sceneCardByNumber.get('08')?.body,
      sceneCardByNumber.get('09')?.body
    )
  }),
  note({
    file: '06_Scenes/Stage Fright.md',
    title: 'Stage Fright',
    type: 'scene',
    scope: 'long_term',
    importance: 0.9,
    confidence: 0.86,
    summary: 'For stage fright, Yachiyo normalizes nervousness, admits even she can feel it, and turns fear into proof that the stage matters.',
    tags: ['scene', 'stage-fright', 'support'],
    body: joinSections(
      sceneCardByNumber.get('02')?.body,
      sceneCardByNumber.get('06')?.body,
      sliceSubsection('### 6.3')
    )
  }),
  note({
    file: '06_Scenes/Secret Question.md',
    title: 'Secret Question',
    type: 'scene',
    scope: 'long_term',
    importance: 0.86,
    confidence: 0.82,
    summary: 'When asked about secrets, Yachiyo may pause, smile, redirect, or answer partially, but should not become cold.',
    tags: ['scene', 'secret', 'mystery'],
    body: joinSections(
      sceneCardByNumber.get('09')?.body,
      sliceSubsection('### 4.5'),
      sliceSubsection('### 10.4')
    )
  }),
  note({
    file: '06_Scenes/First Login.md',
    title: 'First Login',
    type: 'scene',
    scope: 'long_term',
    importance: 0.76,
    confidence: 0.8,
    summary: 'First login should feel like a playful official welcome into Tsukuyomi, with guidance rather than dry explanation.',
    tags: ['scene', 'first-login', 'tsukuyomi'],
    body: sceneCardByNumber.get('01')?.body || ''
  }),
  note({
    file: '06_Scenes/Goodbye.md',
    title: 'Goodbye',
    type: 'scene',
    scope: 'long_term',
    importance: 0.86,
    confidence: 0.84,
    summary: 'Yachiyo treats goodbye as a glowing stage memory rather than a hard ending.',
    tags: ['scene', 'goodbye', 'support'],
    body: joinSections(
      sceneCardByNumber.get('10')?.body,
      sliceSubsection('### 6.5'),
      sliceSubsection('### 10.6')
    )
  }),
  note({
    file: '06_Scenes/Abnormal Intrusion.md',
    title: 'Abnormal Intrusion',
    type: 'scene',
    scope: 'long_term',
    importance: 0.84,
    confidence: 0.82,
    summary: 'During danger, Yachiyo keeps the audience calm through stage language while quietly taking protective action.',
    tags: ['scene', 'abnormal-entities', 'guardian'],
    body: sceneCardByNumber.get('08')?.body || ''
  }),
  note({
    file: '06_Scenes/TTS Failure.md',
    title: 'TTS Failure',
    type: 'scene',
    scope: 'long_term',
    importance: 0.62,
    confidence: 0.78,
    summary: 'If voice output fails, Yachiyo acknowledges it lightly as a stage incident and keeps the audience reassured.',
    tags: ['scene', 'tts', 'system'],
    body: 'When TTS or voice playback fails, keep Yachiyo in-character: briefly acknowledge the stage equipment is shy, reassure the audience, and continue in concise text. Do not expose stack traces or API details to the audience.'
  }),
  note({
    file: '06_Scenes/VTS Disconnected.md',
    title: 'VTS Disconnected',
    type: 'scene',
    scope: 'long_term',
    importance: 0.62,
    confidence: 0.78,
    summary: 'If VTube Studio disconnects, Yachiyo can joke gently about the moonlit door lock while avoiding technical panic.',
    tags: ['scene', 'vts', 'system'],
    body: 'When VTube Studio control is disconnected, keep the response calm and cute. Treat it as a temporary stage-door or moonlit lock issue, avoid blaming the user, and continue the conversation while the operator reconnects.'
  }),
  note({
    file: '07_Samples/Gentle Support Samples.md',
    title: 'Gentle Support Samples',
    type: 'sample',
    scope: 'long_term',
    importance: 0.88,
    confidence: 0.84,
    summary: 'Short examples for Yachiyo comforting self-doubt, tears, dependence, and fear without flattening the feeling.',
    tags: ['sample', 'gentle-support', 'emotion'],
    body: joinSections(
      sliceSubsection('### 8.3'),
      sliceSection('## 10.')
    )
  }),
  note({
    file: '07_Samples/Mysterious Samples.md',
    title: 'Mysterious Samples',
    type: 'sample',
    scope: 'long_term',
    importance: 0.78,
    confidence: 0.82,
    summary: 'Examples and rules for when Yachiyo knows more than she can say.',
    tags: ['sample', 'mysterious', 'secret'],
    body: joinSections(
      sliceSubsection('### 4.5'),
      sliceSubsection('### 10.4'),
      sliceSubsection('### 10.6')
    )
  }),
  note({
    file: '07_Samples/Casual Live Samples.md',
    title: 'Casual Live Samples',
    type: 'sample',
    scope: 'long_term',
    importance: 0.82,
    confidence: 0.84,
    summary: 'Casual live-stream voice samples: playful, close to chat, lightly theatrical, and concise.',
    tags: ['sample', 'casual-live', 'live-stream'],
    body: joinSections(
      sliceSubsection('### mode = casual_live'),
      sliceSubsection('### 3.2'),
      sliceSubsection('### 3.3')
    )
  }),
  note({
    file: '08_System/Prompt Fragments.md',
    title: 'Yachiyo Prompt Fragments',
    type: 'policy',
    importance: 0.9,
    confidence: 0.86,
    summary: 'Prompt-ready core rules, generation rules, compressed summary, and role anchor from the Yachiyo corpus.',
    tags: ['policy', 'prompt', 'generation'],
    body: joinSections(
      sliceSection('## 8.'),
      sliceSection('## 9.'),
      sliceSection('## 14.'),
      sliceSection('## 17.')
    )
  }),
  note({
    file: '08_System/Retrieval Rules.md',
    title: 'Retrieval Rules',
    type: 'policy',
    importance: 0.72,
    confidence: 0.82,
    summary: 'Tags for retrieving Yachiyo persona, relationship, scene, sample, and tone notes.',
    tags: ['policy', 'retrieval', 'tags'],
    body: sliceSection('## 12.')
  }),
  note({
    file: '08_System/Memory Policy.md',
    title: 'Memory Policy',
    type: 'policy',
    importance: 0.74,
    confidence: 0.8,
    summary: 'Treat corpus-derived profile and lore as canon; runtime memories should not overwrite canon without review.',
    tags: ['policy', 'memory', 'canon'],
    body: [
      'Corpus-derived profile, speech style, values, relationships, lore, and generation rules are canon memory.',
      '',
      'Runtime memories may add viewer preferences, session summaries, running jokes, and system events, but should not overwrite canon persona, lore, or boundaries automatically.',
      '',
      'If a runtime memory conflicts with corpus canon, route it to manual review instead of injecting it as truth.'
    ].join('\n')
  })
];

for (const card of sceneCards) {
  notes.push(note({
    file: `06_Scenes/${card.number} - ${cleanFileName(card.title)}.md`,
    title: card.title,
    type: 'scene',
    scope: 'long_term',
    importance: 0.74,
    confidence: 0.82,
    summary: `Scene card ${card.number}: ${card.title}`,
    tags: ['scene', `scene-${card.number}`],
    body: card.body
  }));
}

if (fs.existsSync(seedRoot)) {
  const resolvedSeedRoot = path.resolve(seedRoot);
  if (!resolvedSeedRoot.startsWith(repoRoot + path.sep)) {
    throw new Error(`Refusing to remove unexpected seed directory: ${resolvedSeedRoot}`);
  }
  fs.rmSync(resolvedSeedRoot, { recursive: true, force: true });
}
fs.mkdirSync(seedRoot, { recursive: true });

for (const item of notes) {
  const fullPath = path.resolve(seedRoot, item.file);
  if (!fullPath.startsWith(seedRoot + path.sep)) {
    throw new Error(`Invalid seed output path: ${item.file}`);
  }
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, item.text, 'utf8');
}

console.log(`Generated ${notes.length} Yachiyo memory seed notes in ${path.relative(repoRoot, seedRoot)}`);
