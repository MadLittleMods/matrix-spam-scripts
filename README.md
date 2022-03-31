## Setup

`config.json`

```json
{
  "accessToken": "xxx"
}
```

## Scripts

## `fetch-events-from-room.js`

Paginate from the beginning of the room to the specified `--stop-date` if provided and save all events to `./data/{roomId}/messages` in `ndjson`(new-line delimited JSON) format to be processed by the other scripts.

You can also resume progress if the program errors or stops by passing the `--resume` flag.

```
node fetch-events-from-room.js --homeserver-url http://localhost:18008 --room-id !SdfEMelMdOPSHyPEBb:my.matrix.host

node fetch-events-from-room.js --homeserver-url http://localhost:18008 --room-id !SdfEMelMdOPSHyPEBb:my.matrix.host --stop-date 1618468687519

node fetch-events-from-room.js --homeserver-url http://localhost:18008 --room-id !SdfEMelMdOPSHyPEBb:my.matrix.host --resume
```

## `find-bad-events.js`

Looks through the locally persisted events from `fetch-events-from-room.js` and identifies the senders and event ID's that match the given regex. Results are saved out to `./data/{roomId}/bad-event-ids-{date}.txt` and `./data/{roomId}/bad-senders-{date}.txt`.

```
node find-bad-events.js --room-id !SdfEMelMdOPSHyPEBb:my.matrix.host --grep "awfe"

node find-bad-events.js --room-id !SdfEMelMdOPSHyPEBb:my.matrix.host --grep "hello\? there"
```

## `clean-up-bad-events.js`

Takes a list of bad event ID's and redacts them. (see script above for creating the list)

```
node clean-up-bad-events.js --homeserver-url http://localhost:18008 --room-id !SdfEMelMdOPSHyPEBb_my.matrix.host --bad-event-ids-file-path "./data/!SdfEMelMdOPSHyPEBb_my.matrix.host/bad-event-ids-1648694479383.txt" --concurrency 5
```
