module.exports = class Forwarder {
  constructor(clientIRC, clientMatrix, mappingI2M, mappingM2I) {
    this.clientIRC = clientIRC;
    this.clientMatrix = clientMatrix;
    this.mappingI2M = mappingI2M;
    this.mappingM2I = mappingM2I;
  }

  joinIRCRooms() {
    console.log("Joining IRC Rooms...");
    for (const room of Object.keys(this.mappingI2M)) {
      this.clientIRC.say("ChanServ", "INVITE " + room);
      this.clientIRC.join(room);
    }
  }

  start() {
    this.joinIRCRooms();
    console.log("Starting relay");
    this.clientIRC.on("registered", this.onReconnect.bind(this));
    this.clientIRC.on("message", this.onIRCMessage.bind(this));
  }

  onReconnect() {
    console.log("IRC client reconnected");
    this.joinIRCRooms();
  }

  onIRCMessage(event) {
    if (!event.target) {
      // Not something we care about
      return;
    }

    if (!this.mappingI2M[event.target]) {
      // Not a mapped channel
      return;
    }

    let content = null;
    if (event.type == "action") {
      content = {
        msgtype: "m.text",
        body: `* ${event.nick} ${event.message}`
      }
    } else {
      content = {
        msgtype: "m.text",
        body: `[${event.nick}] ${event.message}`
      }
    }

    this.clientMatrix.sendMessage(this.mappingI2M[event.target], content);
  }
}