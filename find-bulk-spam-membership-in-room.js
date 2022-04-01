'use strict';

const path = require('path');
const { MatrixClient, LogService, LogLevel } = require('matrix-bot-sdk');
const readline = require('readline');
const LineByLineReader = require('line-by-line');

const outputFile = require('./lib/output-file');
const { getStorageDirForRoomId } = require('./lib/get-storage-dir-for-room-id');

const KNOWN_GOOD_SERVERS = ['matrix.org', 'gitter.im'];

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
    .option('since', {
      required: true,
      type: 'number',
      description: `Since what date should we look for spam membership (cut down on false-positives)`,
    })
    .option('membership-file-path', {
      required: false,
      description:
        'Path to the membership-${dateString}.ndjson otherwise will fetch membership again',
    })
    .help('help')
    .alias('help', 'h').argv
);

const dateString = Date.now();
const ndjsonMembersFilePath = path.join(
  getStorageDirForRoomId(opts.roomId),
  `members-${dateString}.ndjson`
);

const bulkSpamMxidsFilePath = path.join(
  getStorageDirForRoomId(opts.roomId),
  `bulk-spam-mxids-${dateString}.txt`
);

const bulkSpamServersFilePath = path.join(
  getStorageDirForRoomId(opts.roomId),
  `bulk-spam-servers-${dateString}.txt`
);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function processMembers() {
  return new Promise((resolve, reject) => {
    const bulkSpamMxids = [];
    const bulkSpamServerMap = {};

    const client = new MatrixClient(opts.homeserverUrl, opts.accessToken);

    // Use the file path they passed in or the new one that we just cached at the start of this script
    const filePathToRead = opts.membershipFilePath || ndjsonMembersFilePath;
    const lr = new LineByLineReader(filePathToRead);

    lr.on('error', function (err) {
      console.error(`Error while reading lines from ${filePathToRead}`, err);
      reject(err);
    });

    let numberOfLines = 0;
    lr.on('line', async function (line) {
      numberOfLines += 1;

      const membershipEvent = JSON.parse(line);
      if (membershipEvent.origin_server_ts > opts.since) {
        const mxid = membershipEvent.state_key;
        const [localPart, serverName] = mxid.split(':');

        // ex. `@fhtgxaa0cv`
        if (localPart.length === 11 && !KNOWN_GOOD_SERVERS.includes(serverName)) {
          bulkSpamMxids.push(mxid);
          bulkSpamServerMap[serverName] = true;
        }
      }

      if (numberOfLines % 500 === 0) {
        rl.write('.');
      }
    });

    lr.on('end', async function () {
      // All lines are read, file is closed now.

      try {
        await outputFile(
          bulkSpamServersFilePath,
          Object.keys(bulkSpamServerMap).join('\n') +
            (Object.keys(bulkSpamServerMap).length > 0 ? '\n' : '')
        );
      } catch (err) {
        console.error(`Error persisting bulk spam servers to ${bulkSpamServersFilePath}`, err);
        reject(err);
      }

      try {
        await outputFile(
          bulkSpamMxidsFilePath,
          bulkSpamMxids.join('\n') + (bulkSpamMxids.length > 0 ? '\n' : '')
        );
      } catch (err) {
        console.error(`Error persisting bad spam mxids to ${bulkSpamMxidsFilePath}`, err);
        reject(err);
      }

      resolve({
        numberOfLines,
        bulkSpamMxids,
        bulkSpamServerMap,
      });
    });
  });
}

async function exec() {
  if (!opts.membershipFilePath) {
    console.log('--membership-file-path not provided, fetching membership');
    const client = new MatrixClient(opts.homeserverUrl, opts.accessToken);

    const membershipEvents = await client.getRoomMembers(opts.roomId);

    const ndjsonMembers = membershipEvents
      .map((membershipEvent) => {
        return JSON.stringify(membershipEvent.raw);
      })
      .join('\n');

    await outputFile(ndjsonMembersFilePath, ndjsonMembers);
    console.log(
      `Membership persisted to ${ndjsonMembersFilePath} (${ndjsonMembers.length} events)`
    );
  }

  const { numberOfLines, bulkSpamMxids, bulkSpamServerMap } = await processMembers();
  console.log(`Done processing: ${numberOfLines} membership events`);
  console.log(` - ${bulkSpamMxids.length} bulk spam MXIDs`);
  console.log(` - ${Object.keys(bulkSpamServerMap).length} bulk spam servers`);

  // Write a newline so the next log doesn't appear
  // on the same line as the .....
  rl.write('\n');
  rl.close();
}

exec();
