// Commands: adversarial review (D3-style SAMRE/MORE slide review)
import chalk from 'chalk';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { tmpdir } from 'os';
import {
  DEFAULT_CRITERIA,
  DEFAULT_JURORS,
  formatReviewMarkdown,
  runAdversarialReview,
} from '../adversarial-review.js';
import {
  checkConnection,
  fastEval,
  loadConfig,
  program,
} from '../lib/cli-core.js';

function parseList(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseEvalResult(value) {
  if (typeof value === 'string') return JSON.parse(value);
  return value;
}

function parseJsonOption(value, label) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`Invalid ${label} JSON: ${error.message}`);
  }
}

function safeFilePart(value) {
  return String(value || 'node')
    .replace(/:/g, '-')
    .replace(/[^a-zA-Z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'node';
}

function ensureDir(path) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

function buildEvidenceEvalCode(options = {}) {
  const pageName = options.page || '';
  const frameFilters = parseList(options.frames).map((item) => item.toLowerCase());
  const nodeIds = parseList(options.nodes);
  const includeScreenshots = options.screenshots !== false;
  const screenshotScale = Number(options.screenshotScale || 0.2);
  const screenshotMax = Number(options.screenshotMax || 1200);
  const textLimit = Number(options.textLimit || 500);
  const maxTextNodes = Number(options.maxTextNodes || 80);
  const limit = Number(options.limit || 16);

  return `(async () => {
    await figma.loadAllPagesAsync();
    const pageName = ${JSON.stringify(pageName)};
    const filters = ${JSON.stringify(frameFilters)};
    const nodeIds = ${JSON.stringify(nodeIds)};
    const includeScreenshots = ${JSON.stringify(includeScreenshots)};
    const screenshotScale = ${JSON.stringify(screenshotScale)};
    const screenshotMax = ${JSON.stringify(screenshotMax)};
    const textLimit = ${JSON.stringify(textLimit)};
    const maxTextNodes = ${JSON.stringify(maxTextNodes)};
    const limit = ${JSON.stringify(limit)};

    const page = pageName
      ? figma.root.children.find(p => p.name.toLowerCase().includes(pageName.toLowerCase()))
      : figma.currentPage;
    if (!page) return JSON.stringify({ error: 'Page not found', pageName });
    if (typeof page.loadAsync === 'function') await page.loadAsync();

    const textOf = (value, max = textLimit) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, max);
    const collectText = (node, out = []) => {
      if (out.length >= maxTextNodes) return out;
      if (node.type === 'TEXT') {
        const text = textOf(node.characters || '');
        if (text) {
          out.push({
            name: node.name,
            text,
            x: Math.round(node.absoluteTransform?.[0]?.[2] || node.x || 0),
            y: Math.round(node.absoluteTransform?.[1]?.[2] || node.y || 0),
            w: Math.round(node.width || 0),
            h: Math.round(node.height || 0),
            size: typeof node.fontSize === 'number' ? node.fontSize : null
          });
        }
      }
      if ('children' in node) {
        for (const child of node.children) {
          if (out.length >= maxTextNodes) break;
          collectText(child, out);
        }
      }
      return out;
    };

    const collectChildren = (node) => {
      if (!('children' in node)) return [];
      return node.children.slice(0, 24).map(child => ({
        id: child.id,
        name: child.name,
        type: child.type,
        x: Math.round(child.x || 0),
        y: Math.round(child.y || 0),
        w: Math.round(child.width || 0),
        h: Math.round(child.height || 0),
      }));
    };

    let nodes = [];
    if (nodeIds.length) {
      const loaded = await Promise.all(nodeIds.map(id => figma.getNodeByIdAsync(id)));
      nodes = loaded.filter(Boolean);
    } else if (filters.length) {
      nodes = page.children.filter(n =>
        n.type === 'FRAME' && filters.some(filter => n.name.toLowerCase().includes(filter))
      );
    } else if (page === figma.currentPage && figma.currentPage.selection.length) {
      nodes = figma.currentPage.selection.filter(n => 'exportAsync' in n);
    } else {
      nodes = page.children.filter(n =>
        n.type === 'FRAME' && Math.round(n.width || 0) === 1920 && Math.round(n.height || 0) === 1080
      );
    }

    nodes = nodes
      .filter(n => n && 'exportAsync' in n)
      .sort((a, b) => (a.y - b.y) || (a.x - b.x))
      .slice(0, limit);

    const slides = [];
    for (const node of nodes) {
      let screenshotBase64 = null;
      let screenshot = null;
      let screenshotError = null;
      if (includeScreenshots) {
        try {
          const nodeWidth = node.width || 100;
          const nodeHeight = node.height || 100;
          let finalScale = screenshotScale;
          const maxNodeDim = Math.max(nodeWidth, nodeHeight);
          if (maxNodeDim * finalScale > screenshotMax) finalScale = screenshotMax / maxNodeDim;
          const bytes = await node.exportAsync({
            format: 'PNG',
            constraint: { type: 'SCALE', value: finalScale }
          });
          screenshotBase64 = figma.base64Encode(bytes);
          screenshot = {
            width: Math.round(nodeWidth * finalScale),
            height: Math.round(nodeHeight * finalScale),
            scale: finalScale
          };
        } catch (error) {
          screenshotError = error && error.message ? error.message : String(error);
        }
      }
      slides.push({
        id: node.id,
        name: node.name,
        type: node.type,
        x: Math.round(node.x || 0),
        y: Math.round(node.y || 0),
        width: Math.round(node.width || 0),
        height: Math.round(node.height || 0),
        childCount: 'children' in node ? node.children.length : 0,
        text: collectText(node).sort((a, b) => a.y - b.y || a.x - b.x),
        children: collectChildren(node),
        screenshot,
        screenshotError,
        screenshotBase64
      });
    }

    return JSON.stringify({
      fileName: figma.root.name,
      page: { id: page.id, name: page.name },
      selectedFrameCount: slides.length,
      filters,
      nodeIds,
      slides
    });
  })()`;
}

function saveScreenshots(bundle, options = {}) {
  const dir = resolve(options.screenshotDir || join(tmpdir(), 'figma-adversarial-review'));
  try {
    ensureDir(dir);
  } catch (error) {
    for (const slide of bundle.slides || []) {
      if (!slide.screenshotBase64) continue;
      slide.screenshotError = `Could not create screenshot directory ${dir}: ${error.message}`;
      delete slide.screenshotBase64;
    }
    return bundle;
  }
  for (const slide of bundle.slides || []) {
    if (!slide.screenshotBase64) continue;
    const file = join(dir, `${safeFilePart(slide.name)}-${safeFilePart(slide.id)}.png`);
    try {
      writeFileSync(file, Buffer.from(slide.screenshotBase64, 'base64'));
      slide.screenshotPath = file;
    } catch (error) {
      slide.screenshotError = `Could not write screenshot ${file}: ${error.message}`;
    }
    delete slide.screenshotBase64;
  }
  return bundle;
}

function slideText(slide) {
  return (slide.text || []).map((entry) => entry.text).filter(Boolean);
}

function buildCaseBundle(evidenceBundle, options = {}) {
  const criteria = parseList(options.criteria);
  const answer1Label = options.answer1Label || options.requesterLabel || 'Requester';
  const answer2Label = options.answer2Label || options.ctoLabel || 'CTO';
  const answer1Position = options.answer1Position
    || options.requesterPosition
    || 'Reopen and approve or pilot a macOS endpoint path because the UX operating environment is now strategic for AI-native workflows.';
  const answer2Position = options.answer2Position
    || options.ctoPosition
    || 'Keep Lenovo Windows as the company standard unless the request proves a material workflow gain that outweighs security, platform and precedent costs.';
  const slides = (evidenceBundle.slides || []).map((slide) => ({
    id: slide.id,
    name: slide.name,
    x: slide.x,
    y: slide.y,
    width: slide.width,
    height: slide.height,
    screenshot: slide.screenshot,
    screenshotPath: slide.screenshotPath,
    screenshotError: slide.screenshotError,
    text: slideText(slide),
    childCount: slide.childCount,
  }));
  return {
    question: options.question || 'How should Aurora decide whether to support macOS hardware for the expanding UX team?',
    answer1: {
      id: options.answer1Id || options.requesterId || 'requester',
      label: answer1Label,
      position: answer1Position,
    },
    answer2: {
      id: options.answer2Id || options.ctoId || 'cto',
      label: answer2Label,
      position: answer2Position,
    },
    criteria: criteria.length ? criteria : DEFAULT_CRITERIA,
    evidence: {
      summary: [
        `Figma file: ${evidenceBundle.fileName}`,
        `Page: ${evidenceBundle.page?.name}`,
        `Slides reviewed: ${slides.length}`,
        'Evidence includes extracted text and frame metadata.',
        'Screenshots are attempted by default for visual context; review continues if capture is unavailable.',
      ].join('\n'),
      slides,
      visualNotes: slides.flatMap((slide) => {
        const notes = [];
        if (slide.screenshotPath) notes.push(`Visual screenshot captured for "${slide.name}" at ${slide.screenshotPath}`);
        if (slide.screenshotError) notes.push(`Visual screenshot unavailable for "${slide.name}": ${slide.screenshotError}`);
        return notes;
      }),
    },
    metadata: {
      source: 'figma-cli adversarial review',
      fileName: evidenceBundle.fileName,
      page: evidenceBundle.page,
      generatedAt: new Date().toISOString(),
    },
  };
}

function outputPath(defaultName) {
  return join(tmpdir(), defaultName);
}

function writeJson(path, value) {
  const outPath = resolve(path);
  ensureDir(dirname(outPath));
  writeFileSync(outPath, JSON.stringify(value, null, 2));
  return outPath;
}

function winnerLabel(result, winner) {
  if (winner === 'tie') return 'Tie';
  const sides = [result.case?.answer1, result.case?.answer2].filter(Boolean);
  return sides.find((side) => side.id === winner)?.label || winner;
}

function printSummary(result, files = {}) {
  const latest = result.scores.at(-1);
  const first = result.case.answer1;
  const second = result.case.answer2;
  const score = latest ? `${first.label} ${latest[first.id] ?? '?'} / ${second.label} ${latest[second.id] ?? '?'}` : 'n/a';
  console.log(chalk.green('✓'), `${result.protocol} adversarial review complete`);
  console.log(chalk.gray(`  stop: ${result.stopReason}`));
  console.log(chalk.gray(`  rounds: ${result.rounds.length}`));
  console.log(chalk.gray(`  latest score: ${score}`));
  console.log(chalk.gray(`  jury: ${winnerLabel(result, result.jury.winner)} ${JSON.stringify(result.jury.counts)}`));
  if (files.json) console.log(chalk.gray(`  json: ${files.json}`));
  if (files.md) console.log(chalk.gray(`  markdown: ${files.md}`));
}

function buildMoreLenses(caseBundle, options = {}) {
  const firstLenses = parseList(options.answer1Lenses || options.requesterLenses);
  const secondLenses = parseList(options.answer2Lenses || options.ctoLenses);
  const moreLenses = {};
  if (firstLenses.length) {
    moreLenses.answer1 = firstLenses;
    moreLenses[caseBundle.answer1.id] = firstLenses;
  }
  if (secondLenses.length) {
    moreLenses.answer2 = secondLenses;
    moreLenses[caseBundle.answer2.id] = secondLenses;
  }
  return Object.keys(moreLenses).length ? moreLenses : undefined;
}

function parseJurorsOption(options = {}) {
  const jurorsJson = parseJsonOption(options.jurorsJson, '--jurors-json');
  if (jurorsJson) return jurorsJson;
  return options.jurors ? parseList(options.jurors) : DEFAULT_JURORS;
}

const adversarialCmd = program
  .command('adversarial')
  .alias('adv')
  .description('Run D3-style adversarial reviews over Figma evidence');

adversarialCmd
  .command('review')
  .description('Review selected/business-case slides with configurable SAMRE or MORE two-side debate')
  .option('--protocol <protocol>', 'samre | more', 'samre')
  .option('--page <name>', 'Page name substring. Defaults to current page')
  .option('--frames <list>', 'Comma-separated frame name substrings to review')
  .option('--nodes <ids>', 'Comma-separated node ids to review')
  .option('--limit <n>', 'Maximum frames to review', parseInt, 16)
  .option('--rounds <n>', 'Maximum SAMRE rounds', parseInt, 5)
  .option('--budget <tokens>', 'Approximate token budget for SAMRE transcript', parseInt, 12000)
  .option('--epsilon <n>', 'Score-gap stability threshold for SAMRE stopping', parseFloat, 3)
  .option('--stable-rounds <n>', 'Consecutive stable rounds required for convergence', parseInt, 2)
  .option('--more-k <n>', 'Parallel advocates per side for MORE', parseInt, 3)
  .option('--jurors <list>', 'Comma-separated juror names/lenses. Defaults to role-based panel')
  .option('--jurors-json <json>', 'JSON juror array with id/name/lens fields')
  .option('--criteria <list>', 'Comma-separated review criteria')
  .option('--question <text>', 'Review question')
  .option('--answer1-id <id>', 'First side id. Defaults to requester')
  .option('--answer1-label <text>', 'First side display label. Defaults to Requester')
  .option('--answer1-position <text>', 'First side position statement')
  .option('--answer2-id <id>', 'Second side id. Defaults to cto')
  .option('--answer2-label <text>', 'Second side display label. Defaults to CTO')
  .option('--answer2-position <text>', 'Second side position statement')
  .option('--answer1-lenses <list>', 'Comma-separated MORE advocate lenses for the first side')
  .option('--answer2-lenses <list>', 'Comma-separated MORE advocate lenses for the second side')
  .option('--requester-id <id>', 'Alias for --answer1-id')
  .option('--requester-label <text>', 'Alias for --answer1-label')
  .option('--requester-position <text>', 'Requester position statement')
  .option('--requester-lenses <list>', 'Alias for --answer1-lenses')
  .option('--cto-id <id>', 'Alias for --answer2-id')
  .option('--cto-label <text>', 'Alias for --answer2-label')
  .option('--cto-position <text>', 'CTO position statement')
  .option('--cto-lenses <list>', 'Alias for --answer2-lenses')
  .option('--model-command <command>', 'Command that receives a JSON prompt on stdin and returns JSON')
  .option('--command-timeout <ms>', 'Model command timeout in milliseconds', parseInt, 60000)
  .option('--out <path>', 'Write review JSON. Defaults to /tmp when --json is not used')
  .option('--md <path>', 'Write markdown summary')
  .option('--json', 'Print full JSON to stdout')
  .option('--dry-run', 'Collect evidence and print the case bundle without running agents')
  .option('--no-screenshots', 'Disable default PNG screenshot capture for visual evidence')
  .option('--screenshot-dir <path>', 'Directory for exported screenshots')
  .option('--screenshot-scale <n>', 'Screenshot scale', parseFloat, 0.2)
  .option('--screenshot-max <n>', 'Maximum screenshot dimension in pixels', parseInt, 1200)
  .action(async (options) => {
    try {
      await checkConnection();
      const evidence = parseEvalResult(await fastEval(buildEvidenceEvalCode(options)));
      if (evidence.error) throw new Error(evidence.error);
      saveScreenshots(evidence, options);
      const caseBundle = buildCaseBundle(evidence, options);

      if (options.dryRun) {
        if (options.json) {
          console.log(JSON.stringify({ evidence, case: caseBundle }, null, 2));
        } else {
          console.log(chalk.green('✓'), `Collected ${evidence.selectedFrameCount} frame(s) from ${evidence.page.name}`);
          for (const slide of caseBundle.evidence.slides) {
            const visual = slide.screenshotPath
              ? ` ${slide.screenshotPath}`
              : slide.screenshotError
                ? ` screenshot unavailable: ${slide.screenshotError}`
                : '';
            console.log(chalk.gray(`  - ${slide.name} (${slide.id})${visual}`));
          }
        }
        return;
      }

      const config = loadConfig();
      const command = options.modelCommand
        || config.adversarialReviewCommand
        || config.d3ReviewCommand
        || null;
      if (!command && !options.json) {
        console.log(chalk.yellow('No --model-command/config adversarialReviewCommand set; using deterministic fallback agents.'));
      }

      const result = await runAdversarialReview(caseBundle, {
        protocol: options.protocol,
        command,
        commandTimeout: options.commandTimeout,
        maxRounds: options.rounds,
        budget: options.budget,
        epsilon: options.epsilon,
        stableRounds: options.stableRounds,
        moreK: options.moreK,
        moreLenses: buildMoreLenses(caseBundle, options),
        jurors: parseJurorsOption(options),
      });

      const files = {};
      if (options.out || !options.json) {
        files.json = writeJson(options.out || outputPath(`figma-adversarial-review-${Date.now()}.json`), {
          evidence,
          review: result,
        });
      }
      if (options.md) {
        const mdPath = resolve(options.md);
        ensureDir(dirname(mdPath));
        writeFileSync(mdPath, formatReviewMarkdown(result));
        files.md = mdPath;
      }

      if (options.json) {
        console.log(JSON.stringify({ evidence, review: result }, null, 2));
      } else {
        printSummary(result, files);
      }
    } catch (error) {
      console.error(chalk.red('✗'), error.message);
      process.exit(1);
    }
  });

export {
  buildCaseBundle,
  buildEvidenceEvalCode,
};
