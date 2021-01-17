var IRC = require("irc-framework");
var matrix = require("matrix-js-sdk");
var Forwarder = require("./forwarder");

function main() {
  let config = require("./config.json");
  let [mappingI2M, mappingM2I] = buildRoomMaps(config);
  console.log("Logging into IRC...");
  connectIrc(config, (clientIRC) => {
    console.log("Successfully logged into IRC!");
    console.log("Logging into matrix...");
    connectMatrix(config, (clientMatrix) => {
      console.log("Successfully logged into Matrix!");
      new Forwarder(clientIRC, clientMatrix, mappingI2M, mappingM2I).start();
    })
  })
}

function buildRoomMaps(config) {
  let mappingI2M = {};
  let mappingM2I = {};
  for (const [roomIRC, roomMatrix] of config.mapping) {
    mappingI2M[roomIRC] = roomMatrix;
    mappingM2I[roomMatrix] = roomIRC;
  }
  return [mappingI2M, mappingM2I];
}

function connectIrc(config, callback) {
  let client = new IRC.Client();
  client.connect(config.irc);
  client.once('registered', () => { callback(client) });
}

function connectMatrix(config, callback) {
  let client = matrix.createClient(Object.assign(config.matrix, {
    timelineSupport: true
  }));
  let myCallback = (state) => {
    switch (state) {
      case "PREPARED":
        client.removeListener("sync", myCallback);
        callback(client);
        break;
    }
  }
  client.on("sync", myCallback);
  client.startClient(0);
}

main();