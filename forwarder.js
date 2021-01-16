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
    this.clientMatrix.on("Room.timeline", this.onMatrixMessage.bind(this));
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

  stripMatrixName(name) {
    if (name.length < 16) {
      return name;
    } else {
      return name.slice(0, 16);
    }
  }

  onMatrixMessage(event, room, toStartOfTimeline) {
    if (toStartOfTimeline) {
      return; // Ignore pagniation
    }

    if (!this.mappingM2I[room.roomId]) {
      return; // Unmapped room
    }

    if (event.sender.userId == this.clientMatrix.getUserId()) {
      return; // Prevent loop
    }

    let content = event.getContent();
    console.log(content);
    let msgTxt = null;
    switch (event.getType()) {
      case "m.sticker":
        msgTxt = `${content.body} ${this.clientMatrix.mxcUrlToHttp(content.url)}`;
        break;
      case "m.room.message":
        switch (content.msgtype) {
          case "m.image":
          case "m.audio":
          case "m.file":
          case "m.video":
            msgTxt = `${content.body} ${this.clientMatrix.mxcUrlToHttp(content.url)}`;
            break;
          default:
            msgTxt = content.body;
            break;
        }
        break;
    }

    if (msgTxt != null) {
      let name = this.stripMatrixName(event.sender.name);
      if (content.msgtype == "m.emote") {
        // Special format for emote
        this.clientIRC.say(this.mappingM2I[room.roomId], `* ${name} ${msgTxt}`);
      } else {
        this.clientIRC.say(this.mappingM2I[room.roomId], `[${name}] ${msgTxt}`);
      }
    }
  }
}