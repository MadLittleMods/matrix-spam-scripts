'use strict';

const path = require('path').posix;

function getStorageDirForRoomId(roomId) {
  const storageDir = `./data/${roomId.replace(':', '_')}`;
  return storageDir;
}

function getMessageStorageDirForRoomId(roomId) {
  const storageDir = path.join(getStorageDirForRoomId(roomId), `/messages`);
  return storageDir;
}

module.exports = {
  getStorageDirForRoomId,
  getMessageStorageDirForRoomId,
};
