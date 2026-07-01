import { exec } from 'child_process';

const DEFAULT_CRITERIA = [
  'Strategic relevance',
  'Evidence quality',
  'Security and platform realism',
  'AI-native workflow credibility',
  'Scalability beyond one expert',
  'Decision and action clarity',
];

const DEFAULT_JURORS = [
  {
    id: 'infosec',
    name: 'InfoSec / Compliance Lead',
    lens: 'endpoint controls, identity, device management, audit evidence, residual risk',
  },
  {
    id: 'platform',
    name: 'Platform Engineering Lead',
    lens: 'developer workflow, supportability, integration architecture, operational burden',
  },
  {
    id: 'product',
    name: 'Product Strategy Lead',
    lens: 'AI-native product development, delivery speed, cross-functional leverage',
  },
  {
    id: 'designops',
    name: 'UX DesignOps Lead',
    lens: 'canvas workflows, research synthesis, onboarding, repeatable design practice',
  },
  {
    id: 'finance',
    name: 'Finance / Procurement Owner',
    lens: 'total cost, procurement precedent, licensing, asset lifecycle, ROI',
  },
];

const DEFAULT_MORE_LENSES = {
  requester: [
    'strategic AI-native workflow capability',
    'UX team scaling and talent productivity',
    'canvas-agent loop reliability',
  ],
  cto: [
    'InfoSec and endpoint platform cost',
    'evidence burden and decision threshold',
    'alternative architecture and Windows/WSL remediation',
  ],
};

const DEFAULT_SIDE_IDS = ['requester', 'cto'];
const DEFAULT_GENERIC_MORE_LENSES = [
  'strategic case and intended outcome',
  'operational feasibility and risk',
  'evidence quality and decision threshold',
];

function cleanWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function truncate(value, max = 900) {
  const text = cleanWhitespace(value);
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}...`;
}

function unique(values) {
  const seen = new Set();
  const out = [];
  for (const value of values || []) {
    const key = cleanWhitespace(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function sideId(value, fallback) {
  const cleaned = cleanWhitespace(value || fallback).toLowerCase();
  const slug = cleaned
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

function normalizeSideConfig(answer, fallback) {
  return {
    id: sideId(answer?.id || fallback.id, fallback.id),
    label: cleanWhitespace(answer?.label || fallback.label),
    position: cleanWhitespace(answer?.position || fallback.position),
  };
}

function caseSides(caseBundle = {}) {
  const answer1 = caseBundle.answer1 || {};
  const answer2 = caseBundle.answer2 || {};
  return [
    normalizeSideConfig(answer1, {
      id: 'requester',
      label: 'Requester',
      position: 'The requested change should be approved or investigated.',
    }),
    normalizeSideConfig(answer2, {
      id: 'cto',
      label: 'CTO',
      position: 'The requested change should not proceed without stronger evidence.',
    }),
  ];
}

function scoreSideIds(options = {}) {
  if (Array.isArray(options)) return options.map((id, index) => sideId(id, DEFAULT_SIDE_IDS[index]));
  if (Array.isArray(options.sideIds)) return options.sideIds.map((id, index) => sideId(id, DEFAULT_SIDE_IDS[index]));
  if (options.caseBundle) return caseSides(options.caseBundle).map((side) => side.id);
  if (options.case) return caseSides(options.case).map((side) => side.id);
  if (options.answer1 || options.answer2) return caseSides(options).map((side) => side.id);
  return DEFAULT_SIDE_IDS;
}

function scoreObject(first, second, options = {}) {
  const [firstId, secondId] = scoreSideIds(options);
  return { [firstId]: first, [secondId]: second };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sideLabel(caseBundle, id) {
  const match = caseSides(caseBundle).find((side) => side.id === id);
  return match?.label || id;
}

function oppositeSideId(caseBundle, id) {
  const sides = caseSides(caseBundle);
  return sides[0].id === id ? sides[1].id : sides[0].id;
}

function sideById(caseBundle, id) {
  return caseSides(caseBundle).find((side) => side.id === id) || caseSides(caseBundle)[0];
}

function normalizeVoteChoice(value, options = {}) {
  const [firstId, secondId] = scoreSideIds(options);
  const sides = options.caseBundle ? caseSides(options.caseBundle) : [
    { id: firstId, label: firstId },
    { id: secondId, label: secondId },
  ];
  const text = cleanWhitespace(value).toLowerCase();
  if (!text) return null;
  if (text === 'tie' || text === 'draw') return 'tie';
  if (text === firstId.toLowerCase() || text === 'answer1' || text === 'side1') return firstId;
  if (text === secondId.toLowerCase() || text === 'answer2' || text === 'side2') return secondId;
  if (text === sides[0].label.toLowerCase()) return firstId;
  if (text === sides[1].label.toLowerCase()) return secondId;
  if (text === 'requester' && firstId === 'requester') return firstId;
  if (text === 'cto' && secondId === 'cto') return secondId;
  return null;
}

function normalizeJurors(jurors) {
  if (!jurors) return DEFAULT_JURORS;
  if (Array.isArray(jurors)) {
    return jurors.map((juror, index) => {
      if (typeof juror === 'string') {
        return { id: `juror-${index + 1}`, name: juror, lens: juror };
      }
      return {
        id: juror.id || `juror-${index + 1}`,
        name: juror.name || juror.id || `Juror ${index + 1}`,
        lens: juror.lens || juror.name || '',
      };
    });
  }
  return String(jurors)
    .split(',')
    .map((name) => cleanWhitespace(name))
    .filter(Boolean)
    .map((name, index) => ({ id: `juror-${index + 1}`, name, lens: name }));
}

function normalizeCaseBundle(caseBundle = {}) {
  const [answer1, answer2] = caseSides(caseBundle);
  return {
    question: caseBundle.question || 'How should the business case be decided?',
    answer1,
    answer2,
    sides: [answer1, answer2],
    criteria: caseBundle.criteria?.length ? caseBundle.criteria : DEFAULT_CRITERIA,
    evidence: caseBundle.evidence || {},
    metadata: caseBundle.metadata || {},
  };
}

function evidenceText(evidence = {}) {
  const slideLines = (evidence.slides || []).map((slide) => {
    const text = Array.isArray(slide.text) ? slide.text.join(' ') : slide.text || '';
    const visual = slide.screenshotPath ? ` screenshot=${slide.screenshotPath}` : '';
    return `${slide.name || slide.id || 'slide'}:${visual} ${truncate(text, 700)}`;
  });
  const visualNotes = Array.isArray(evidence.visualNotes) ? evidence.visualNotes : [];
  return unique([
    ...(evidence.summary ? [evidence.summary] : []),
    ...slideLines,
    ...visualNotes,
  ]).join('\n');
}

function estimateTokens(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value || {});
  return Math.ceil(text.length / 4);
}

function extractJson(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {}
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {}
  }
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(trimmed.slice(first, last + 1));
    } catch {}
  }
  return null;
}

function parseScoreTuple(value, options = {}) {
  const [firstId, secondId] = scoreSideIds(options);
  if (!value) return null;
  if (Array.isArray(value) && value.length >= 2) {
    const first = Number(value[0]);
    const second = Number(value[1]);
    if (Number.isFinite(first) && Number.isFinite(second)) return scoreObject(first, second, options);
  }
  if (typeof value === 'object') {
    const first = Number(value[firstId] ?? value.answer1 ?? value.side1 ?? value.score1 ?? value.requester ?? value[0]);
    const second = Number(value[secondId] ?? value.answer2 ?? value.side2 ?? value.score2 ?? value.cto ?? value[1]);
    if (Number.isFinite(first) && Number.isFinite(second)) return scoreObject(first, second, options);
  }
  const text = String(value);
  const tuple = text.match(/\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/);
  if (tuple) return scoreObject(Number(tuple[1]), Number(tuple[2]), options);
  const bracket = text.match(/\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]/);
  if (bracket) return scoreObject(Number(bracket[1]), Number(bracket[2]), options);
  const dynamic = text.match(new RegExp(`${escapeRegExp(firstId)}\\D+(-?\\d+(?:\\.\\d+)?)[\\s\\S]*?${escapeRegExp(secondId)}\\D+(-?\\d+(?:\\.\\d+)?)`, 'i'));
  if (dynamic) return scoreObject(Number(dynamic[1]), Number(dynamic[2]), options);
  const labelled = text.match(/requester\D+(-?\d+(?:\.\d+)?)[\s\S]*?cto\D+(-?\d+(?:\.\d+)?)/i)
    || text.match(/answer\s*1\D+(-?\d+(?:\.\d+)?)[\s\S]*?answer\s*2\D+(-?\d+(?:\.\d+)?)/i);
  if (labelled) return scoreObject(Number(labelled[1]), Number(labelled[2]), options);
  return null;
}

function scoreGap(score, options = {}) {
  const [firstId, secondId] = scoreSideIds(options);
  const parsed = parseScoreTuple(score, options);
  if (!parsed) return 0;
  return Math.abs(parsed[firstId] - parsed[secondId]);
}

function scoreWinner(score, tieMargin = 1, options = {}) {
  if (typeof tieMargin === 'object' && tieMargin !== null) {
    options = tieMargin;
    tieMargin = Number(options.tieMargin ?? 1);
  }
  const [firstId, secondId] = scoreSideIds(options);
  const parsed = parseScoreTuple(score, options);
  if (!parsed) return 'tie';
  const diff = parsed[firstId] - parsed[secondId];
  if (Math.abs(diff) <= tieMargin) return 'tie';
  return diff > 0 ? firstId : secondId;
}

function checkConvergence(scores = [], options = {}) {
  const epsilon = Number(options.epsilon ?? 3);
  const stableRounds = Math.max(2, Number(options.stableRounds ?? 2));
  const minRounds = Math.max(stableRounds, Number(options.minRounds ?? 2));
  const parsed = scores.map((score) => parseScoreTuple(score, options)).filter(Boolean);
  if (parsed.length < minRounds) {
    return { converged: false, reason: 'min-rounds', gap: parsed.at(-1) ? scoreGap(parsed.at(-1), options) : 0 };
  }
  const recent = parsed.slice(-stableRounds);
  const winners = recent.map((score) => scoreWinner(score, options));
  const sameWinner = new Set(winners).size === 1 && winners[0] !== 'tie';
  const gaps = recent.map((score) => scoreGap(score, options));
  const stableGap = Math.max(...gaps) - Math.min(...gaps) <= epsilon;
  const converged = sameWinner && stableGap;
  return {
    converged,
    reason: converged ? 'stable-gap' : 'unstable',
    gap: gaps.at(-1),
    winner: winners.at(-1),
  };
}

function buildAgentPrompt(task) {
  const [firstId, secondId] = scoreSideIds(task);
  const schema = {
    advocate: '{ "argument": "...", "claims": ["..."], "evidence_gaps": ["..."] }',
    judge: `{ "scores": { "${firstId}": 0, "${secondId}": 0 }, "feedback": { "${firstId}": "...", "${secondId}": "..." }, "rationale": "..." }`,
    juror: `{ "vote": "${firstId}|${secondId}|tie", "scores": { "${firstId}": 0, "${secondId}": 0 }, "rationale": "...", "recommendations": ["..."] }`,
    aggregate: '{ "argument": "...", "claims": ["..."], "evidence_gaps": ["..."] }',
  }[task.type] || '{ "text": "..." }';

  return [
    'You are participating in a D3-style adversarial review.',
    'Return only valid JSON. Do not include markdown fences.',
    `Expected output schema: ${schema}`,
    '',
    JSON.stringify(task, null, 2),
  ].join('\n');
}

function normalizeAgentResult(raw, task) {
  if (raw && typeof raw === 'object') return raw;
  const parsed = extractJson(raw);
  if (parsed) return parsed;
  const text = cleanWhitespace(raw);
  if (task.type === 'advocate' || task.type === 'aggregate') {
    return { argument: text };
  }
  if (task.type === 'judge') {
    const scores = parseScoreTuple(text, task) || scoreObject(50, 50, task);
    return {
      scores,
      feedback: scoreObject(text, text, task),
      rationale: text,
    };
  }
  if (task.type === 'juror') {
    return {
      vote: scoreWinner(parseScoreTuple(text, task), task),
      scores: parseScoreTuple(text, task) || scoreObject(50, 50, task),
      rationale: text,
    };
  }
  return { text };
}

function runCommand(command, prompt, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const child = exec(command, {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024 * 8,
      env: process.env,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.trim() || error.message));
        return;
      }
      resolve(stdout.trim());
    });
    child.stdin?.end(prompt);
  });
}

function createCommandAgent(command, options = {}) {
  if (!command) return null;
  return async (task) => {
    const stdout = await runCommand(command, buildAgentPrompt(task), Number(options.timeoutMs || 60000));
    return normalizeAgentResult(stdout, task);
  };
}

function sidePosition(caseBundle, side) {
  return sideById(caseBundle, side).position;
}

function normalizeFeedback(feedback = {}, caseBundle) {
  const [first, second] = caseSides(caseBundle);
  return {
    [first.id]: feedback[first.id] ?? feedback.answer1 ?? feedback.side1 ?? feedback.requester ?? '',
    [second.id]: feedback[second.id] ?? feedback.answer2 ?? feedback.side2 ?? feedback.cto ?? '',
  };
}

function fallbackAdvocate(task) {
  const side = task.side;
  const round = task.round || 1;
  const evidence = task.evidenceSummary || '';
  const opponent = truncate(task.opponentArgument || '', 180);
  const label = task.sideLabel || side;
  const opponentLabel = task.opponentLabel || 'the opposing side';
  if (side === 'requester') {
    return {
      argument: [
        `Round ${round}: The Requester case should frame the Mac question as operating-model capability, not personal preference.`,
        'The strongest visual evidence is the repeated boundary crossing between canvas, repo, markdown, comments and agents.',
        'The next slide pass should quantify lost loop time and show why ordinary UX/UR hires cannot maintain bespoke bridges.',
        opponent ? `It should answer the CTO objection by separating controllable InfoSec work from recurring workflow drag: ${opponent}` : '',
      ].filter(Boolean).join(' '),
      claims: [
        'The request concerns AI-native UX throughput.',
        'Current bridge complexity is a scaling risk.',
        evidence ? 'The slide visuals show a real cross-surface loop.' : 'The evidence bundle should include visual workflow diagrams.',
      ],
      evidence_gaps: ['quantified time loss', 'pilot success metrics', 'security control inventory'],
    };
  }
  if (side !== 'cto') {
    return {
      argument: [
        `Round ${round}: The ${label} case should make its decision logic explicit against ${opponentLabel}.`,
        `It should connect the stated position to the available slide evidence and the review criteria: ${truncate(task.ownPosition, 220)}`,
        evidence ? 'The visual and textual evidence should be used to distinguish proven facts from interpretation.' : 'The evidence bundle should identify the concrete artifacts supporting this position.',
        opponent ? `It should answer the strongest opposing argument directly: ${opponent}` : '',
      ].filter(Boolean).join(' '),
      claims: [
        `${label} has a coherent position to test.`,
        'The side needs evidence tied to decision criteria.',
        'The argument should separate facts, assumptions and required next evidence.',
      ],
      evidence_gaps: ['decision threshold', 'comparative evidence', 'implementation risks'],
    };
  }
  return {
    argument: [
      `Round ${round}: The CTO case should accept the friction but reject automatic macOS approval.`,
      'The deck must prove macOS is lower-risk and higher-leverage than productising Windows/WSL or moving the workflow into hosted agent infrastructure.',
      'The strongest counter is that endpoint exceptions create support, security and precedent costs that scale beyond the first UX hire.',
      opponent ? `It should address the Requester point without dismissing the strategic workflow signal: ${opponent}` : '',
    ].filter(Boolean).join(' '),
    claims: [
      'Friction is proven, but remedy is not yet proven.',
      'Mac support is enterprise platform work.',
      'Architecture alternatives must be compared.',
    ],
    evidence_gaps: ['costed InfoSec plan', 'Windows remediation estimate', 'hosted-agent comparison'],
  };
}

function fallbackJudge(task) {
  const [firstId, secondId] = scoreSideIds(task);
  const round = Number(task.round || 1);
  const first = Math.min(86, 75 + round * 3);
  const second = Math.min(89, 80 + round * 2);
  return {
    scores: scoreObject(first, second, task),
    feedback: {
      [firstId]: firstId === 'requester'
        ? 'Strengthen the causal chain from visual workflow friction to measurable business loss and explain why macOS beats alternatives.'
        : 'Tie the position more directly to the visual evidence, measurable impact and decision criteria.',
      [secondId]: secondId === 'cto'
        ? 'Acknowledge the visual evidence more directly, then specify the evidence threshold and platform controls required for a pilot.'
        : 'State the evidence threshold, operational constraints and strongest alternative decision path.',
    },
    rationale: 'Both sides improve when they separate the proven workflow problem from the still-open endpoint remedy.',
  };
}

function fallbackJuror(task) {
  const [firstId, secondId] = scoreSideIds(task);
  const sides = caseSides(task);
  const lens = cleanWhitespace([task.juror?.name, task.juror?.lens].filter(Boolean).join(' ')).toLowerCase();
  let vote = 'tie';
  if (firstId === 'requester' && secondId === 'cto') {
    if (/infosec|finance|procurement|compliance|cost|platform|support/.test(lens)) vote = secondId;
    if (/product|ux|design|strategy/.test(lens)) vote = firstId;
  } else {
    const firstNeedle = cleanWhitespace(`${sides[0]?.id || firstId} ${sides[0]?.label || firstId}`).toLowerCase();
    const secondNeedle = cleanWhitespace(`${sides[1]?.id || secondId} ${sides[1]?.label || secondId}`).toLowerCase();
    if (firstNeedle.split(' ').some((part) => part && lens.includes(part))) vote = firstId;
    if (secondNeedle.split(' ').some((part) => part && lens.includes(part))) vote = secondId;
  }
  return {
    vote,
    scores: vote === firstId
      ? scoreObject(84, 80, task)
      : vote === secondId
        ? scoreObject(78, 85, task)
        : scoreObject(82, 82, task),
    rationale: vote === firstId
      ? 'The workflow evidence is strategically important enough to reopen the decision.'
      : vote === secondId
        ? 'The deck has not yet cleared the enterprise platform and evidence threshold for approval.'
        : 'The current evidence does not clearly separate the two positions.',
    recommendations: [
      'Add measured friction and pilot success criteria.',
      'Compare macOS, Windows/WSL productisation and hosted agent infrastructure.',
    ],
  };
}

function fallbackAggregate(task) {
  const defenses = (task.defenses || []).map((defense) => defense.argument || defense).filter(Boolean);
  return {
    argument: truncate(unique(defenses).join(' '), 900),
    claims: unique((task.defenses || []).flatMap((defense) => defense.claims || [])).slice(0, 8),
    evidence_gaps: unique((task.defenses || []).flatMap((defense) => defense.evidence_gaps || [])).slice(0, 8),
  };
}

async function callAgent(agent, task) {
  if (agent) return normalizeAgentResult(await agent(task), task);
  if (task.type === 'advocate') return fallbackAdvocate(task);
  if (task.type === 'judge') return fallbackJudge(task);
  if (task.type === 'juror') return fallbackJuror(task);
  if (task.type === 'aggregate') return fallbackAggregate(task);
  return { text: '' };
}

function defenseFor(round, side) {
  return round.defenses?.[side] || round[side] || {};
}

function roundTokenCost(round, caseBundle) {
  const [first, second] = caseSides(caseBundle);
  return estimateTokens({
    [first.id]: defenseFor(round, first.id)?.argument,
    [second.id]: defenseFor(round, second.id)?.argument,
    judge: round.judge,
  });
}

function buildAdvocateTask(caseBundle, state, side, round, options = {}) {
  const prev = state.rounds.at(-1);
  const ownSide = sideById(caseBundle, side);
  const opponent = oppositeSideId(caseBundle, side);
  const opponentInfo = sideById(caseBundle, opponent);
  const ownHistory = state.rounds.map((entry) => defenseFor(entry, side)?.argument).filter(Boolean);
  return {
    type: 'advocate',
    protocol: 'SAMRE',
    side,
    sideLabel: ownSide.label,
    opponentSide: opponent,
    opponentLabel: opponentInfo.label,
    answer1: caseBundle.answer1,
    answer2: caseBundle.answer2,
    round,
    maxRounds: options.maxRounds,
    question: caseBundle.question,
    criteria: caseBundle.criteria,
    ownPosition: sidePosition(caseBundle, side),
    opponentPosition: sidePosition(caseBundle, opponent),
    evidenceSummary: evidenceText(caseBundle.evidence),
    latestFeedback: state.feedback?.[side] || '',
    opponentArgument: prev ? defenseFor(prev, opponent)?.argument || '' : '',
    teamArguments: ownHistory,
  };
}

function buildJudgeTask(caseBundle, firstDefense, secondDefense, state, round, options = {}) {
  const [first, second] = caseSides(caseBundle);
  return {
    type: 'judge',
    protocol: state.protocol,
    round,
    maxRounds: options.maxRounds,
    question: caseBundle.question,
    criteria: caseBundle.criteria,
    answer1: caseBundle.answer1,
    answer2: caseBundle.answer2,
    previousScores: state.scores,
    answer1Defense: firstDefense.argument || '',
    answer2Defense: secondDefense.argument || '',
    defenses: {
      [first.id]: firstDefense.argument || '',
      [second.id]: secondDefense.argument || '',
    },
    requesterDefense: first.id === 'requester' ? firstDefense.argument || '' : undefined,
    ctoDefense: second.id === 'cto' ? secondDefense.argument || '' : undefined,
    evidenceSummary: evidenceText(caseBundle.evidence),
  };
}

function buildJurorTask(caseBundle, juror, transcript, state) {
  return {
    type: 'juror',
    juror,
    question: caseBundle.question,
    criteria: caseBundle.criteria,
    answer1: caseBundle.answer1,
    answer2: caseBundle.answer2,
    sideIds: caseSides(caseBundle).map((side) => side.id),
    transcript,
    scores: state.scores,
    evidenceSummary: evidenceText(caseBundle.evidence),
  };
}

function aggregateVotes(votes = [], scores = [], options = {}) {
  const [firstId, secondId] = scoreSideIds(options);
  const counts = { [firstId]: 0, [secondId]: 0, tie: 0 };
  for (const vote of votes) {
    const choice = normalizeVoteChoice(vote.vote, options) || scoreWinner(vote.scores, options);
    counts[choice] += 1;
  }
  let winner = 'tie';
  if (counts[firstId] > counts[secondId] && counts[firstId] > counts.tie) winner = firstId;
  else if (counts[secondId] > counts[firstId] && counts[secondId] > counts.tie) winner = secondId;
  else {
    const cumulative = scores.reduce((acc, score) => {
      const parsed = parseScoreTuple(score, options);
      if (!parsed) return acc;
      acc[firstId] += parsed[firstId];
      acc[secondId] += parsed[secondId];
      return acc;
    }, { [firstId]: 0, [secondId]: 0 });
    winner = scoreWinner(cumulative, options);
  }
  return { winner, counts };
}

function buildTranscript(caseBundle, state) {
  const sides = caseSides(caseBundle);
  return {
    protocol: state.protocol,
    question: caseBundle.question,
    criteria: caseBundle.criteria,
    answer1: caseBundle.answer1,
    answer2: caseBundle.answer2,
    sides,
    evidence: {
      summary: caseBundle.evidence?.summary || '',
      slideCount: caseBundle.evidence?.slides?.length || 0,
      slides: (caseBundle.evidence?.slides || []).map((slide) => ({
        id: slide.id,
        name: slide.name,
        screenshotPath: slide.screenshotPath,
      })),
    },
    rounds: state.rounds,
  };
}

function recommendationsFrom(result) {
  const sides = caseSides(result.case);
  const gaps = unique([
    ...(result.rounds || []).flatMap((round) => sides.flatMap((side) => defenseFor(round, side.id)?.evidence_gaps || [])),
    ...(result.jury?.votes || []).flatMap((vote) => vote.recommendations || []),
  ]).slice(0, 10);
  const judgeFeedback = unique((result.rounds || []).flatMap((round) => {
    const feedback = normalizeFeedback(round.judge?.feedback, result.case);
    return sides.map((side) => feedback[side.id]);
  })).slice(0, 10);
  return {
    evidenceGaps: gaps,
    slideRecommendations: judgeFeedback,
  };
}

async function runSAMRE(caseBundleInput, options = {}) {
  const caseBundle = normalizeCaseBundle(caseBundleInput);
  const sides = caseSides(caseBundle);
  const [first, second] = sides;
  const scoreOptions = { ...options, caseBundle };
  const agent = options.agent || createCommandAgent(options.command, { timeoutMs: options.commandTimeout });
  const maxRounds = Math.max(1, Number(options.maxRounds || options.rounds || 5));
  const budget = Number(options.budget || 12000);
  const state = {
    protocol: 'SAMRE',
    rounds: [],
    scores: [],
    feedback: {},
    tokenCost: 0,
  };

  let stopReason = 'max-rounds';
  for (let round = 1; round <= maxRounds; round += 1) {
    const [firstDefense, secondDefense] = await Promise.all([
      callAgent(agent, buildAdvocateTask(caseBundle, state, first.id, round, { maxRounds })),
      callAgent(agent, buildAdvocateTask(caseBundle, state, second.id, round, { maxRounds })),
    ]);
    const judge = await callAgent(agent, buildJudgeTask(caseBundle, firstDefense, secondDefense, state, round, { maxRounds }));
    const score = parseScoreTuple(judge.scores, scoreOptions)
      || parseScoreTuple(judge.rationale, scoreOptions)
      || scoreObject(50, 50, scoreOptions);
    state.scores.push(score);
    state.feedback = normalizeFeedback(judge.feedback, caseBundle);
    const roundEntry = {
      round,
      defenses: {
        [first.id]: firstDefense,
        [second.id]: secondDefense,
      },
      [first.id]: firstDefense,
      [second.id]: secondDefense,
      judge,
      score,
    };
    state.rounds.push(roundEntry);
    state.tokenCost += roundTokenCost(roundEntry, caseBundle);

    const convergence = checkConvergence(state.scores, scoreOptions);
    if (convergence.converged) {
      stopReason = convergence.reason;
      break;
    }
    if (state.tokenCost >= budget) {
      stopReason = 'budget';
      break;
    }
  }

  const transcript = buildTranscript(caseBundle, state);
  const jurors = normalizeJurors(options.jurors);
  const votes = await Promise.all(jurors.map((juror) => callAgent(agent, buildJurorTask(caseBundle, juror, transcript, state))));
  const aggregation = aggregateVotes(votes, state.scores, scoreOptions);
  const result = {
    protocol: 'SAMRE',
    case: caseBundle,
    stopReason,
    rounds: state.rounds,
    scores: state.scores,
    tokenCost: state.tokenCost,
    transcript,
    jury: { jurors, votes, ...aggregation },
  };
  result.recommendations = recommendationsFrom(result);
  return result;
}

function buildMoreAdvocateTask(caseBundle, side, lens, index, options = {}) {
  const ownSide = sideById(caseBundle, side);
  const opponent = oppositeSideId(caseBundle, side);
  const opponentInfo = sideById(caseBundle, opponent);
  return {
    type: 'advocate',
    protocol: 'MORE',
    side,
    sideLabel: ownSide.label,
    opponentSide: opponent,
    opponentLabel: opponentInfo.label,
    answer1: caseBundle.answer1,
    answer2: caseBundle.answer2,
    advocateIndex: index + 1,
    lens,
    question: caseBundle.question,
    criteria: caseBundle.criteria,
    ownPosition: sidePosition(caseBundle, side),
    opponentPosition: sidePosition(caseBundle, opponent),
    evidenceSummary: evidenceText(caseBundle.evidence),
    maxAdvocates: options.moreK,
  };
}

async function aggregateDefenses(agent, caseBundle, side, defenses, options = {}) {
  return callAgent(agent, {
    type: 'aggregate',
    protocol: 'MORE',
    side,
    question: caseBundle.question,
    criteria: caseBundle.criteria,
    answer1: caseBundle.answer1,
    answer2: caseBundle.answer2,
    ownPosition: sidePosition(caseBundle, side),
    opponentPosition: sidePosition(caseBundle, oppositeSideId(caseBundle, side)),
    defenses,
    evidenceSummary: evidenceText(caseBundle.evidence),
    options,
  });
}

async function runMORE(caseBundleInput, options = {}) {
  const caseBundle = normalizeCaseBundle(caseBundleInput);
  const sides = caseSides(caseBundle);
  const [first, second] = sides;
  const scoreOptions = { ...options, caseBundle };
  const agent = options.agent || createCommandAgent(options.command, { timeoutMs: options.commandTimeout });
  const moreK = Math.max(1, Number(options.moreK || options.k || 3));
  const firstLenses = (options.moreLenses?.[first.id] || options.moreLenses?.answer1 || DEFAULT_MORE_LENSES[first.id] || DEFAULT_GENERIC_MORE_LENSES).slice(0, moreK);
  const secondLenses = (options.moreLenses?.[second.id] || options.moreLenses?.answer2 || DEFAULT_MORE_LENSES[second.id] || DEFAULT_GENERIC_MORE_LENSES).slice(0, moreK);

  const [firstDefenses, secondDefenses] = await Promise.all([
    Promise.all(firstLenses.map((lens, index) => callAgent(agent, buildMoreAdvocateTask(caseBundle, first.id, lens, index, { moreK })))),
    Promise.all(secondLenses.map((lens, index) => callAgent(agent, buildMoreAdvocateTask(caseBundle, second.id, lens, index, { moreK })))),
  ]);
  const [firstDefense, secondDefense] = await Promise.all([
    aggregateDefenses(agent, caseBundle, first.id, firstDefenses, options),
    aggregateDefenses(agent, caseBundle, second.id, secondDefenses, options),
  ]);
  const state = {
    protocol: 'MORE',
    rounds: [],
    scores: [],
    feedback: {},
    tokenCost: 0,
  };
  const judge = await callAgent(agent, buildJudgeTask(caseBundle, firstDefense, secondDefense, state, 1, { maxRounds: 1 }));
  const score = parseScoreTuple(judge.scores, scoreOptions)
    || parseScoreTuple(judge.rationale, scoreOptions)
    || scoreObject(50, 50, scoreOptions);
  const roundEntry = {
    round: 1,
    defenses: {
      [first.id]: firstDefense,
      [second.id]: secondDefense,
    },
    defensesBySide: {
      [first.id]: firstDefenses,
      [second.id]: secondDefenses,
    },
    [first.id]: firstDefense,
    [second.id]: secondDefense,
    [`${first.id}Defenses`]: firstDefenses,
    [`${second.id}Defenses`]: secondDefenses,
    judge,
    score,
  };
  state.rounds.push(roundEntry);
  state.scores.push(score);
  state.tokenCost = roundTokenCost(roundEntry, caseBundle);
  const transcript = buildTranscript(caseBundle, state);
  const jurors = normalizeJurors(options.jurors);
  const votes = await Promise.all(jurors.map((juror) => callAgent(agent, buildJurorTask(caseBundle, juror, transcript, state))));
  const aggregation = aggregateVotes(votes, state.scores, scoreOptions);
  const result = {
    protocol: 'MORE',
    case: caseBundle,
    stopReason: 'one-round',
    rounds: state.rounds,
    scores: state.scores,
    tokenCost: state.tokenCost,
    transcript,
    jury: { jurors, votes, ...aggregation },
  };
  result.recommendations = recommendationsFrom(result);
  return result;
}

async function runAdversarialReview(caseBundle, options = {}) {
  const protocol = String(options.protocol || 'samre').toLowerCase();
  if (protocol === 'more') return runMORE(caseBundle, options);
  if (protocol === 'samre') return runSAMRE(caseBundle, options);
  throw new Error(`Unsupported protocol: ${options.protocol}`);
}

function formatSideName(resultOrCase, side) {
  if (side === 'tie') return 'Tie';
  const caseBundle = resultOrCase?.case || resultOrCase || {};
  return sideLabel(caseBundle, side);
}

function formatReviewMarkdown(result) {
  const sides = caseSides(result.case);
  const [first, second] = sides;
  const scoreOptions = { caseBundle: result.case };
  const lines = [];
  lines.push(`# Adversarial Review (${result.protocol})`, '');
  lines.push(`**Question:** ${result.case.question}`, '');
  lines.push(`**Final jury posture:** ${formatSideName(result, result.jury.winner)}`);
  lines.push(`**Stop reason:** ${result.stopReason}`);
  lines.push(`**Estimated token cost:** ${result.tokenCost}`, '');
  lines.push('## Scores', '');
  result.scores.forEach((score, index) => {
    const parsed = parseScoreTuple(score, scoreOptions);
    lines.push(`- Round ${index + 1}: ${first.label} ${parsed?.[first.id] ?? '?'} / ${second.label} ${parsed?.[second.id] ?? '?'}`);
  });
  lines.push('', '## Round Transcript', '');
  result.rounds.forEach((round) => {
    const feedback = normalizeFeedback(round.judge?.feedback, result.case);
    lines.push(`### Round ${round.round}`);
    for (const side of sides) {
      lines.push(`- ${side.label}: ${truncate(defenseFor(round, side.id)?.argument, 700)}`);
    }
    if (round.judge?.rationale) lines.push(`- Judge: ${truncate(round.judge.rationale, 500)}`);
    for (const side of sides) {
      if (feedback[side.id]) lines.push(`- Feedback to ${side.label}: ${truncate(feedback[side.id], 350)}`);
    }
    lines.push('');
  });
  lines.push('## Jury', '');
  result.jury.votes.forEach((vote, index) => {
    const juror = result.jury.jurors[index];
    const voteChoice = normalizeVoteChoice(vote.vote, scoreOptions) || scoreWinner(vote.scores, scoreOptions);
    lines.push(`- ${juror?.name || `Juror ${index + 1}`}: ${formatSideName(result, voteChoice)} - ${truncate(vote.rationale, 300)}`);
  });
  lines.push('', '## Recommended Slide Improvements', '');
  const slideRecommendations = result.recommendations?.slideRecommendations || [];
  if (slideRecommendations.length) {
    slideRecommendations.forEach((item) => lines.push(`- ${item}`));
  } else {
    lines.push('- No recommendations generated.');
  }
  lines.push('', '## Evidence Gaps', '');
  const gaps = result.recommendations?.evidenceGaps || [];
  if (gaps.length) gaps.forEach((gap) => lines.push(`- ${gap}`));
  else lines.push('- No evidence gaps generated.');
  lines.push('');
  return lines.join('\n');
}

export {
  DEFAULT_CRITERIA,
  DEFAULT_JURORS,
  aggregateVotes,
  buildAgentPrompt,
  checkConvergence,
  createCommandAgent,
  estimateTokens,
  formatReviewMarkdown,
  normalizeAgentResult,
  parseScoreTuple,
  runAdversarialReview,
  runMORE,
  runSAMRE,
  scoreGap,
  scoreWinner,
};
