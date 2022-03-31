'use strict';

const path = require('path').posix;
const fs = require('fs').promises;
const readline = require('readline');
const LineByLineReader = require('line-by-line');

const {
  getStorageDirForRoomId,
  getMessageStorageDirForRoomId,
} = require('./lib/get-storage-dir-for-room-id');

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
    .option('room-id', {
      required: true,
      description: 'Which room to process messages from',
    })
    .option('grep', {
      required: true,
      description: 'The regex filter to match against the event text',
    })
    .option('concurrency', {
      required: true,
      description: 'Number of files to read at once',
      default: 1,
    })
    .help('help')
    .alias('help', 'h').argv
);

const dateString = Date.now();
const badSendersFilePath = path.join(
  getStorageDirForRoomId(opts.roomId),
  `bad-senders-${dateString}.txt`
);
const badEventIdsFilePath = path.join(
  getStorageDirForRoomId(opts.roomId),
  `bad-event-ids-${dateString}.txt`
);

const messageTextFilterRegex = new RegExp(opts.grep, 'i');
console.log('messageTextFilterRegex', messageTextFilterRegex);
function detectBadEvent(event) {
  if (event.type === 'm.room.message') {
    const isBadText = event.content.body && event.content.body.match(messageTextFilterRegex);
    return !!isBadText;
  }

  return false;
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function processFile(filePath) {
  return new Promise((resolve, reject) => {
    let badEventIds = [];
    let badSenderMap = {};
    let numberOfLines = 0;

    const lr = new LineByLineReader(filePath);

    lr.on('error', function (err) {
      console.error(`Error while reading lines from ${filePath}`, err);
      reject(err);
    });

    lr.on('line', function (line) {
      // pause emitting of lines...
      //lr.pause();
      numberOfLines += 1;

      const event = JSON.parse(line);
      const isBadEvent = detectBadEvent(event);
      if (isBadEvent) {
        badEventIds.push(event.event_id);
        badSenderMap[event.sender] = true;
      }

      //lr.resume();
    });

    lr.on('end', async function () {
      // All lines are read, file is closed now.
      rl.write(`${Object.keys(badSenderMap).length}-${badEventIds.length}.`);

      try {
        await fs.appendFile(
          badSendersFilePath,
          Object.keys(badSenderMap).join('\n') + (Object.keys(badSenderMap).length > 0 ? '\n' : '')
        );
      } catch (err) {
        console.error(`Error persisting bad senders to ${badSendersFilePath}`, err);
        reject(err);
      }

      try {
        await fs.appendFile(
          badEventIdsFilePath,
          badEventIds.join('\n') + (badEventIds.length > 0 ? '\n' : '')
        );
      } catch (err) {
        console.error(`Error persisting bad event IDs to ${badEventIdsFilePath}`, err);
        reject(err);
      }

      resolve();
    });
  });
}

async function exec() {
  const fileNames = await fs.readdir(getMessageStorageDirForRoomId(opts.roomId));
  console.log(`${fileNames.length} files to process for ${opts.roomId}:`);

  try {
    // Process N number of files at once (defined by concurrency)
    for (let fileIndex = 0; fileIndex < fileNames.length; fileIndex += opts.concurrency) {
      let asyncTasks = [];
      // FIXME: This concurrency is not correct. It should be like a queue, not fire at once and wait for all to finish
      for (let i = 0; i < opts.concurrency; i++) {
        // Dirty check because the weird concurrency here pushes the index above the length of the list
        if (fileIndex + i >= fileNames.length) {
          continue;
        }

        const fileName = fileNames[fileIndex + i];

        // Skip the resume data
        if (path.basename(fileName) === 'resume.json') {
          continue;
        }

        const filePath = path.join(getMessageStorageDirForRoomId(opts.roomId), fileName);
        asyncTasks.push(processFile(filePath));
      }

      await Promise.all(asyncTasks);
    }
  } catch (err) {
    console.error('Error processing files', err);
  }

  // If we're done paginating, write a newline so the next log doesn't appear
  // on the same line as the .....
  rl.write('\n');
  rl.close();

  console.log(`Done processing files:\n  - ${badSendersFilePath}\n  - ${badEventIdsFilePath}`);
}

exec();
