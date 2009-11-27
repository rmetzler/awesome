/*
  Awesome is a redis clone for node.js

  Initial code by Jan Lehnardt <jan@apache.org>

  MIT License
*/

var PORT = 6379;

var tcp = require("tcp");
var sys = require("sys");

var enable_debug = true;

var store = require("./store");

var server = tcp.createServer(function(socket) {
  // requests and responses have this as a trailer
  var eol = "\r\n";

  var EMPTY_VALUE = {};

  var reply = {
    send: function(s) {
      debug("reply: '" + s + "'");
      socket.send(s + eol);
    },

    ok: function() {
      this.send("+OK")
    },

    bulk: function(s) {
      this.send("$" + s.toString().length);
      this.send(s);
    },

    error: function(s) {
      this.send("-ERR " + s);
    },

    _true: function() {
      this.send(":1");
    },

    _false: function(s) {
      this.send(":0");
    },

    nil: function(s) {
      this.send("$-1");
    },
  };

  function Command(line) {

    function parseCommand(s) {
      var cmd = "";
      for(var idx = 0; idx < s.length; ++idx) {
        var chr = s[idx];
        if(chr == " " || chr == "\r" || chr == "\n") {
          return cmd;
        }
        cmd += chr;
      }
      return cmd;
    }

    function parseArgs(s) {
      var args = [];
      var arg = "";
      var argidx = 0;
      for(var idx = 0; idx < s.length; ++idx) {
        var chr = s[idx];
        if(chr == " " || chr == "\r" || chr == "\n") {
          if(arg) {
            args.push(arg);
            argidx = argidx + 1;
            arg = "";
          }
        } else {
          arg += chr;
        }
      }
      return args;
    }

    this.cmd = parseCommand(line).toLowerCase();
    this.args = parseArgs(line);

    var that = this;

    var callbacks = {
      // keep sorted alphabetically
      // list-related functions at the end
      dbsize: {
        inline: true,
        callback: function() {
          debug("received DBSIZE command");
          var size = store.dbsize();
          reply.send(":" + size);
        }
      },

      del: {
        inline: true,
        callback:function() {
          debug("received DEL command");
          if(that.args.length > 2) {
            var keys = that.args.slice(1);
            var deleted = store.del(keys);
            reply.send(":" + deleted);
          } else {
            var key = that.args[1];
            if(store.has(key)) {
              store.del(key);
              reply._true();
            } else {
              reply._false();
            }
          }
        }
      },

      get: {
        inline: true,
        callback: function() {
          debug("received GET command");
          var key = that.args[1];
          if(store.has(key)) {
            var value = store.get(key);
            if(EMPTY_VALUE === value) {
              // empty value
              reply.bulk("");
            } else {
              reply.bulk(value);
            }
          } else { // not found
            reply.nil();
          }
        }
      },

      getset: {
        inline: false,
        callback: function() {
          debug("received GETSET command");
          var key = that.args[1];
          if(store.has(key)) {
            var value = store.get(key);
            reply.send("$" + value.length);
            reply.send(value);
          } else { // not found
            reply.nil();
          }
        }
      },

      incr: {
        inline: true,
        callback: function() {
          var key = that.args[1];
          var value = store.incr(key);
          reply.send(":" + value);
        }
      },

      decr: {
        inline: true,
        callback: function() {
          var key = that.args[1];
          var value = store.decr(key);
          reply.send(":" + value);
        }
      },

      incrby: {
        inline: true,
        callback: function() {
          var key = that.args[1];
          var increment = that.args[2];
          var value = store.incrby(key, increment);
          reply.send(":" + value);
        }
      },

      decrby: {
        inline: true,
        callback: function() {
          var key = that.args[1];
          var decrement = that.args[2];
          var value = store.decrby(key, decrement);
          reply.send(":" + value);
        }
      },

      exists: {
        inline: true,
        callback: function() {
          debug("received EXISTS command");
          var key = that.args[1];
          if(store.has(key)) {
            reply._true();
          } else {
            reply._false();
          }
        }
      },

      info: {
        inline: true,
        callback: function() {
          debug("received INFO command");
          reply.send("awesome, the awesome node.js redis clone");
        }
      },

      keys: {
        inline: true,
        callback: function() {
          debug("received KEYS command");
          var pattern = that.args[1] || '*';
          var result = store.keys(pattern);
          reply.bulk(result);
        }
      },

      mget: {
        inline: true,
        callback: function() {
          debug("received MGET command");
          var keys = that.args.slice(1);
          var values = store.mget(keys);
          reply.send("*" + values.length);
          values.forEach(function(value) {
            if(value) {
              reply.bulk(value);
            } else {
              reply.nil();
            }
          });
        }
      },

      ping: {
        inline: true,
        callback: function() {
          debug("received PING command");
          reply.send("+PONG");
        }
      },

      quit: {
        inline: true,
        callback: function() {
          debug("received QUIT command");
          socket.close();
        }
      },

      select: {
        inline: true,
        callback: function() {
          debug("received SELECT command");
          var index = that.args[1];
          store.select(index);
          reply.ok();
        }
      },

      set: {
        inline: false,
        callback: function() {
          debug("received SET command");
          var key = that.args[1];
          var value = that.data || EMPTY_VALUE;
          store.set(key, value);
          reply.ok();
        }
      },

      setnx: {
        inline: false,
        callback: function() {
          debug("received SETNX command");
          var key = that.args[1];
          if(!store.has(key)) {
            store.set(key, that.data);
            reply._true();
          } else {
            reply._false();
          }
        }
      },
      
      // list related functions
      lindex: {
        inline: true,
        callback: function() {
          debug("received LINDEX command");
          var key = that.args[1];
          var index = parseInt(that.args[2]);

          if(isNaN(index)) {
            // Redis assumes index 0 when anything but an 
            // integer is passed as the index
            index = 0;
          }

          if(store.has(key)) {
            var value = store.get(key);
            if(!store.is_array(value)) {
              reply.error("Operation against a key holding the wrong kind of value");
              return;
            }
            if(index < 0) {
              index = value.length + index;
            }
            if(index < 0 || index > value.length) {
              reply.bulk('');
            } else {
              reply.bulk(value[index]);
            }
          }
        }
      },

      llen: {
        inline: true,
        callback: function() {
          debug("received LLEN command");
          var key = that.args[1];
          var value = store.get(key);
          if(value !== false) {
            if(store.is_array(value)) {
              reply.send(":" + value.length);
            } else {
              reply.error("Operation against a key holding the wrong kind of value");
            }
          } else {
            reply.send(":0");
          }
        }
      },

      lpush: {
        inline: false,
        callback: function() {
          debug("received LPUSH command");
          var key = that.args[1];
          var value = that.data || EMPTY_VALUE;
          if(!store.has(key)) {
            store.set(key, [value]);
          } else {
            var old_value = store.get(key);
            if(store.is_array(old_value)) {
              old_value.unshift(value);
            } else {
              reply.error("Operation against a key holding the wrong kind of value");
              return;
            }
          }
          reply.ok();
        }
      },

      lpop: {
        inline: true,
        callback: function() {
          debug("received LPOP command");
          var key = that.args[1];
          var value = store.get(key);
          if(value && value.length > 0) {
            reply.send(value.shift());
          } else {
            reply.send("$-1");
          }
        }
      },

      rpush: {
        inline: false,
        callback: function() {
          debug("received RPUSH command");
          var key = that.args[1];
          var value = that.data || EMPTY_VALUE;
          if(!store.has(key)) {
            store.set(key, [value]);
          } else {
            var old_value = store.get(key);
            if(store.is_array(old_value)) {
              old_value.push(value);
            } else {
              reply.error("Operation against a key holding the wrong kind of value");
              return;
            }
          }
          reply.ok();
        }
      },

      rpop: {
        inline: false,
        callback: function() {
          debug("received RPOP command");
          var key = that.args[1];
          var value = store.get(key);
          if(value && value.length > 0) {
            reply.send(value.shift());
          } else {
            reply.send("$-1");
          }
        }
      },

      // for debugging
      dump: {
        inline: true,
        callback: function() {
          debug("received DUMP command");
          sys.print(store.dump() + eol);
          reply.ok();
        }
      },

    };

    this.is_inline = function() {
      if(typeof callbacks[this.cmd] === "undefined") {
        return true; // unkown cmds are inline
      }

      return callbacks[this.cmd].inline;
    };

    this.setData = function(data) {
      this.data = data.trim();
    }

    this.exec = function() {
      debug("in exec '" + this.cmd + "'");
      if(callbacks[this.cmd]) {
        callbacks[this.cmd].callback(this.args);
      } else {
        socket.send("-ERR unknown command" + eol);
      }
    };

    return this;
  }

  socket.setEncoding("utf8"); // check with redis protocol

  function debug(s) {
    if(enable_debug) {
      sys.print(s.substr(0,40) + eol);
    }
  }

  // for reading requests

  function adjustBuffer(buffer) {
    return buffer.substr(buffer.indexOf(eol) + 2)
  }

  function parseData(s) {
    var start = s.indexOf(eol) + 2;
    return s.substring(start, s.indexOf(eol, start));
  }

  var buffer = "";
  var in_bulk_request = false;
  var cmd = {};
  socket.addListener("receive", function(packet) {
    buffer += packet;
    debug("read: '" + buffer.substr(0, 36) + "'");
    var idx;
    while(idx = buffer.indexOf(eol) != -1) { // we have a newline
      if(in_bulk_request) {
        debug("in bulk req");
        // later
        cmd.setData(buffer);
        in_bulk_request = false;
        buffer = adjustBuffer(buffer);
        cmd.exec();
      } else {
        // not a bulk request yet
        debug("not in bulk req yet");
        cmd = Command(buffer);
        if(cmd.is_inline()) {
          cmd.exec();
        } else {
          if(buffer.indexOf(eol) != buffer.lastIndexOf(eol)) { // two new lines
            debug("received a bulk command in a single buffer");
            // parse out command line
            cmd.setData(parseData(buffer));
            in_bulk_request = false;
            buffer = adjustBuffer(buffer);
            cmd.exec();
          } else {
            debug("wait for bulk: '" + buffer + "'");
            in_bulk_request = true;
          }
        }
        buffer = adjustBuffer(buffer);
      }
    }
  });

  socket.addListener("eof", function() {
    socket.close();
  });
});

server.listen(PORT, "localhost");
