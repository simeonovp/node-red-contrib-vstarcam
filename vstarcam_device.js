module.exports = function (RED) {
  'use strict'
  const path = require('path');
  const fs = require('fs');

  class VstarcamBase {
    constructor(config) {
      RED.nodes.createNode(this, config);

      this.deviceConfig = RED.nodes.getNode(config.deviceConfig);
      config.name = config.name || (this.deviceConfig && this.deviceConfig.name);
      config.logDir = config.logDir || path.join('/data', 'logs');
      config.logPath = config.logPath || '{device}/{year}/{month}/{day}/{filename}';
      this.logDir = config.logDir;
      this.logPath = config.logPath;
      this.lastSync;
      if (!fs.existsSync(this.logDir)) fs.mkdirSync(this.logDir, { recursive: true });

      if (this.deviceConfig) {
        this.on('close', this.onClose.bind(this));
      }
    }

    onClose(done) {
      this.deviceConfig.removeListener(this.statusEvent, this.statusListener);
      done();
    }

    onStatus(status) {
      switch(status) {
        case 'unconfigured':
          this.status({ fill: 'red', shape: 'ring', text: status});
          break;
        case 'initializing':
        case 'login':
          this.status({ fill: 'yellow', shape: 'dot', text: status});
          break;
        case 'ready':
        case 'connected':
          this.status({fill: 'green', shape: 'dot', text: status}); 
          break;
        case 'pending':
          this.status({fill: 'green', shape: 'ring', text: status}); 
          break;
        case 'disconnected':
          this.status({ fill: 'red', shape: 'ring', text: status});
          break;
        case '':
          this.status({});
          break;
        default:
          this.status({fill: 'red', shape: 'ring', text: 'unknown'});
      }
    }

    getFullPath({ year, month, day }, filename) {
      const relDir = this.logPath
        .replace(/{device}/g, this.name)
        .replace(/{year}/g, year)
        .replace(/{month}/g, month)
        .replace(/{day}/g, day)
        .replace(/{filename}/g, filename);
      return path.join(this.logDir, relDir);
    }

    getDateDir(date) {
      return path.dirname(this.getFullPath(date, 'foo'));
    }

    getDatePath(date, filename) {
      const fullpath = this.getFullPath(date, filename);
      const dir = path.dirname(fullpath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      return fullpath;
    }

    getFilePath(filename) {
      const date = {
        year: filename.substring(0, 4),
        month: filename.substring(4, 6), 
        day: filename.substring(6, 8)
      };
      return this.getDatePath(date, filename);
    }
  }

  class VstarcamDeviceNode extends VstarcamBase {
    constructor(config) {
      super(config);

      if (!this.deviceConfig || !this.deviceConfig.cgi) return;
      
      this.cgi = this.deviceConfig.cgi;
      this.statusEvent = 'cgi_status';
      this.statusListener = this.onStatus.bind(this);
      this.deviceConfig.addListener(this.statusEvent, this.statusListener);
      this.onStatus(this.deviceConfig.cgiStatus);

      this.on('input', this.onInput.bind(this));
    }
  
    async onInput(msg, send, done) {
      try {
        switch (msg.action) {
        case 'listActions':
          msg.payload = { 
            'listRecords': { 
              parameters: { 
                pars: { value: { PageIndex: 0 }, require: false } 
              },
              result: {
                payload: { 
                  records: [ { filename: '', filesize: 0, filetime: '' }], 
                  record_num0: 0, PageIndex: 0, PageSize: 100, RecordCount: 0, PageCount: 0
               }
              }
            },
            'cancel': {},
            'listCache': {},
            'downloadRecord': {
              parameters: { 
                filename: { value: "", require: true } 
              },
              result: {
                filesize: 0,
                filepath: ""
              }
            },
            'deleteRecord': {
              parameters: { 
                filename: { value: "", require: true } 
              }
            },
            'syncRecord': { // download + delete
              parameters: { 
                filename: { value: "", require: true } 
              },
              result: {
                filesize: 0,
                filepath: ""
              }
            },
            'downloadRecords': {
              parameters: { 
                records: { value: [ { filename: "" } ], require: true } 
              },
              result: {
                records: [ { filepath: "" } ]
              }
            },
            'deleteRecords': {
              parameters: { 
                records: { value: [ { filename: "" } ], require: true } 
              }
            },
            'syncRecords': { // = downloadRecords + deleteRecords
              parameters: { 
                records: { value: [ { filename: "", filesize: 0 } ], require: true } 
              },
              result: {
                records: [ { filepath: "" } ],
                result: {
                  downloded: 0,
                  failed: 0,
                  skipped: 0
                }
              }            
            }
          };
          msg.options = Object.keys(msg.payload);
          break;
        case 'listRecords':
          msg.payload = {};
          msg.pars = msg.pars || { PageIndex: 0 };
          await this.cgi.get_record_files(msg.payload, msg.pars);
          break;
        case 'cancel':
          this.cgi.unlock(); //workaround
          break;
        case 'listCache':
          const dateDir = getDateDir(msg.payload);
          msg.records = [];
          msg.dirs = [];
          fs.readdirSync(testFolder).forEach(name=>{
            if (fs.statSync(name).isDirectory()) msg.dirs.push(name);
            else if (name.endsWith('.h264')) msg.records.push(name);
          });
          break;
        case 'getRecords': //--
          msg.payload = {};
          msg.pars = msg.pars || { PageIndex: 0 };
          await this.cgi.request_record_files(msg.payload, msg.pars);
          break;
        case 'downloadRecord':
          if (!msg.filename) return done('msg.filename not defined');
          const delFilepath = msg.filepath || this.getFilePath(msg.filename);
          msg.filesize = await this.cgi.download_record(msg.filename, delFilepath);
          if (msg.filesize) msg.filepath = delFilepath;
          break;
        case 'deleteRecord':
          if (!msg.filename) return done('msg.filename not defined');
          await this.cgi.del_file(msg.filename);
          break;
        case 'syncRecord':
          if (!msg.filename) return done('msg.filename not defined');
          const syncFilepath = msg.filepath || this.getFilePath(msg.filename);
          msg.filesize = await this.cgi.download_record(msg.filename, syncFilepath);
          if (msg.filesize) {
            msg.filepath = syncFilepath;
            await this.cgi.del_file(msg.filename);
          }
          break;
        case 'downloadRecords':
          if (!msg.records) return done('msg.records not defined');
          for (let record of msg.records) {
            if (!record.selected) continue;
            const filepath = record.filepath || this.getFilePath(record.filename);
            record.filesize = await this.cgi.download_record(record.filename, filepath);
            if (filesize) {
              record.filepath = filepath;
            }
          }
          break;
        case 'deleteRecords':
          if (!msg.records) return done('msg.records not defined');
          for (let record of msg.records) {
            if (!record.selected) continue;
            await this.cgi.del_file(record.filename);
          }
          break;
        case 'syncRecords':
          if (!msg.records) return done('msg.records not defined');
          msg.result = {
            downloded: 0,
            failed: 0,
            skipped: 0
          }
          for (let record of msg.records) {
            if (!record.selected) continue;
            const filepath = record.filepath || this.getFilePath(record.filename);
            if (fs.existsSync(filepath)) { // TODO check filesize
              msg.filepath = filepath;
              msg.result.skipped++;
              await this.cgi.del_file(record.filename);
            }
            else {
              const filesize = await this.cgi.download_record(record.filename, filepath);
              if (filesize && (!record.filesize || (record.filesize == filesize))) {
                record.filepath = filepath;
                msg.result.downloded++;
                await this.cgi.del_file(record.filename);
              }
              else {
                msg.result.failed++;
              }
            }
          }
          break;
        default: done('Action ' + msg.topic + ' is not supported');
        }
        send(msg);
        done();
      }
      catch(e) {
        done(e.stack || e);
      }
    }
  }

  class VstarcamFtpNode extends VstarcamBase {
    constructor(config) {
      super(config);

      if (!this.deviceConfig) return;

      this.statusEvent = 'ftp_status';
      this.statusListener = this.onStatus.bind(this);
      this.deviceConfig.addListener(this.statusEvent, this.statusListener);
      this.onStatus(this.deviceConfig.ftpStatus);

      this.ftpDir = config.ftpDir || '/mnt/sda0/';
      this.ftp = this.deviceConfig.ftp;

      this.on('input', this.onInput.bind(this));
    }
  
    async onInput(msg, send, done) {
      try {
        switch (msg.action) {
        case 'listActions':
          msg.options = [ 'startFtpd',
            'cwd', 'list', 'listRecords',
            'delete', 'syncSd', 'cleanSd',
            'connect', 'disconnect'];
          break;
        case 'startFtpd':
          await this.deviceConfig.start_ftpd();
          break;
        case 'connect':
          await this.ftp.connect();
          break;
        case 'disconnect':
          this.ftp.disconnect();
          break;
        case 'cwd':
          if(!msg.dir) msg.dir = this.ftpDir;
          await this.ftp.cwd(msg.dir);
          break;
        case 'list':
          if (!msg.dir) msg.dir = this.ftpDir;
          msg.payload = await this.ftp.list(msg.dir);
          break;
        case 'delete':
          if (!msg.dir) msg.dir = this.ftpDir;
          if (!msg.filelist && !msg.filename) throw ('Nether defined msg.filelist or msg.filename');
          if (msg.filename) await this.ftp.del_files(msg.dir, [msg.filename]);
          else if (msg.filelist) await this.ftp.del_files(msg.dir, msg.filelist);
          break;
        case 'syncSd':
          if (!msg.dir) msg.dir = path.join(this.logDir, this.name);
          await this.sync_sd(msg.dir);
          break;
        case 'cleanSd':
          if (!msg.dir) msg.dir = path.join(this.logDir, this.name);
          await this.clean_sd(msg.dir);
          break;
        case 'listRecords':
          msg.payload = await this.get_record_files();
          break;
        default: done('Action ' + msg.topic + ' is not supported');
        }
        send(msg);
        done();
      }
      catch(e) {
        done(e.stack || e);
      }
    }

    async sync_sd(dir) {
      const filelist = await this.ftp.list(this.ftpDir);
  
      for (let file of filelist) {
        if (file.type !== '-') return; // isn't a file
        const filename = path.join(this.logDir, this.name, file.name);
        const filepath = path.join(dir, filename);
        if (!fs.existsSync(filepath)) {
          if (this.verb > 2) print('download ' + filename);
          await this.ftp.get(filename, filepath);
        }
        else {
          if (this.verb > 2) print('skip ' + filename);
        }
      };
    }
  
    async clean_sd(dir) {
      const filelist = await this.ftp.list(this.ftpDir);
  
      for (let file of filelist) {
        if (file.type !== '-') return; // isn't a file
        const filename = file.name;
        const filesize = file.size;
        const filepath = path.join(dir, filename);
        if (fs.existsSync(filepath)) {
          const {size} = fs.statSync(filepath);
          if (size === filesize) {
            try {
              await this.telnet.del_file(filename);
              if (this.verb > 2) print('delete ' + filename);
            }
            catch(e) {
              print('delete ' + filename + ' failed:' + e);
            }
          }
          else {
            if (this.verb > 0) print('diff size for ' + filename + ', filesize=' + filesize + ', lsize=' + size);
          }
        }
        else {
          if (this.verb > 2) print('new file ' + filename);
        }
      };
    }
  
    async get_record_files() {
      const wasConnected = this.ftp.connected;
      if (!wasConnected) await this.ftp.connect();
  
      const filelist = await this.ftp.list(this.ftpDir);
      const records = [];
      for (file of filelist) {
        if (file.type === '-') records.push({filename: file.name, filesize: file.size})
      }
  
      if (!wasConnected) this.ftp.disconnect();
      return records
    }
  }

  RED.nodes.registerType('vstarcam-device', VstarcamDeviceNode);
  RED.nodes.registerType('vstarcam-ftp', VstarcamFtpNode);
}
