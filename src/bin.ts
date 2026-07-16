#!/usr/bin/env node

const args = process.argv.slice(2);

// Fast path: bare invocation directly starts the MCP server
if (args.length === 0 || args[0] === '--agent') {
  console.error('[passtorch] Starting MCP Server (Stub)');
  process.exit(0);
}

// Subcommands path: lazy load commander
import('commander').then(({ program }) => {
  program
    .name('passtorch')
    .description('Local-first cross-agent memory daemon and MCP server')
    .version('0.1.0');

  program
    .command('status')
    .description('Print daemon status, port, data directory, and log path')
    .action(() => {
      console.log('Status: Offline (Stub)');
    });

  program.parse();
});
