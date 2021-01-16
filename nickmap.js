var fs = require("fs");
var process = require("process");

module.exports = class NickMap {
  constructor(filename) {
    this.filename = filename;
    this.map = {};
    this.modified = false;
    if (fs.existsSync(this.filename)) {
      this.map = JSON.parse(fs.readFileSync(this.filename).toString("utf8"));
    }
    setInterval(this.saveFile.bind(this), 1000);
  }

  saveFile() {
    if (!this.modified) return;
    this.modified = false;
    fs.writeFile(this.filename, JSON.stringify(this.map), (err) => {
      if (err) {
        console.log("Failed to save nickname map file");
        process.exit(-1);
      }
    });
  }

  get(uid) {
    return this.map[uid];
  }

  set(uid, name) {
    this.modified = true;

    if (name) {
      this.map[uid] = name;
    } else {
      delete this.map[uid];
    }
  }
}