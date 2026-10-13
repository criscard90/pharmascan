const http = require('http');
const WebSocket = require('ws');
const PORT = process.env.PORT || 3000;
function send(ws, type, payload) {
  ws.send(JSON.stringify({ type: type, payload: payload || {} }));
}
const server = http.createServer(function (req, res) {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Cline Agent Mobile Bridge Server');
});
const wss = new WebSocket.Server({ server });
wss.on('connection', function (ws) {
  send(ws, 'status', { bridgeState: { connected: true, status: 'connected' } });
  ws.on('message', function (raw) {
    var msg;
    try { msg = JSON.parse(raw.toString()); } catch (e) { return; }
    var payload = msg.payload || {};
    if (msg.type === 'auth') {
      send(ws, 'auth_success', { bridgeState: { connected: true, authenticated: true, status: 'authenticated' } });
    } else if (msg.type === 'ping') {
      send(ws, 'pong', {});
    } else if (msg.type === 'chat_message') {
      var text = (payload.message && payload.message.content) || payload.text || '';
      send(ws, 'chat_message', { message: { role: 'assistant', content: 'Bridge auto-provisionato. Echo: ' + text } });
    }
  });
});
server.listen(PORT, function () {
  console.log('Bridge server listening on port ' + PORT);
});
