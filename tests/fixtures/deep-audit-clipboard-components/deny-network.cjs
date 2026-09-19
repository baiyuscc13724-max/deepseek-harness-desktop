'use strict';
// Fixed deny-all ports, installed before loading any product code. Never calls a real endpoint.
const attempts=[];
const deny = name => (..._args) => { attempts.push(name); throw Error('AUDIT_DENIED:'+name); };
for (const [id,names] of Object.entries({
  'node:net':['connect','createConnection','createServer'],
  'node:tls':['connect','createServer'],
  'node:http':['request','get','createServer'],
  'node:https':['request','get','createServer'],
  'node:http2':['connect','createServer','createSecureServer'],
  'node:dgram':['createSocket'],
  'node:dns':['lookup','resolve','resolve4','resolve6','reverse']
})) { const mod=require(id); for (const name of names) mod[name]=deny(id+':'+name); }
require('node:net').Socket.prototype.connect=deny('Socket.connect');
for(const name of ['lookup','resolve','resolve4','resolve6','reverse']) require('node:dns').promises[name]=deny('dns.promises.'+name);
global.fetch=deny('fetch'); global.WebSocket=class { constructor(){deny('WebSocket')();} };
module.exports={attempts,deny};
