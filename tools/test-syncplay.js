/**
 * Prueft "Gemeinsam schauen" (SyncPlay) gegen einen nachgebauten Server.
 *
 * Der Kern der Sache: Wer in einer Gruppe Play, Pause oder Spulen
 * drueckt, darf NICHT selbst handeln — sonst laeuft er den anderen
 * davon. Er bittet den Server; erst dessen Befehl (per WebSocket, mit
 * Zeitpunkt) fuehrt aus. Genau das wird hier geprueft, dazu Uhrabgleich,
 * Gruppenbeitritt und das Verlassen beim Abmelden.
 *
 * Der WebSocket-Teil ist von Hand gebaut (Handshake + Textrahmen),
 * damit der Test ohne zusaetzliches Paket auskommt.
 *
 * Aufruf:  npx electron tools/test-syncplay.js
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const http = require('http');
const crypto = require('crypto');
const path = require('path');

const ROOT = path.join(__dirname, '..');
app.disableHardwareAcceleration();

/* ---------- Minimaler WebSocket-Server ---------- */
const sockets = new Set();

function wsSend(socket, text) {
  const data = Buffer.from(text);
  let header;
  if (data.length < 126) header = Buffer.from([0x81, data.length]);
  else {
    header = Buffer.alloc(4);
    header[0] = 0x81; header[1] = 126; header.writeUInt16BE(data.length, 2);
  }
  socket.write(Buffer.concat([header, data]));
}
const broadcast = (msg) => sockets.forEach((s) => wsSend(s, JSON.stringify(msg)));

app.whenReady().then(async () => {
  const requests = [];
  let wsUrl = '';
  const group = { GroupId: 'g1', GroupName: 'Filmabend', State: 'Idle', Participants: ['Jason'] };

  const server = http.createServer((req, res) => {
    const cors = {
      'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': '*', 'Content-Type': 'application/json'
    };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null, auth: req.headers.authorization });
      if (req.url === '/GetUtcTime') {
        // Serveruhr geht absichtlich 5 Sekunden vor
        const now = new Date(Date.now() + 5000).toISOString();
        res.writeHead(200, cors);
        return res.end(JSON.stringify({ RequestReceptionTime: now, ResponseTransmissionTime: now }));
      }
      if (req.url === '/SyncPlay/List') {
        res.writeHead(200, cors);
        return res.end(JSON.stringify([group]));
      }
      if (req.url === '/SyncPlay/Join') {
        res.writeHead(204, cors); res.end();
        // Der Server bestaetigt ueber den Socket
        setTimeout(() => broadcast({ MessageType: 'SyncPlayGroupUpdate', Data: { GroupId: 'g1', Type: 'GroupJoined', Data: group } }), 30);
        return;
      }
      if (req.url === '/SyncPlay/Leave') {
        res.writeHead(204, cors); res.end();
        return;
      }
      res.writeHead(204, cors);
      res.end();
    });
  });

  server.on('upgrade', (req, socket) => {
    wsUrl = req.url;
    const accept = crypto.createHash('sha1')
      .update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => sockets.delete(socket));
    socket.on('data', (buf) => {
      // Opcode 8 = Close: bestaetigen und schliessen; alles andere (KeepAlive) ignorieren
      if ((buf[0] & 0x0f) === 8) {
        socket.end(Buffer.from([0x88, 0]));
        sockets.delete(socket);
      }
    });
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));

  // Echte Texte statt Schluessel — die Hinweise sollen pruefbar sein
  ipcMain.handle('languages:list', () => require('../languages').list());
  ipcMain.handle('languages:get', (e, c) => require('../languages').get(c));
  require('../languages').init();
  const origin = `http://127.0.0.1:${server.address().port}`;

  const win = new BrowserWindow({
    width: 1400, height: 900, show: false,
    webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false }
  });
  await win.loadFile(path.join(ROOT, 'index.html'));
  await new Promise((r) => setTimeout(r, 800));

  const run = (code) => win.webContents.executeJavaScript(code);
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok: Boolean(ok), detail: detail || '' });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  /* Setup im Renderer: angemeldet, Player mit einem Titel offen */
  await run(`(async () => {
    state.serverUrl = ${JSON.stringify(origin)};
    state.token = 'tok';
    state.userId = 'u1';
    state.username = 'Jason';
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app-shell').classList.remove('hidden');

    // Player vortaeuschen: ein Titel ist offen, kein echtes Video noetig
    vpCurrent.item = { Id: 'm1', Name: 'Film', RunTimeTicks: 72000000000 };
    vp.root.classList.remove('hidden');
    window.__calls = [];
    const v = vp.video;
    Object.defineProperty(v, 'paused', { configurable: true, get: () => window.__paused ?? true });
    v.play = () => { window.__paused = false; __calls.push('play'); return Promise.resolve(); };
    v.pause = () => { window.__paused = true; __calls.push('pause'); };
    seekToDirect = (s) => { __calls.push('seek:' + Math.round(s)); };
    return true;
  })()`);

  /* --- Ohne Gruppe: alles wie bisher --- */
  await run(`(() => { __calls.length = 0; togglePlayVideo(); seekTo(42); })()`);
  let calls = await run('__calls.slice()');
  check('Ohne Gruppe spielt der Player selbst', calls.join() === 'play,seek:42', calls.join());

  /* --- Menue: Gruppen anzeigen und beitreten --- */
  await run(`(async () => { $('syncplay-btn').click(); })()`);
  await wait(400);
  const listed = await run(`[...document.querySelectorAll('.syncplay-group strong')].map((n) => n.textContent)`);
  check('Menue listet die Gruppen des Servers', listed.join() === 'Filmabend', listed.join());

  await run(`document.querySelector('.syncplay-group').click()`);
  await wait(900);

  const joined = await run(`({ active: syncplay.active, name: syncplay.group?.GroupName, offset: syncplay.offsetMs,
    btn: $('syncplay-btn').classList.contains('active'), badge: $('vp-syncplay').textContent })`);
  check('Beitritt ueber den Socket bestaetigt', joined.active && joined.name === 'Filmabend', JSON.stringify(joined));
  check('Uhrversatz zum Server gemessen', Math.abs(joined.offset - 5000) < 400, Math.round(joined.offset) + ' ms');
  check('WebSocket mit Token und Geraet geoeffnet', /api_key=tok/.test(wsUrl) && /deviceId=/.test(wsUrl), wsUrl);
  check('Knopf und Badge zeigen die Gruppe', joined.btn && joined.badge.length > 0, joined.badge);
  const joinReq = requests.find((r) => r.url === '/SyncPlay/Join');
  check('Join mit Gruppenkennung und Anmeldung', joinReq?.body?.GroupId === 'g1' && /Token="tok"/.test(joinReq.auth || ''));

  /* --- In der Gruppe: nur bitten, nicht handeln --- */
  requests.length = 0;
  await run(`(() => { __calls.length = 0; window.__paused = true; togglePlayVideo(); seekTo(100); })()`);
  await wait(200);
  calls = await run('__calls.slice()');
  check('Play/Seek wirken nicht sofort', calls.length === 0, calls.join());
  check('Stattdessen Bitte an den Server',
    requests.some((r) => r.url === '/SyncPlay/Unpause') &&
    requests.some((r) => r.url === '/SyncPlay/Seek' && r.body?.PositionTicks === 100 * 10000000),
    requests.map((r) => r.url).join(' '));

  /* --- Befehl des Servers mit Zeitpunkt --- */
  await run(`__calls.length = 0`);
  const when = new Date(Date.now() + 5000 + 400).toISOString(); // Serverzeit: in 400 ms
  broadcast({ MessageType: 'SyncPlayCommand', Data: { GroupId: 'g1', Command: 'Unpause', When: when, PositionTicks: 0, PlaylistItemId: 'p1' } });
  await wait(150);
  calls = await run('__calls.slice()');
  check('Befehl wartet auf seinen Zeitpunkt', calls.length === 0, calls.join());
  await wait(500);
  calls = await run('__calls.slice()');
  check('Zum Zeitpunkt wird gespielt', calls.includes('play'), calls.join());

  await run(`__calls.length = 0`);
  broadcast({ MessageType: 'SyncPlayCommand', Data: { GroupId: 'g1', Command: 'Pause', When: new Date(Date.now() + 5000).toISOString(), PositionTicks: 300000000 } });
  await wait(200);
  calls = await run('__calls.slice()');
  check('Pause haelt an und richtet die Stelle aus', calls[0] === 'pause' && calls.includes('seek:30'), calls.join());

  await run(`__calls.length = 0`);
  broadcast({ MessageType: 'SyncPlayCommand', Data: { GroupId: 'other', Command: 'Unpause', When: new Date(Date.now() + 5000).toISOString() } });
  await wait(150);
  calls = await run('__calls.slice()');
  check('Befehle fremder Gruppen werden ignoriert', calls.length === 0, calls.join());

  /* --- Mitglieder --- */
  broadcast({ MessageType: 'SyncPlayGroupUpdate', Data: { GroupId: 'g1', Type: 'UserJoined', Data: 'Anna' } });
  await wait(150);
  const members = await run(`({ p: syncplay.group.Participants, toast: $('toast').textContent })`);
  check('Neues Mitglied wird angezeigt', members.p.includes('Anna') && members.toast.includes('Anna'), members.toast);

  /* --- Titel in der Gruppe starten --- */
  requests.length = 0;
  await run(`playVideo({ Id: 'ep2', Name: 'Folge 2', Type: 'Episode' }, [{ Id: 'ep1' }, { Id: 'ep2', Type: 'Episode' }])`);
  await wait(200);
  const queueReq = requests.find((r) => r.url === '/SyncPlay/SetNewQueue');
  check('Start in der Gruppe geht als Warteschlange an den Server',
    queueReq?.body?.PlayingQueue?.join() === 'ep1,ep2' && queueReq.body.PlayingItemPosition === 1,
    JSON.stringify(queueReq?.body));

  /* --- Abmelden verlaesst die Gruppe --- */
  requests.length = 0;
  await run(`el.disconnectBtn.click()`);
  await wait(300);
  const after = await run(`({ active: syncplay.active, btn: $('syncplay-btn').classList.contains('active') })`);
  check('Abmelden verlaesst die Gruppe', requests.some((r) => r.url === '/SyncPlay/Leave') && !after.active, JSON.stringify(after));
  await wait(200);
  check('Socket wird geschlossen', sockets.size === 0, sockets.size + ' offen');

  results.forEach((r) => console.log(`${r.ok ? 'OK  ' : 'FAIL'}  ${r.name}${r.detail ? '  — ' + r.detail : ''}`));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} bestanden`);
  server.close();
  app.exit(failed ? 1 : 0);
});
