'use strict'
const fs = require('node:fs'), path = require('node:path'), net = require('node:net')
module.exports = function fence(home, allowed = new Set()) {
  const keep = new Set(['PATH','SystemRoot','WINDIR','COMSPEC','PATHEXT','OS','NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE'])
  for (const key of Object.keys(process.env)) if (!keep.has(key)) delete process.env[key]
  fs.mkdirSync(home,{recursive:true})
  for (const key of ['HOME','USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP','DSH_HOME','GRADLE_USER_HOME']) process.env[key]=home
  const denied=[]
  const reject = label => { denied.push(label); throw Error('OFFLINE_FENCE '+label) }
  const normalize = args => Array.isArray(args[0]) ? args[0][0] : typeof args[0] === 'object' ? args[0] : {port:args[0],host:typeof args[1]==='string'?args[1]:'localhost'}
  const connect = net.Socket.prototype.connect
  net.Socket.prototype.connect = function(...args) { const o=normalize(args); if(o.path || o.host!=='127.0.0.1' || !allowed.has(Number(o.port))) return reject('connect:'+String(o.host)+':'+String(o.port)); return connect.apply(this,args) }
  net.Server.prototype.listen = function(){ return reject('listen/IPC') }
  require('node:tls').connect = ()=>reject('TLS')
  require('node:dgram').createSocket = ()=>reject('UDP')
  for(const k of ['resolve','resolve4','resolve6']) require('node:dns')[k]=()=>reject('DNS')
  // Node listen calls lookup even for this numeric literal. Resolve locally, never consult DNS.
  require('node:dns').lookup=(host,options,callback)=>{if(host!=='127.0.0.1')return reject('DNS');const cb=typeof options==='function'?options:callback;queueMicrotask(()=>options?.all?cb(null,[{address:'127.0.0.1',family:4}]):cb(null,'127.0.0.1',4))}
  globalThis.fetch=()=>Promise.reject(Error('OFFLINE_FENCE Node-fetch'))
  process.dlopen=()=>reject('native-addon')
  for(const key of ['exec','execFile','spawn','fork','execSync','execFileSync','spawnSync']) require('node:child_process')[key]=()=>reject('child:'+key)
  require('node:module').syncBuiltinESMExports()
  return {denied,reject,allowed}
}
