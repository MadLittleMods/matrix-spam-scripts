'use strict';

const { MatrixClient } = require('matrix-bot-sdk');

const client = new MatrixClient(homeserverUrl, secrets.accessToken);
