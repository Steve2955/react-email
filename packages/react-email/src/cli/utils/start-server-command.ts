import type { ChildProcess } from 'node:child_process';
import path from 'node:path';
import http from 'node:http';
import url from 'node:url';
import shell from 'shelljs';
import next from 'next';

let processesToKill: ChildProcess[] = [];

function execAsync(command: string) {
  const process = shell.exec(command, { async: true });
  processesToKill.push(process);
  process.on('close', () => {
    processesToKill = processesToKill.filter((p) => p !== process);
  });
}

export const startDevServer = async (_packageManager: string, port: string) => {
  const isRunningBuilt = __filename.endsWith('index.js');
  const app = next({
    dev: true,
    hostname: 'localhost',
    port: parseInt(port),
    customServer: true,
    dir: isRunningBuilt ? path.resolve(__dirname, '..') : path.resolve(__dirname, '../../..'),
  });

  await app.prepare();

  const nextHandleRequest = app.getRequestHandler();

  http
    .createServer((req, res) => {
      if (!req.url) {
        res.end(404);
        return;
      }

      const parsedUrl = url.parse(req.url, true);

      // Never cache anything to avoid
      res.setHeader(
        'Cache-Control',
        'no-cache, max-age=0, must-revalidate, no-store',
      );
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '-1');

      try {
        void nextHandleRequest(req, res, parsedUrl);
      } catch (e) {
        console.error('caught error', e);

        res.writeHead(500);
        res.end();
      }
    })
    .listen(port, () => {
      console.log(`running preview at localhost:${port}`);
    })
    .on('error', (e: NodeJS.ErrnoException) => {
      if (e.code === 'EADDRINUSE') {
        console.error(`port ${port} is already in use`);
      } else {
        console.error('preview server error: ', JSON.stringify(e));
      }
      process.exit(1);
    });
};

export const startProdServer = (packageManager: string, port: string) => {
  execAsync(`${packageManager} run start -- -p ${port}`);
};

export const buildProdServer = (packageManager: string) => {
  execAsync(`${packageManager} run build`);

  // if build fails for whatever reason, make sure the shell actually exits
  process.on('close', (code: number | undefined) => {
    shell.exit(code ?? undefined);
  });
};

// based on https://stackoverflow.com/a/14032965
const exitHandler: (options?: { exit?: boolean }) => NodeJS.ExitListener =
  (options) => (code) => {
    if (processesToKill.length > 0) {
      console.log('shutting down %d subprocesses', processesToKill.length);
    }
    processesToKill.forEach((p) => {
      if (p.connected) {
        p.kill();
      }
    });
    if (options?.exit) {
      shell.exit(code);
    }
  };

// do something when app is closing
process.on('exit', exitHandler());

// catches ctrl+c event
process.on('SIGINT', exitHandler({ exit: true }));

//  catches "kill pid" (for example: nodemon restart)
process.on('SIGUSR1', exitHandler({ exit: true }));
process.on('SIGUSR2', exitHandler({ exit: true }));

// catches uncaught exceptions
process.on('uncaughtException', exitHandler({ exit: true }));
