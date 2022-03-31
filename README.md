## Setup

`config.json`

```json
{
  "accessToken": "xxx"
}
```

## Scripts

## `fetch-events-from-room.js`

Paginate from the beginning of the room to the specified `--stop-date` if provided and save all events to `./messages/{roomId}` in `ndjson`(new-line delimited JSON) format to be processed by the other scripts.

You can also resume progress if the program errors or stops by passing the `--resume` flag.

```
node fetch-events-from-room.js --homeserver-url http://localhost:18008 --room-id !SdfEMelMdOPSHyPEBb:my.matrix.host

node fetch-events-from-room.js --homeserver-url http://localhost:18008 --room-id !SdfEMelMdOPSHyPEBb:my.matrix.host --stop-date 1618468687519

node fetch-events-from-room.js --homeserver-url http://localhost:18008 --room-id !SdfEMelMdOPSHyPEBb:my.matrix.host --resume
```

## `find-bad-events.js`

```
node find-bad-events.js --room-id !SdfEMelMdOPSHyPEBb:my.matrix.host --grep "awfe"
```
