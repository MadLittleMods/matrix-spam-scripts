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
    .option('concurrency', {
      required: true,
      description: 'Number of files to read at once',
      default: 1,
    })
    .help('help')
    .alias('help', 'h').argv
);

const dateString = Date.now();
const badServersFilePath = path.join(
  getStorageDirForRoomId(opts.roomId),
  `bad-servers-${dateString}.txt`
);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const badServerMap = {};
async function processFile(filePath) {
  return new Promise((resolve, reject) => {
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

      const badUserMxid = line;
      const [localPart, serverName] = badUserMxid.split(':');
      badServerMap[serverName] = true;

      //lr.resume();
    });

    lr.on('end', async function () {
      // All lines are read, file is closed now.
      rl.write(`.`);

      resolve();
    });
  });
}

async function exec() {
  const fileNamesInDir = await fs.readdir(getStorageDirForRoomId(opts.roomId));
  console.log('fileNamesInDir', fileNamesInDir);
  const fileNames = fileNamesInDir.filter((fileName) => {
    return fileName.match(/bad-senders-.*\.txt/);
  });
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

        const filePath = path.join(getStorageDirForRoomId(opts.roomId), fileName);
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

  try {
    await fs.appendFile(
      badServersFilePath,
      Object.keys(badServerMap).join('\n') + (Object.keys(badServerMap).length > 0 ? '\n' : '')
    );
  } catch (err) {
    console.error(`Error persisting bad servers to ${badServersFilePath}`, err);
    reject(err);
  }

  console.log(`Done processing files:\n  - ${badServersFilePath}`);
}

exec();
