import path from 'node:path';
import http from 'node:http';
import url from 'node:url';
import next from 'next';
import ora from 'ora';
import logSymbols from 'log-symbols';
import chalk from 'chalk';
import packageJson from '../../../package.json';
import { closeOraOnSIGNIT } from './close-ora-on-sigint';

// let processesToKill: ChildProcess[] = [];

// function execAsync(command: string) {
//   const process = shell.exec(command, { async: true });
//   processesToKill.push(process);
//   process.on('close', () => {
//     processesToKill = processesToKill.filter((p) => p !== process);
//   });
// }

let devServer: http.Server | undefined;

const safeAsyncServerListen = (server: http.Server, port: number) => {
  return new Promise<{ portAlreadyInUse: boolean }>((resolve) => {
    server.listen(port, () => {
      resolve({ portAlreadyInUse: false });
    });

    server.on('error', (e: NodeJS.ErrnoException) => {
      if (e.code === 'EADDRINUSE') {
        resolve({ portAlreadyInUse: true });
      }
    });
  });
};

export const startDevServer = async (
  emailsDirRelativePath: string,
  port: number,
) => {
  devServer = http.createServer((req, res) => {
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
      if (nextHandleRequest) {
        void nextHandleRequest(req, res, parsedUrl);
      } else {
        res.writeHead(200);
        res.end();
      }
    } catch (e) {
      console.error('caught error', e);

      res.writeHead(500);
      res.end();
    }
  });

  const { portAlreadyInUse } = await safeAsyncServerListen(devServer, port);

  if (!portAlreadyInUse) {
    // this errors when linting but doesn't on the editor so ignore the warning on this
    /* eslint-disable-next-line @typescript-eslint/no-unsafe-member-access */
    console.log(chalk.greenBright(`    React Email ${packageJson.version}`));
    console.log(`    Running preview at:          http://localhost:${port}\n`);
  } else {
    const nextPortToTry = port + 1;
    console.warn(
      ` ${logSymbols.warning} Port ${port} is already in use, trying ${nextPortToTry}`,
    );
    await startDevServer(emailsDirRelativePath, nextPortToTry);

    return;
  }

  devServer.on('error', (e: NodeJS.ErrnoException) => {
    console.error(
      ` ${logSymbols.error} preview server error: `,
      JSON.stringify(e),
    );
    process.exit(1);
  });

  const spinner = ora({
    text: 'Getting NextJS preview server ready...\n',
    prefixText: ' ',
  }).start();

  closeOraOnSIGNIT(spinner);
  const timeBeforeNextReady = performance.now();

  const isRunningBuilt = __filename.endsWith('cli/index.js');
  const app = next({
    dev: true,
    hostname: 'localhost',
    port,
    customServer: true,
    conf: {
      env: {
        EMAILS_DIR_RELATIVE_PATH: emailsDirRelativePath,
      },
    },
    dir: isRunningBuilt
      ? path.resolve(__dirname, '..')
      : path.resolve(__dirname, '../../..'),
  });

  await app.prepare();

  const nextHandleRequest:
    | ReturnType<typeof app.getRequestHandler>
    | undefined = app.getRequestHandler();

  const secondsToNextReady = (
    (performance.now() - timeBeforeNextReady) /
    1000
  ).toFixed(1);

  spinner.stopAndPersist({
    text: `Ready in ${secondsToNextReady}s\n`,
    symbol: logSymbols.success,
  });
};

export const startProdServer = (_packageManager: string, _port: string) => {
  // execAsync(`${packageManager} run start -- -p ${port}`);
};

export const buildProdServer = (_packageManager: string) => {
  // execAsync(`${packageManager} run build`);
  // if build fails for whatever reason, make sure the shell actually exits
  // process.on('close', (code: number | undefined) => {
  //   shell.exit(code ?? undefined);
  // });
};

// based on https://stackoverflow.com/a/14032965
const exitHandler =
  (
    options?:
      | { shouldKillProcess: false }
      | { shouldKillProcess: true; killWithErrorCode: boolean },
  ) =>
  (_codeOrSignal: number | NodeJS.Signals) => {
    if (typeof devServer !== 'undefined') {
      console.log('\nshutting down dev server');
      devServer.close();
      devServer = undefined;
    }

    if (options?.shouldKillProcess) {
      process.exit(options.killWithErrorCode ? 1 : 0);
    }
  };

// do something when app is closing
process.on('exit', exitHandler());

// catches ctrl+c event
process.on(
  'SIGINT',
  exitHandler({ shouldKillProcess: true, killWithErrorCode: false }),
);

//  catches "kill pid" (for example: nodemon restart)
process.on(
  'SIGUSR1',
  exitHandler({ shouldKillProcess: true, killWithErrorCode: false }),
);
process.on(
  'SIGUSR2',
  exitHandler({ shouldKillProcess: true, killWithErrorCode: false }),
);

// catches uncaught exceptions
process.on(
  'uncaughtException',
  exitHandler({ shouldKillProcess: true, killWithErrorCode: true }),
);