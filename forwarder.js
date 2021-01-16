var NickMap = require("./nickmap");

module.exports = class Forwarder {
  constructor(clientIRC, clientMatrix, mappingI2M, mappingM2I) {
    this.clientIRC = clientIRC;
    this.clientMatrix = clientMatrix;
    this.mappingI2M = mappingI2M;
    this.mappingM2I = mappingM2I;
    this.nickMap = new NickMap("./nickmap.json");
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

  isMatrixCommand(msg) {
    return msg.startsWith("!");
  }

  handleMatrixCommand(sender, msg) {
    let splitted = msg.split(" ");
    let cmd = splitted[0].slice(1);

    switch (cmd) {
      case "nick":
        if (splitted.length < 2) {
          this.nickMap.set(sender.userId, null);
          this.clientMatrix.sendMessage(sender.roomId, {
            msgtype: "m.text",
            body: `Nickname of '${sender.name}' cleared`
          });
        } else if (splitted.length >= 3 || splitted[1].length > 16) {
          this.clientMatrix.sendMessage(sender.roomId, {
            msgtype: "m.text",
            body: "Invalid nickname format (too long or contains space)"
          });
        } else {
          this.nickMap.set(sender.userId, splitted[1]);
          this.clientMatrix.sendMessage(sender.roomId, {
            msgtype: "m.text",
            body: `Nickname of '${sender.name}' changed to '${splitted[1]}'`
          });
        }

        return true;
      default:
        return false;
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

    if (event.getType() == "m.room.message" && this.isMatrixCommand(content.body)) {
      if (this.handleMatrixCommand(event.sender, content.body)) {
        return;
      }
    }

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
      let mappedName = this.nickMap.get(event.sender.userId);
      if (mappedName) {
        name = mappedName;
      }
      if (content.msgtype == "m.emote") {
        // Special format for emote
        this.clientIRC.say(this.mappingM2I[room.roomId], `* ${name} ${msgTxt}`);
      } else {
        this.clientIRC.say(this.mappingM2I[room.roomId], `[${name}] ${msgTxt}`);
      }
    }
  }
}