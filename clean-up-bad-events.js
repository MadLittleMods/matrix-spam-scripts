'use strict';

const path = require('path');
const { MatrixClient, LogService, LogLevel } = require('matrix-bot-sdk');
const readline = require('readline');
const LineByLineReader = require('line-by-line');

// Set a log level so high, it doesn't spam us with logs anymore
LogService.setLevel(new LogLevel('SILENT', 10));

const { getStorageDirForRoomId } = require('./lib/get-storage-dir-for-room-id');

let config = {};
try {
  config = require('./config.json');
} catch (err) {
  console.log('No config file detected or some error occured when parsing');
}

const opts = Object.assign(
  {},
  config,
  require('yargs')
    .option('homeserver-url', {
      required: true,
      description: 'Which homeserver to interact with (no trailing slash)',
    })
    .option('room-id', {
      required: true,
      description: 'Which room to remove events from',
    })
    .option('bad-event-ids-file-path', {
      required: true,
      description: 'Path to the bad-event-ids-${dateString}.txt to use',
    })
    .option('concurrency', {
      required: false,
      description: 'Number of redaction requests to have flying around at once',
      default: 1,
    })
    .help('help')
    .alias('help', 'h').argv
);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function processEvents() {
  return new Promise((resolve, reject) => {
    const client = new MatrixClient(opts.homeserverUrl, opts.accessToken);

    const lr = new LineByLineReader(opts.badEventIdsFilePath);
    let lineReaderEnded = false;

    lr.on('error', function (err) {
      console.error(`Error while reading lines from ${opts.badEventIdsFilePath}`, err);
      reject(err);
    });

    let numberOfLines = 0;
    let numberOfLinesCurrentlyBeingProcessed = 0;
    lr.on('line', async function (line) {
      numberOfLines += 1;
      numberOfLinesCurrentlyBeingProcessed += 1;

      const eventId = line;
      const currentLine = numberOfLines;

      if (numberOfLinesCurrentlyBeingProcessed >= opts.concurrency) {
        // pause emitting of lines...
        lr.pause();
      }

      // Retry the redaction until it succeeds. Handles backing off for rate-limits
      let redaction;
      do {
        try {
          redaction = await client.redactEvent(opts.roomId, eventId);
        } catch (err) {
          // Handle rate-limiting
          if (err.body && err.body.errcode === 'M_LIMIT_EXCEEDED') {
            //console.debug(`Rate-Limit: line=${currentLine}, waiting ${err.body.retry_after_ms}`);
            await new Promise((resolve) => {
              setTimeout(resolve, err.body.retry_after_ms);
            });
          } else {
            console.error(`Error while removing bad event ${eventId}`, err);
          }
        }
      } while (!redaction);

      //console.debug('Finished processing line', currentLine);
      rl.write('.');

      // Resume after the async task completes (we just made room for another task)
      numberOfLinesCurrentlyBeingProcessed -= 1;
      lr.resume();

      // We can't resolve directly in the `end` callback because it will fire
      // before we're done asynchronously processing all of the lines here.
      // So we're only done after `end` and we've processed everything.
      if (lineReaderEnded && numberOfLinesCurrentlyBeingProcessed <= 0) {
        resolve(numberOfLines);
      }
    });

    lr.on('end', async function () {
      // All lines are read, file is closed now.
      console.debug('Done reading file (still processing lines asynchronously)');
      lineReaderEnded = true;

      // If we're done reading the file and there are no more lines being
      // processed async, we can be done
      if (numberOfLinesCurrentlyBeingProcessed <= 0) {
        resolve(numberOfLines);
      }
    });
  });
}

async function exec() {
  const numberOfEventsProcessed = await processEvents();
  console.log(`Done processing: ${numberOfEventsProcessed} events`);

  // Write a newline so the next log doesn't appear
  // on the same line as the .....
  rl.write('\n');
  rl.close();
}

exec();
