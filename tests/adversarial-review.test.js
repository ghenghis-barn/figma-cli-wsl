import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateVotes,
  checkConvergence,
  formatReviewMarkdown,
  parseScoreTuple,
  runMORE,
  runSAMRE,
  scoreWinner,
} from '../src/adversarial-review.js';

const CASE_BUNDLE = {
  question: 'Should Aurora support Macs for the expanding UX team?',
  answer1: {
    id: 'requester',
    label: 'Requester',
    position: 'Approve or investigate macOS as a UX endpoint.',
  },
  answer2: {
    id: 'cto',
    label: 'CTO',
    position: 'Retain Lenovo Windows unless evidence clears the threshold.',
  },
  evidence: {
    summary: 'The deck shows Windows/WSL bridge friction and CTO counter-arguments.',
    slides: [
      {
        id: '1:1',
        name: 'Workflow boundary',
        text: ['The canvas-agent loop crosses the Windows/WSL boundary.'],
        screenshotPath: '/tmp/workflow.png',
      },
    ],
  },
};

test('parseScoreTuple accepts tuples, arrays and labelled score objects', () => {
  assert.deepEqual(parseScoreTuple('(82, 91)'), { requester: 82, cto: 91 });
  assert.deepEqual(parseScoreTuple('[73, 70]'), { requester: 73, cto: 70 });
  assert.deepEqual(parseScoreTuple({ requester: 88, cto: 84 }), { requester: 88, cto: 84 });
  assert.deepEqual(parseScoreTuple({ answer1: 77, answer2: 78 }), { requester: 77, cto: 78 });
  assert.deepEqual(parseScoreTuple({ product: 91, security: 86 }, { sideIds: ['product', 'security'] }), { product: 91, security: 86 });
});

test('checkConvergence requires stable winner and stable gap', () => {
  const unstable = checkConvergence([
    { requester: 80, cto: 75 },
    { requester: 77, cto: 81 },
  ]);
  assert.equal(unstable.converged, false);

  const stable = checkConvergence([
    { requester: 78, cto: 84 },
    { requester: 80, cto: 86 },
  ], { epsilon: 3, stableRounds: 2 });
  assert.equal(stable.converged, true);
  assert.equal(stable.winner, 'cto');
});

test('aggregateVotes uses judge score tiebreak when jury is tied', () => {
  const result = aggregateVotes([
    { vote: 'requester' },
    { vote: 'cto' },
  ], [
    { requester: 80, cto: 86 },
    { requester: 81, cto: 87 },
  ]);
  assert.equal(result.winner, 'cto');
  assert.deepEqual(result.counts, { requester: 1, cto: 1, tie: 0 });
});

test('runSAMRE records iterative rounds and stops on convergence', async () => {
  const calls = [];
  const agent = async (task) => {
    calls.push(task.type);
    if (task.type === 'advocate') {
      return { argument: `${task.side} round ${task.round}`, evidence_gaps: [`gap-${task.side}`] };
    }
    if (task.type === 'judge') {
      return {
        scores: task.round === 1 ? { requester: 80, cto: 87 } : { requester: 81, cto: 88 },
        feedback: {
          requester: 'Quantify workflow drag.',
          cto: 'State the pilot threshold.',
        },
        rationale: 'The CTO side remains ahead but the gap is stable.',
      };
    }
    if (task.type === 'juror') {
      return { vote: 'cto', rationale: `${task.juror.name} wants stronger controls.` };
    }
    throw new Error(`Unexpected task ${task.type}`);
  };

  const result = await runSAMRE(CASE_BUNDLE, {
    agent,
    maxRounds: 5,
    epsilon: 2,
    stableRounds: 2,
  });

  assert.equal(result.protocol, 'SAMRE');
  assert.equal(result.stopReason, 'stable-gap');
  assert.equal(result.rounds.length, 2);
  assert.equal(result.jury.winner, 'cto');
  assert.ok(calls.includes('advocate'));
  assert.ok(calls.includes('judge'));
  assert.ok(calls.includes('juror'));
  assert.match(formatReviewMarkdown(result), /Quantify workflow drag/);
});

test('runMORE uses parallel defenses and the same final result shape', async () => {
  const agent = async (task) => {
    if (task.type === 'advocate') {
      return { argument: `${task.side} ${task.lens}`, claims: [task.lens] };
    }
    if (task.type === 'aggregate') {
      return {
        argument: task.defenses.map((defense) => defense.argument).join(' / '),
        claims: task.defenses.flatMap((defense) => defense.claims || []),
      };
    }
    if (task.type === 'judge') {
      return {
        scores: { requester: 86, cto: 84 },
        feedback: {
          requester: 'Good strategic frame.',
          cto: 'Needs stronger alternative architecture.',
        },
        rationale: 'Requester is more compelling in this one-round pass.',
      };
    }
    if (task.type === 'juror') {
      return { vote: 'requester', rationale: 'The workflow evidence is compelling.' };
    }
    throw new Error(`Unexpected task ${task.type}`);
  };

  const result = await runMORE(CASE_BUNDLE, { agent, moreK: 2 });

  assert.equal(result.protocol, 'MORE');
  assert.equal(result.stopReason, 'one-round');
  assert.equal(result.rounds.length, 1);
  assert.equal(result.rounds[0].requesterDefenses.length, 2);
  assert.equal(scoreWinner(result.scores[0]), 'requester');
  assert.equal(result.jury.winner, 'requester');
});

test('runSAMRE supports configurable side ids and labels', async () => {
  const customCase = {
    question: 'Should the team ship the hosted workflow or keep it local?',
    answer1: {
      id: 'hosted',
      label: 'Hosted Workflow',
      position: 'Move the workflow into managed hosted infrastructure.',
    },
    answer2: {
      id: 'local',
      label: 'Local Workflow',
      position: 'Keep the workflow on local developer machines.',
    },
    evidence: {
      summary: 'The slides compare operational control, latency and support burden.',
      slides: [],
    },
  };
  const seenSides = [];
  const agent = async (task) => {
    if (task.type === 'advocate') {
      seenSides.push(task.side);
      return { argument: `${task.sideLabel} argument`, evidence_gaps: [`gap-${task.side}`] };
    }
    if (task.type === 'judge') {
      return {
        scores: { hosted: 90, local: 82 },
        feedback: {
          hosted: 'Add migration sequencing.',
          local: 'Quantify support burden.',
        },
        rationale: 'Hosted is stronger under the criteria.',
      };
    }
    if (task.type === 'juror') {
      return { vote: 'hosted', rationale: 'Operational leverage is stronger.' };
    }
    throw new Error(`Unexpected task ${task.type}`);
  };

  const result = await runSAMRE(customCase, {
    agent,
    maxRounds: 1,
    jurors: ['Platform Lead'],
  });

  assert.deepEqual(seenSides.sort(), ['hosted', 'local']);
  assert.deepEqual(result.scores[0], { hosted: 90, local: 82 });
  assert.equal(result.jury.winner, 'hosted');
  assert.equal(result.jury.counts.hosted, 1);
  assert.equal(result.rounds[0].hosted.argument, 'Hosted Workflow argument');
  assert.match(formatReviewMarkdown(result), /Hosted Workflow 90 \/ Local Workflow 82/);
});
