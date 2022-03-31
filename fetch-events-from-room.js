'use strict';

const assert = require('assert');
const readline = require('readline');

const outputFile = require('./lib/output-file');
const { fetchEndpointAsJson } = require('./lib/fetch-endpoint');

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
    .option('access-token', {
      required: false,
      description:
        'Access token used to hit the Matrix API (can also be provided in config.json under the `accessToken` key)',
    })
    .option('homeserver-url', {
      required: true,
      description: 'Which room to fetch messages from',
    })
    .option('room-id', {
      required: true,
      description: 'Which room to fetch messages from',
    })
    .option('stop-date', {
      required: false,
      type: 'number',
      description: `Where to stop paginating (unix timestamp) -> new Date('2022-01-01').getTime()`,
    })
    .option('resume', {
      required: false,
      type: 'boolean',
      description: `Whether to resume where we last left off paginating in the room`,
      default: false,
    })
    .help('help')
    .alias('help', 'h').argv
);

function getStorageDirForRoom(roomId) {
  const storageDir = `./messages/${roomId.replace(':', '_')}`;
  return storageDir;
}

async function fetchMessages(roomId, from, limit = 100) {
  let url = `${opts.homeserverUrl}/_matrix/client/r0/rooms/${encodeURIComponent(
    roomId
  )}/messages?dir=b&limit=${limit}`;
  if (from) {
    url += `&from=${from}`;
  }

  return fetchEndpointAsJson(url, {
    accessToken: opts.accessToken,
  });
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function paginateUntilDate({
  roomId,
  // This is used to resume
  from,
  stopDate,
  meta = {
    start: null,
    end: null,
    requestCount: 0,
    eventsToPersist: [],
  },
}) {
  const fetchLimit = 100;
  const responseData = await fetchMessages(roomId, from, fetchLimit);

  meta.requestCount += 1;
  meta.eventsToPersist.push(...responseData.chunk);

  // Some data to keep track of while recursively calling
  if (!meta.start) {
    meta.start = responseData.start;
  }
  meta.end = responseData.end;

  const lastEventInChunk = responseData.chunk[responseData.chunk.length - 1];
  const shouldContinue =
    // If the chunk is filled to the limit, then there are more messages to paginate (continue)
    responseData.chunk.length >= fetchLimit &&
    // Continue if no stopDate or the last event is still more recent than the stopDate (continue)
    (!stopDate || (lastEventInChunk && lastEventInChunk.origin_server_ts > stopDate));

  // Only persist to disk every 10 requests
  // or flush when we will no longer continue paginating
  if (meta.requestCount % 10 === 0 || !shouldContinue) {
    const path = `${getStorageDirForRoom(roomId)}/start_${meta.start}__end_${meta.end}.ndjson`;

    const ndjsonEvents = meta.eventsToPersist
      .map((event) => {
        return JSON.stringify(event);
      })
      .join('\n');

    await outputFile(path, ndjsonEvents);

    // Output a file we can read later to resume our position.
    await outputFile(
      `${getStorageDirForRoom(roomId)}/resume.json`,
      JSON.stringify({
        from: meta.end,
      })
    );

    // Reset the meta
    meta.start = null;
    meta.end = null;
    meta.eventsToPersist = [];
  }

  rl.write('.');

  if (shouldContinue) {
    await paginateUntilDate({
      roomId,
      from: responseData.end,
      stopDate,
      meta,
    });
  } else {
    // If we're done paginating, write a newline so the next log doesn't appear
    // on the same line as the .....
    rl.write('\n');
    rl.close();
  }

  return meta;
}

async function exec() {
  let from;
  if (opts.resume) {
    const resumeDate = require(`./${getStorageDirForRoom(opts.roomId)}/resume.json`);
    from = resumeDate.from;
  }

  console.log(`Fetching events for ${opts.roomId} ${from ? `(resuming from ${from})` : ''}`);

  const { requestCount } = await paginateUntilDate({
    roomId: opts.roomId,
    from,
    stopDate: opts.stopDate,
  });
  console.log(`Done fetching events after ${requestCount} requests!`);
}

exec();
