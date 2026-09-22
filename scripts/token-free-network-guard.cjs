// Preloaded before application imports and inherited by Node test children.
// Tests may install mocks; real HTTP/TLS connections remain disabled below.
const deny = () => { throw new Error('TOKEN_FREE_TEST: network is disabled'); };
globalThis.fetch = async () => deny();
require('node:net').Socket.prototype.connect = deny;
require('node:dgram').Socket.prototype.send = deny;
