'use strict';

const assert = require('assert');
const path = require('path').posix;
const readline = require('readline');

const outputFile = require('./lib/output-file');
const { getMessageStorageDirForRoomId } = require('./lib/get-storage-dir-for-room-id');
const { fetchEndpointAsJson } = require('./lib/fetch-endpoint');

// How many messages we request at a time
const MESSAGE_FETCH_LIMIT = 100;
// How many times we will retry fetching messages at a given point in time before giving up
// This is high because we want to set and forget this script and come back to a full list of messages.
// If something has failed more than 100 times, something bigger is probably going wrong.
const REQUEST_RETRY_LIMIT = 100;
// How many message requests we receive before persisting those results to disk (avoid thrashing the disk)
const NUM_REQUESTS_PER_PERSIST_INTERVAL = 10;

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
      description: 'Which homeserver to interact with (no trailing slash)',
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
  rl.write('^');

  // Just keep re-trying on failures (we retry up to REQUEST_RETRY_LIMIT times)
  let requestSuccess = false;
  let requestCount = 0;
  do {
    try {
      const responseData = await fetchMessages(roomId, from, MESSAGE_FETCH_LIMIT);
      requestSuccess = true;
    } catch (err) {
      console.error(`Error while requesting messages for ${roomId} with from=${from}`);
    }

    // Increment this here in case of any failures
    requestCount += 1;
  } while (!requestSuccess && requestCount < REQUEST_RETRY_LIMIT);

  rl.write('v');

  meta.requestCount += 1;
  meta.eventsToPersist.push(...responseData.chunk);

  // Some data to keep track of while recursively calling
  if (!meta.start) {
    meta.start = responseData.start;
  }
  meta.end = responseData.end;

  const lastEventInChunk = responseData.chunk[responseData.chunk.length - 1];
  const shouldContinue =
    // If there are messages in the chunk, then there are probably more messages to paginate (continue)
    responseData.chunk.length !== 0 &&
    // Continue if no stopDate or the last event is still more recent than the stopDate (continue)
    (!stopDate || (lastEventInChunk && lastEventInChunk.origin_server_ts > stopDate));

  // Only persist to disk every NUM_REQUESTS_PER_PERSIST_INTERVAL requests
  // or flush when we will no longer continue paginating
  if (meta.requestCount % NUM_REQUESTS_PER_PERSIST_INTERVAL === 0 || !shouldContinue) {
    const ndjsonEventsFilePath = path.join(
      getMessageStorageDirForRoomId(roomId),
      `start_${meta.start}__end_${meta.end}.ndjson`
    );

    const ndjsonEvents = meta.eventsToPersist
      .map((event) => {
        return JSON.stringify(event);
      })
      .join('\n');

    await outputFile(ndjsonEventsFilePath, ndjsonEvents);

    // Output a file we can read later to resume our position.
    await outputFile(
      path.join(getMessageStorageDirForRoomId(roomId), `/resume.json`),
      JSON.stringify({
        from: meta.end,
      })
    );

    rl.write('|');

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
    const resumeDate = require(`./${getMessageStorageDirForRoomId(opts.roomId)}/resume.json`);
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
