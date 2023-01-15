module.exports = function (RED) {
  'use strict'
  const fs = require('fs');
  const path = require('path');
  const Telnet = require('./lib/Telnet');
  const Ftp = require('./lib/Ftp');
  const Cgi = require('./lib/VstarcamCgi');
  
  class VstarcamConfigNode {
    constructor(config) {
      RED.nodes.createNode(this, config);

      this.config = {
        host: config.ip,
        web_port: parseInt(config.port || 80),
        user: config.user || this.credentials.user,
        password: config.password || this.credentials.password,
        root_user: config.rootUser || this.credentials.rootUser,
        root_password: config.rootPassword || this.credentials.rootPassword,
        keepalive: parseInt(config.keepalive || 5000),
        verb: parseInt(config.verb || 3),
        configDir: config.configDir || '',
        name: config.name
      };

      this.cgi = new Cgi(this.config, this.config.verb, this.logger);
      this.telnet = //++ new Telnet(this.config, this.config.verb, this.logger);
      
      this.ftp = new Ftp(this.config, this.config.verb, this.logger);
  
      this.verb = config.verb; // 1-err, 2-warn, 3-info, 4-debug, 5-trace
      this.logger = console;
      //?? this.logger = this; //TODO
      this.print = (str=>{ this.logger.log(str); }).bind(this);
  
      this.cgiStatus = 'ready';
      this.cgi.on('status', this.setCgiStatus.bind(this));

      this.ftpStatus = '';
      this.ftp.on('status', this.setFtpStatus.bind(this));

      this.setMaxListeners(0); // by default only 10 listeners are allowed

      this.on('close', this.onClose.bind(this));

      if (this.configDir && !fs.existsSync(config.configDir)) fs.mkdirSync(config.configDir, { recursive: true });
      this.cfgPath = this.configDir ? path.join(this.configDir, (this.name || 'noname') + '.json') : '';
    }

    onClose(done) {
      if (this.connection) this.connection.disconnect();
      this.setStatus(this, '');
      this.removeAllListeners('cgi_status');
      this.removeAllListeners('ftp_status');
      if (done) done();
    }

    set_verb(verb) { 
      this.verb = verb;
      if (this.cgi) this.cgi.verb = verb;
      if (this.telnet) this.telnet.verb = verb;
      if (this.ftp) this.ftp.verb = verb;
    }
  
    setCgiStatus(status) {
      this.cgiStatus = status;
      this.emit('cgi_status', status);
    }

    setFtpStatus(status) {
      this.ftpStatus = status;
      this.emit('ftp_status', status);
    }
    
    async start_ftpd() {
      await this.telnet.connect();
      await this.telnet.send('tcpsvd -vE 0.0.0.0 21 ftpd -w / &\n');
      this.telnet.disconnect();
      console.log('-- ftpd started');
    }

    async get_existing(records, dir) {
      filelist = [];
      for (let record of records) {
        const {filename, filesize} = record;
        const lfilepath = os.path.join(dir, filename);
        if (!fs.existsSync(lfilepath)) return;
        const {size} = fs.statSync(lfilepath);
        if (size === filesize) filelist.push(filename);
        else if (this.verb > 0) print('diff size for ' + filename + ', filesize=' + filesize + ', lsize=' + size);
      };
      return filelist;
    }
  }

  RED.nodes.registerType('vstarcam-config', VstarcamConfigNode, {
    credentials: {
      user: {type:'text'},
      password: {type: 'password'},
      rootUser: {type:'text'},
      rootPassword: {type: 'password'}
    }
  });
}
