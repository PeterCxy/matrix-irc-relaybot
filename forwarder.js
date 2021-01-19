var NickMap = require("./nickmap");
var axios = require("axios");
var process = require("process");

module.exports = class Forwarder {
  constructor(clientIRC, clientMatrix, mappingI2M, mappingM2I) {
    this.clientIRC = clientIRC;
    this.clientMatrix = clientMatrix;
    this.mappingI2M = mappingI2M;
    this.mappingM2I = mappingM2I;
    this.nickMap = new NickMap("./nickmap.json");
  }

  joinIRCRooms() {
    for (const room of Object.keys(this.mappingI2M)) {
      this.clientIRC.join(room);
    }
  }

  start() {
    this.joinIRCRooms();
    console.log("Starting relay");
    this.clientIRC.on("close", this.onClose.bind(this));
    this.clientIRC.on("message", this.onIRCMessage.bind(this));
    this.clientMatrix.on("Room.timeline", this.onMatrixMessage.bind(this));
    // Ugly: ensure rooms are joined
    // the "registered" event seems to be unreliable for reconnection
    setInterval(this.joinIRCRooms.bind(this), 20 * 1000);
  }

  onClose() {
    console.log("IRC connection closed and failed to reconnect; exitting...");
    process.exit(-1);
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

    content['net.typeblog.i2m.irc_nick'] = event.nick;

    this.clientMatrix.sendMessage(this.mappingI2M[event.target], content);
  }

  stripMatrixName(name) {
    let _name = name.replace(" (Perigram)", "");
    if (_name.length < 16) {
      return _name;
    } else {
      return _name.slice(0, 16);
    }
  }

  processMatrixName(userId, name) {
    let mappedName = this.nickMap.get(userId);
    if (mappedName) {
      return mappedName;
    } else {
      return this.stripMatrixName(name);
    }
  }

  isMatrixCommand(msg) {
    return msg.startsWith("!");
  }

  shouldUsePastebin(txt) {
    return txt.length >= 160 || txt.split("\n").length > 3;
  }

  async pastebin(txt) {
    let resp = await axios.request({
      url: "https://fars.ee/",
      method: "post",
      headers: {
        "Content-Type": "application/json"
      },
      data: {
        content: txt,
        filename: "message.txt"
      }
    });
    
    if (resp.status != 200) {
      throw resp.statusText;
    } else {
      return resp.data.url;
    }
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

  async onMatrixMessage(event, room, toStartOfTimeline, removed, data) {
    this.clientMatrix.sendReadReceipt(event);
    if (toStartOfTimeline) {
      return; // Ignore pagniation
    }

    if (!this.mappingM2I[room.roomId]) {
      return; // Unmapped room
    }

    if (event.sender.userId == this.clientMatrix.getUserId()) {
      return; // Prevent loop
    }

    if (Date.now() - event.getTs() >= 2 * 60 * 1000) {
      // Ignore events older than 2 minutes
      return;
    }

    if (!data.liveEvent) {
      // Ignore non-live events
      return;
    }

    let content = event.getContent();

    if (event.getType() == "m.room.message" && this.isMatrixCommand(content.body)) {
      if (this.handleMatrixCommand(event.sender, content.body)) {
        return;
      }
    }

    let replyUsername = null;
    if (content['m.relates_to'] && content['m.relates_to']['m.in_reply_to']) {
      let replyEvId = content['m.relates_to']['m.in_reply_to']['event_id'];
      try {
        let tl = await this.clientMatrix.getEventTimeline(room.getUnfilteredTimelineSet(), replyEvId);
        let replyEv = tl.getEvents().filter((v) => v.getId() == replyEvId);
        if (replyEv.length > 0) {
          replyUsername = this.processMatrixName(replyEv[0].sender.userId, replyEv[0].sender.name);
          if (replyEv[0].getContent()['net.typeblog.i2m.irc_nick']) {
            replyUsername = replyEv[0].getContent()['net.typeblog.i2m.irc_nick'];
          }
        }
      } catch (err) {
        console.log(err);
      }
    }

    let replyTxt = "";
    if (replyUsername) {
      replyTxt = replyUsername + ": "
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
            // Get rid of the reply quote generated by Element client
            msgTxt = content.body.replace(/> <(.*)> (.*)\n\n/, "");
            break;
        }
        break;
    }

    if (msgTxt != null) {
      if (this.shouldUsePastebin(msgTxt)) {
        try {
          msgTxt = "Long Msg: " + await this.pastebin(msgTxt);
        } catch (err) {
          console.log(err);
          return;
        }
      }

      let name = this.processMatrixName(event.sender.userId, event.sender.name);
      if (content.msgtype == "m.emote") {
        // Special format for emote
        this.clientIRC.say(this.mappingM2I[room.roomId], `* ${name} ${msgTxt}`);
      } else {
        this.clientIRC.say(this.mappingM2I[room.roomId], `[${name}] ${replyTxt}${msgTxt}`);
      }
    }
  }
}