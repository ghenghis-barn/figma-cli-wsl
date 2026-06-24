// Commands: comments + webhooks (Figma REST / cloud-backed surfaces)
import chalk from 'chalk';
import { fork } from 'child_process';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  createWebhook,
  deleteComment,
  deleteWebhook,
  generatePasscode,
  getWebhook,
  listComments,
  listWebhookRequests,
  listWebhooks,
  postComment,
  resolveFileKey,
} from '../figma-rest.js';
import { loadConfig, program } from '../lib/cli-core.js';
import {
  appendTunnelPath,
  startPublicTunnel,
  waitForTunnelHealth,
} from '../tunnels.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const listenerPath = join(__dirname, '..', 'webhook-listener.js');

function configuredWebhookPasscode() {
  const config = loadConfig();
  return process.env.FIGMA_WEBHOOK_PASSCODE || config.figmaWebhookPasscode || config.webhookPasscode || null;
}

function printComment(comment, index) {
  const author = comment.user?.handle || comment.user?.name || comment.user?.id || 'unknown';
  const created = comment.created_at || 'unknown time';
  const resolved = comment.resolved_at ? ` ${chalk.gray('(resolved)')}` : '';
  console.log(`${chalk.cyan(`${index + 1}.`)} ${chalk.bold(comment.message || '(empty comment)')}${resolved}`);
  console.log(chalk.gray(`   id: ${comment.id || '(unknown)'}  author: ${author}  created: ${created}`));
  if (comment.client_meta) {
    const meta = comment.client_meta;
    const parts = [];
    if (meta.node_id) parts.push(`node ${meta.node_id}`);
    if (meta.page_id) parts.push(`page ${meta.page_id}`);
    if (typeof meta.x === 'number' && typeof meta.y === 'number') parts.push(`x:${meta.x} y:${meta.y}`);
    if (parts.length) console.log(chalk.gray(`   location: ${parts.join(' · ')}`));
  }
}

function printWebhook(webhook) {
  const id = webhook.id || webhook.webhook_id || '(unknown)';
  console.log(`${chalk.cyan(id)} ${chalk.bold(webhook.event_type || '(event?)')} ${chalk.gray(webhook.status || '')}`);
  console.log(chalk.gray(`   context: ${webhook.context || '?'}:${webhook.context_id || '?'}`));
  console.log(chalk.gray(`   endpoint: ${webhook.endpoint || '?'}`));
  if (webhook.description) console.log(chalk.gray(`   description: ${webhook.description}`));
}

function webhookId(webhook) {
  return webhook?.id || webhook?.webhook_id || null;
}

async function resolveWebhookContext(options) {
  const context = options.context || 'file';
  let contextId = options.contextId;
  if (context === 'file' && !contextId) {
    contextId = await resolveFileKey(options.file, {
      title: options.title,
      current: !options.noCurrent,
    });
  }
  if (!contextId && !options.planApiId) {
    throw new Error('Missing context id. Pass --context-id, --file, --title, or --plan-api-id.');
  }
  return { context, contextId };
}

function buildClientMeta(options) {
  const hasX = options.x !== undefined;
  const hasY = options.y !== undefined;
  if (!hasX && !hasY && !options.node) return undefined;
  if (options.node) {
    return {
      node_id: options.node,
      node_offset: {
        x: hasX ? Number(options.x) : 0,
        y: hasY ? Number(options.y) : 0,
      },
    };
  }
  const meta = {};
  if (hasX || hasY) {
    return {
      x: hasX ? Number(options.x) : 0,
      y: hasY ? Number(options.y) : 0,
    };
  }
  return meta;
}

function buildListenerArgs(options, passcode) {
  const args = [
    '--host', options.host,
    '--port', String(options.port),
    '--path', options.path,
  ];
  if (passcode) args.push('--passcode', passcode);
  if (options.verify === false) args.push('--no-verify');
  if (options.eventsFile) args.push('--events-file', resolve(options.eventsFile));
  if (options.json) args.push('--json');
  return args;
}

// ============ COMMENTS ============

const commentsCmd = program
  .command('comments')
  .alias('comment')
  .description('Read Figma file comments via REST or the authenticated desktop session');

commentsCmd
  .command('list [file]')
  .description('List comments for a Figma file key/URL, or an open file selected with --title')
  .option('--title <title>', 'Resolve file key from an open Figma tab title')
  .option('--source <source>', 'auto | rest | desktop', 'auto')
  .option('--as-md', 'Ask official REST API for markdown comment output where supported')
  .option('--json', 'Print normalized JSON')
  .action(async (file, options) => {
    try {
      const fileKey = await resolveFileKey(file, { title: options.title });
      const result = await listComments(fileKey, {
        source: options.source,
        title: options.title,
        asMd: !!options.asMd,
      });
      if (options.json) {
        console.log(JSON.stringify({ fileKey, ...result }, null, 2));
        return;
      }

      console.log(chalk.bold(`Comments for ${fileKey}`) + chalk.gray(` (${result.source})`));
      if (!result.comments.length) {
        console.log(chalk.gray('  (no comments)'));
        return;
      }
      result.comments.forEach(printComment);
    } catch (error) {
      console.error(chalk.red('✗'), error.message);
      process.exit(1);
    }
  });

commentsCmd
  .command('create <message> [file]')
  .description('Create a Figma file comment via the official REST API')
  .option('--title <title>', 'Resolve file key from an open Figma tab title')
  .option('--reply-to <commentId>', 'Reply to a root comment')
  .option('--x <n>', 'Comment x position', parseFloat)
  .option('--y <n>', 'Comment y position', parseFloat)
  .option('--node <nodeId>', 'Attach location to a node id')
  .option('--page <pageId>', 'Attach location to a page id')
  .option('--json', 'Print normalized JSON')
  .action(async (message, file, options) => {
    try {
      const fileKey = await resolveFileKey(file, { title: options.title });
      const comment = await postComment(fileKey, {
        message,
        commentId: options.replyTo,
        clientMeta: buildClientMeta(options),
      });
      if (options.json) {
        console.log(JSON.stringify({ fileKey, comment }, null, 2));
        return;
      }
      console.log(chalk.green('✓'), 'Created Figma comment');
      printComment(comment, 0);
    } catch (error) {
      console.error(chalk.red('✗'), error.message);
      process.exit(1);
    }
  });

commentsCmd
  .command('delete <commentId> [file]')
  .description('Delete a Figma file comment via the official REST API')
  .option('--title <title>', 'Resolve file key from an open Figma tab title')
  .option('--json', 'Print JSON')
  .action(async (commentId, file, options) => {
    try {
      const fileKey = await resolveFileKey(file, { title: options.title });
      const result = await deleteComment(fileKey, commentId);
      if (options.json) {
        console.log(JSON.stringify({ fileKey, ...result }, null, 2));
        return;
      }
      console.log(chalk.green('✓'), `Deleted Figma comment ${commentId}`);
    } catch (error) {
      console.error(chalk.red('✗'), error.message);
      process.exit(1);
    }
  });

// ============ WEBHOOKS ============

const webhooksCmd = program
  .command('webhooks')
  .alias('webhook')
  .description('Manage Figma REST webhooks and run a local event listener');

webhooksCmd
  .command('list')
  .description('List webhooks for a file/project/team context or plan API id')
  .option('--context <context>', 'file | project | team', 'file')
  .option('--context-id <id>', 'Context id')
  .option('--file <keyOrUrl>', 'File key or URL when context=file')
  .option('--title <title>', 'Resolve file context from an open Figma tab title')
  .option('--plan-api-id <id>', 'Plan API id, e.g. team-123 or organization-123')
  .option('--cursor <cursor>', 'Pagination cursor for plan listing')
  .option('--json', 'Print raw JSON')
  .action(async (options) => {
    try {
      const contextInfo = options.planApiId ? {} : await resolveWebhookContext(options);
      const result = await listWebhooks({
        context: contextInfo.context,
        contextId: contextInfo.contextId,
        planApiId: options.planApiId,
        cursor: options.cursor,
      });
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      const webhooks = result.webhooks || [];
      if (!webhooks.length) {
        console.log(chalk.gray('(no webhooks)'));
        return;
      }
      webhooks.forEach(printWebhook);
      if (result.pagination?.next_page) {
        console.log(chalk.gray(`next cursor: ${result.pagination.next_page}`));
      }
    } catch (error) {
      console.error(chalk.red('✗'), error.message);
      process.exit(1);
    }
  });

webhooksCmd
  .command('get <webhookId>')
  .description('Get a webhook by id')
  .option('--json', 'Print raw JSON')
  .action(async (webhookId, options) => {
    try {
      const webhook = await getWebhook(webhookId);
      if (options.json) console.log(JSON.stringify(webhook, null, 2));
      else printWebhook(webhook);
    } catch (error) {
      console.error(chalk.red('✗'), error.message);
      process.exit(1);
    }
  });

webhooksCmd
  .command('create')
  .description('Create a Figma webhook for a file/project/team context')
  .requiredOption('--endpoint <url>', 'Public HTTPS endpoint Figma should POST to')
  .option('--event <event>', 'Webhook event type', 'FILE_COMMENT')
  .option('--context <context>', 'file | project | team', 'file')
  .option('--context-id <id>', 'Context id')
  .option('--file <keyOrUrl>', 'File key or URL when context=file')
  .option('--title <title>', 'Resolve file context from an open Figma tab title')
  .option('--passcode <passcode>', 'Webhook passcode. Defaults to FIGMA_WEBHOOK_PASSCODE or generated value')
  .option('--status <status>', 'ACTIVE or PAUSED')
  .option('--description <description>', 'Webhook description')
  .option('--json', 'Print raw JSON')
  .action(async (options) => {
    try {
      const { context, contextId } = await resolveWebhookContext(options);
      const configuredPasscode = configuredWebhookPasscode();
      const passcode = options.passcode || configuredPasscode || generatePasscode();
      const webhook = await createWebhook({
        eventType: options.event,
        context,
        contextId,
        endpoint: options.endpoint,
        passcode,
        status: options.status,
        description: options.description,
      });
      if (options.json) {
        console.log(JSON.stringify({ webhook, generatedPasscode: options.passcode || configuredPasscode ? undefined : passcode }, null, 2));
        return;
      }
      console.log(chalk.green('✓'), 'Created Figma webhook');
      printWebhook(webhook);
      if (!options.passcode && !configuredPasscode) {
        console.log(chalk.yellow('Generated passcode, store it for the listener:'));
        console.log(passcode);
      }
    } catch (error) {
      console.error(chalk.red('✗'), error.message);
      process.exit(1);
    }
  });

webhooksCmd
  .command('delete <webhookId>')
  .description('Delete a Figma webhook by id')
  .option('--json', 'Print raw JSON')
  .action(async (webhookId, options) => {
    try {
      const result = await deleteWebhook(webhookId);
      if (options.json) console.log(JSON.stringify(result, null, 2));
      else {
        console.log(chalk.green('✓'), `Deleted webhook ${webhookId}`);
        if (result && typeof result === 'object') printWebhook(result);
      }
    } catch (error) {
      console.error(chalk.red('✗'), error.message);
      process.exit(1);
    }
  });

webhooksCmd
  .command('requests <webhookId>')
  .description('List recent delivery attempts for a webhook')
  .option('--json', 'Print raw JSON')
  .action(async (webhookId, options) => {
    try {
      const result = await listWebhookRequests(webhookId);
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      const requests = result.requests || [];
      if (!requests.length) {
        console.log(chalk.gray('(no recent requests)'));
        return;
      }
      requests.forEach((request, index) => {
        const payload = request.request_info?.payload || {};
        const status = request.response_info?.status || request.error_msg || 'no response';
        console.log(`${chalk.cyan(`${index + 1}.`)} ${payload.event_type || '(unknown event)'} ${chalk.gray(status)}`);
        if (request.request_info?.sent_at) console.log(chalk.gray(`   sent: ${request.request_info.sent_at}`));
        if (request.error_msg) console.log(chalk.gray(`   error: ${request.error_msg}`));
      });
    } catch (error) {
      console.error(chalk.red('✗'), error.message);
      process.exit(1);
    }
  });

webhooksCmd
  .command('watch')
  .description('Run a local webhook receiver subprocess and print events as they arrive')
  .option('--host <host>', 'Local host to bind', '127.0.0.1')
  .option('--port <port>', 'Local port to bind', '8787')
  .option('--path <path>', 'HTTP path for webhook POSTs', '/figma-webhook')
  .option('--passcode <passcode>', 'Webhook passcode. Defaults to FIGMA_WEBHOOK_PASSCODE/config')
  .option('--no-verify', 'Do not verify the webhook passcode')
  .option('--events-file <path>', 'Append received events as JSONL')
  .option('--json', 'Print received event JSON instead of summaries')
  .option('--tunnel', 'Open a public HTTPS tunnel for this listener')
  .option('--tunnel-provider <provider>', 'Tunnel provider: localtunnel | ngrok')
  .option('--tunnel-timeout <ms>', 'Milliseconds to wait for tunnel readiness', parseInt, 15000)
  .option('--no-tunnel-healthcheck', 'Skip public /health verification before registration')
  .option('--subdomain <name>', 'Requested localtunnel subdomain')
  .option('--tunnel-host <url>', 'localtunnel server URL')
  .option('--ngrok-bin <path>', 'ngrok executable path when it is not on PATH or config ngrokBin')
  .option('--ngrok-url <url>', 'Reserved ngrok endpoint URL/domain to request')
  .option('--ngrok-api-port <port>', 'Local ngrok Agent API port', parseInt)
  .option('--ngrok-api-url <url>', 'Local ngrok Agent API base URL')
  .option('--ngrok-config <path>', 'ngrok config path to merge with figma-cli runtime config')
  .option('--register', 'Create the Figma webhook after the local listener starts')
  .option('--endpoint <url>', 'Public HTTPS endpoint to register when using --register')
  .option('--event <event>', 'Webhook event type for --register', 'FILE_COMMENT')
  .option('--context <context>', 'file | project | team for --register', 'file')
  .option('--context-id <id>', 'Context id for --register')
  .option('--file <keyOrUrl>', 'File key or URL for --register context=file')
  .option('--title <title>', 'Resolve file context from an open Figma tab title')
  .option('--description <description>', 'Webhook description for --register')
  .option('--once', 'Exit after the first accepted event')
  .option('--delete-on-stop', 'Delete a webhook registered by this process when it stops')
  .action(async (options) => {
    const verify = options.verify !== false;
    const passcode = options.passcode || configuredWebhookPasscode() || (verify ? generatePasscode() : null);
    const child = fork(listenerPath, buildListenerArgs(options, passcode), {
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });

    let webhookRegistered = false;
    let registeredWebhookId = null;
    let tunnel = null;
    let stopping = false;

    async function cleanupAndStop(exitCode = 0) {
      if (stopping) return;
      stopping = true;
      if (options.deleteOnStop && registeredWebhookId) {
        try {
          await deleteWebhook(registeredWebhookId);
          console.log(chalk.gray(`Deleted registered webhook ${registeredWebhookId}`));
        } catch (error) {
          console.error(chalk.yellow('Could not delete registered webhook:'), error.message);
          if (!process.exitCode) process.exitCode = 1;
        }
      }
      if (tunnel) {
        try { tunnel.close(); } catch {}
      }
      child.kill('SIGTERM');
      process.exitCode = process.exitCode || exitCode;
    }

    child.on('message', async (message) => {
      if (message.type === 'ready') {
        console.log(chalk.green('✓'), `Local listener: ${message.url}`);
        if (verify && !options.passcode && !configuredWebhookPasscode()) {
          console.log(chalk.yellow('Generated passcode for this listener:'));
          console.log(passcode);
        }
        let endpoint = options.endpoint;
        const shouldOpenTunnel = options.tunnel || options.tunnelProvider;
        if (shouldOpenTunnel) {
          try {
            tunnel = await startPublicTunnel(options, loadConfig());
            endpoint = appendTunnelPath(tunnel.url, options.path);
            console.log(chalk.green('✓'), `${tunnel.provider} tunnel: ${endpoint}`);
            if (options.tunnelHealthcheck !== false) {
              await waitForTunnelHealth(tunnel.url, options.tunnelTimeout);
              console.log(chalk.green('✓'), 'Tunnel health check passed');
            }
            tunnel.on('request', (info) => {
              if (!options.json) console.log(chalk.gray(`[tunnel] ${info.method} ${info.path}`));
            });
            tunnel.on('error', async (error) => {
              if (stopping) return;
              console.error(chalk.red('✗'), `Tunnel error: ${error.message}`);
              await cleanupAndStop(1);
            });
            tunnel.on('close', async () => {
              if (stopping) return;
              console.log(chalk.yellow('Tunnel closed'));
              await cleanupAndStop(1);
            });
          } catch (error) {
            console.error(chalk.red('✗'), `Could not open public tunnel: ${error.message}`);
            await cleanupAndStop(1);
            return;
          }
        }
        if (!options.register) {
          console.log(chalk.gray(endpoint
            ? `Run \`figma-cli webhooks create --endpoint ${endpoint} ...\` to register this listener.`
            : 'Expose this URL with --tunnel/ngrok/cloudflared, then run `figma-cli webhooks create --endpoint <public-url> ...`.'));
          return;
        }

        if (!endpoint) {
          console.error(chalk.red('✗'), '--register requires --endpoint <public https URL>, --tunnel, or --tunnel-provider');
          await cleanupAndStop(1);
          process.exitCode = 1;
          return;
        }

        try {
          const { context, contextId } = await resolveWebhookContext(options);
          const webhook = await createWebhook({
            eventType: options.event,
            context,
            contextId,
            endpoint,
            passcode,
            description: options.description || `figma-cli ${options.event} watcher`,
          });
          webhookRegistered = true;
          registeredWebhookId = webhookId(webhook);
          console.log(chalk.green('✓'), 'Registered Figma webhook');
          printWebhook(webhook);
        } catch (error) {
          console.error(chalk.red('✗'), error.message);
          await cleanupAndStop(1);
          process.exitCode = 1;
        }
        return;
      }

      if (message.type === 'event') {
        if (options.json) console.log(JSON.stringify(message, null, 2));
        else console.log(chalk.cyan('[figma webhook]'), message.summary);
        if (options.once && message.payload?.event_type !== 'PING') {
          await cleanupAndStop(0);
        }
        return;
      }

      if (message.type === 'rejected') {
        console.log(chalk.yellow('[figma webhook rejected]'), message.reason);
        return;
      }

      if (message.type === 'error') {
        console.error(chalk.red('✗'), message.error);
      }
    });

    child.on('exit', (code, signal) => {
      if (tunnel && !stopping) {
        try { tunnel.close(); } catch {}
      }
      if (code === 0 || signal === 'SIGTERM') return;
      console.error(chalk.red('✗'), `Webhook listener exited (${signal || code})`);
      process.exitCode = code || 1;
    });

    process.on('SIGINT', async () => {
      const stopMessage = webhookRegistered && options.deleteOnStop
        ? '\nStopping listener and deleting registered webhook.'
        : webhookRegistered
          ? '\nStopping listener; webhook remains registered.'
          : '\nStopping listener.';
      console.log(chalk.gray(stopMessage));
      await cleanupAndStop(0);
    });
    process.on('SIGTERM', async () => {
      await cleanupAndStop(0);
    });
  });
