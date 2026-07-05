// ═══════════════════════════════════════════════════════════════════════════
//  NOVABOT v2 — Full Selfbot with Anti-Detection
// ═══════════════════════════════════════════════════════════════════════════

// ─── Helpers ─────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
function rand(min,max){ return Math.floor(Math.random()*(max-min+1))+min; }
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function escHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=rand(0,i); [a[i],a[j]]=[a[j],a[i]]; } return a; }

let toastTimeout = null;
function showToast(msg,type='info'){
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast '+type;
  t.style.display = 'block';
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(()=>{ t.style.display = 'none'; }, 3500);
}

// ─── Anti-Detection Engine ──────────────────────────────────────────────
const Evasion = {
  // Realistic browser User-Agent (rotated)
  userAgents: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  ],
  currentUA: null,

  init(){
    this.currentUA = this.userAgents[rand(0,this.userAgents.length-1)];
  },

  headers(token){
    return {
      'Authorization': token,
      'Content-Type': 'application/json',
      'User-Agent': this.currentUA,
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Origin': 'https://discord.com',
      'Referer': 'https://discord.com/channels/@me',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
    };
  },

  // Human-like typing simulation
  async humanTyping(token, cid){
    // Realistic typing duration: 1.5-4 seconds
    const duration = rand(1500, 4000);
    try {
      await API.req(token, '/channels/'+cid+'/typing', { method: 'POST', headers: this.headers(token) });
      // Break up the typing into small chunks like a real human
      const chunks = rand(2, 5);
      const chunkTime = Math.floor(duration / chunks);
      for(let i=0; i<chunks; i++){
        await sleep(rand(chunkTime-200, chunkTime+300));
      }
    } catch(_){}
  },

  // Random delay between actions (anti-rate-limit + anti-pattern)
  async humanDelay(token, cid){
    // Random delay between 3-12 seconds (human reaction time)
    const base = rand(3000, 8000);
    // Add jitter
    const jitter = rand(0, 4000);
    await sleep(base + jitter);
  },

  // Random breaks every few cycles (looks natural)
  async maybeTakeBreak(){
    // 8% chance to take a 30-90 second break
    if(rand(1,100) <= 8){
      const breakLen = rand(30000, 90000);
      document.getElementById('statusText2').textContent = 'Break '+(breakLen/1000).toFixed(0)+'s (anti-detect)';
      await sleep(breakLen);
      return true;
    }
    return false;
  },
};

// ─── State ────────────────────────────────────────────────────────────────
const state = {
  token: null,
  user: null,
  channels: [],       // all text channels
  filteredChannels: [], // channels matching "trade"/"trading"
  guilds: [],
  selectedGuildId: null,
  running: false,
  stopped: false,
  invites: JSON.parse(localStorage.getItem('nova_invites') || '[]'),
  messages: JSON.parse(localStorage.getItem('nova_automessages') || '[]'),
  dmReply: localStorage.getItem('nova_dmreply') || '',
  sendCount: parseInt(localStorage.getItem('nova_sendCount')) || 3,
  minDelay: parseFloat(localStorage.getItem('nova_minDelay')) || 5,
  maxDelay: parseFloat(localStorage.getItem('nova_maxDelay')) || 12,
  dmListenerInterval: null,
  friendAccepterInterval: null,
  knownDMChannels: new Set(),
  requestCount: 0,
  lastRequestTime: Date.now(),
};

// ─── API ──────────────────────────────────────────────────────────────────
const API = {
  base: 'https://discord.com/api/v9',

  async req(token, path, opts={}){
    state.requestCount++;
    state.lastRequestTime = Date.now();

    const headers = Evasion.headers(token);
    if(opts.headers) Object.assign(headers, opts.headers);

    const r = await fetch(this.base+path, {...opts, headers});

    // Handle 429 rate limit with Retry-After
    if(r.status === 429){
      let retryAfter = 5000;
      try {
        const body = await r.json();
        retryAfter = (body.retry_after || 5) * 1000 + rand(1000, 3000);
      } catch(_){ retryAfter = 5000 + rand(1000, 3000); }
      showToast('Rate limited — waiting '+(retryAfter/1000).toFixed(0)+'s','info');
      await sleep(retryAfter);
      // Retry once
      const r2 = await fetch(this.base+path, {...opts, headers});
      if(!r2.ok){ let e; try{e=(await r2.json()).message}catch(_){e='HTTP '+r2.status}; throw new Error(e); }
      if(r2.status===204) return null;
      return r2.json();
    }

    if(!r.ok){ let e; try{e=(await r.json()).message}catch(_){e='HTTP '+r.status}; throw new Error(e); }
    if(r.status===204) return null;
    return r.json();
  },

  getMe:            (t) => API.req(t, '/users/@me'),
  getGuilds:        (t) => API.req(t, '/users/@me/guilds'),
  getGuildChannels: (t,g) => API.req(t, '/guilds/'+g+'/channels'),
  sendMsg:          (t,c,content) => API.req(t, '/channels/'+c+'/messages', {method:'POST', body:JSON.stringify({content, nonce:Date.now().toString(), tts:false, flags:0})}),
  joinGuild:        (t,code) => API.req(t, '/invites/'+code, {method:'POST'}),
  getDMs:           (t) => API.req(t, '/users/@me/channels'),
  getChannelMsgs:   (t,c,limit=1) => API.req(t, '/channels/'+c+'/messages?limit='+limit),
  getFriendReqs:    (t) => API.req(t, '/users/@me/relationships'),
  acceptFriendReq:  (t,uid) => API.req(t, '/users/@me/relationships/'+uid, {method:'PUT', body:JSON.stringify({type:1})}),
};

// ─── Login / Logout ──────────────────────────────────────────────────────
async function login(token){
  try {
    Evasion.init();
    state.user = await API.getMe(token);
    state.token = token;
    localStorage.setItem('nova_token', token);
    showToast('Logged in as '+state.user.username, 'success');
    $('loginScreen').classList.add('hidden');
    $('dashboard').classList.remove('hidden');
    document.getElementById('statusDot').className = 'status-dot online';
    document.getElementById('statusText').textContent = 'Connected';
    document.getElementById('userTag').textContent = state.user.username+'#'+state.user.discriminator;
    // Restore UI
    document.getElementById('sendCount').value = state.sendCount;
    document.getElementById('minDelay').value = state.minDelay;
    document.getElementById('maxDelay').value = state.maxDelay;
    document.getElementById('dmReplyInput').value = state.dmReply;
    document.getElementById('dmReplyStatus').textContent = state.dmReply ? 'Active: "'+state.dmReply.substring(0,30)+'..."' : 'Not set';
    renderInvites();
    renderAutoMessages();
    // Load guilds + channels
    await loadGuildsAndChannels();
    // Auto-join servers
    if(state.invites.length > 0){
      showToast('Auto-joining '+state.invites.length+' servers...', 'info');
      await joinAllServers();
    }
    // Start listeners
    startDMListener();
    startFriendAccepter();
  } catch(e){
    showToast('Invalid token: '+e.message, 'error');
  }
}

function logout(){
  if(state.dmListenerInterval) clearInterval(state.dmListenerInterval);
  if(state.friendAccepterInterval) clearInterval(state.friendAccepterInterval);
  state.dmListenerInterval = null;
  state.friendAccepterInterval = null;
  state.token = null; state.user = null;
  state.running = false; state.stopped = true;
  state.guilds = []; state.channels = []; state.filteredChannels = [];
  state.knownDMChannels.clear();
  localStorage.removeItem('nova_token');
  $('dashboard').classList.add('hidden');
  $('loginScreen').classList.remove('hidden');
  document.getElementById('statusDot').className = 'status-dot offline';
  document.getElementById('statusText').textContent = 'Disconnected';
  document.getElementById('userTag').textContent = '—';
  showToast('Logged out', 'info');
}

// ─── Server & Channel Browser (with Trade filter) ────────────────────────
async function loadGuildsAndChannels(){
  try {
    document.getElementById('serverList').innerHTML = '<div class="empty-state" style="color:#888;">Loading servers...</div>';
    state.guilds = await API.getGuilds(state.token);
    state.channels = [];
    state.filteredChannels = [];

    // Load channels for ALL guilds
    for(let i=0; i<state.guilds.length; i++){
      const g = state.guilds[i];
      try {
        const chs = await API.getGuildChannels(state.token, g.id);
        for(let j=0; j<chs.length; j++){
          if(chs[j].type === 0){ // text channel
            const ch = { id: chs[j].id, name: chs[j].name, guildId: g.id, guildName: g.name };
            state.channels.push(ch);
            // Auto-filter: channels matching "trade" or "trading"
            const lower = chs[j].name.toLowerCase();
            if(lower.includes('trade') || lower.includes('trading')){
              state.filteredChannels.push(ch);
            }
          }
        }
      } catch(_){}
      // Humanized delay between guild requests to avoid rate limits
      if(i < state.guilds.length-1) await sleep(rand(800, 1500));
    }

    renderServerList();
    renderFilteredChannels();
    showToast('Loaded '+state.guilds.length+' servers, '+state.filteredChannels.length+' trade channels','success');
  } catch(e){
    showToast('Failed to load: '+e.message,'error');
  }
}

function renderServerList(){
  const container = document.getElementById('serverList');
  if(state.guilds.length === 0){
    container.innerHTML = '<div class="empty-state">No servers found.</div>';
    return;
  }
  container.innerHTML = state.guilds.map(g => {
    const active = g.id === state.selectedGuildId ? 'active' : '';
    // Count trade channels in this guild
    const tradeCount = state.channels.filter(c => c.guildId === g.id && (c.name.toLowerCase().includes('trade') || c.name.toLowerCase().includes('trading'))).length;
    const initial = (g.name || '?')[0].toUpperCase();
    // Color hash from guild id
    const hue = parseInt(g.id.slice(-6), 16) % 360;
    return '<div class="server-item '+active+'" data-guild="'+g.id+'">'+
      '<div class="icon" style="background:hsl('+hue+',30%,18%);color:hsl('+hue+',70%,70%)">'+escHtml(initial)+'</div>'+
      '<span class="sname">'+escHtml(g.name)+'</span>'+
      (tradeCount > 0 ? '<span class="scount">'+tradeCount+'</span>' : '')+
    '</div>';
  }).join('');

  // Click handler: show trade channels for that server
  container.querySelectorAll('.server-item').forEach(el => {
    el.addEventListener('click', function(){
      const gid = this.dataset.guild;
      state.selectedGuildId = gid;
      renderServerList(); // re-render to show active
      // Show only trade channels for this guild
      const chs = state.filteredChannels.filter(c => c.guildId === gid);
      if(chs.length === 0){
        document.getElementById('channelList').innerHTML = '<div class="empty-state">No trade channels in this server.</div>';
      } else {
        renderChannelCheckboxes(chs);
      }
    });
  });
}

function renderFilteredChannels(){
  const container = document.getElementById('channelList');
  if(state.filteredChannels.length === 0){
    container.innerHTML = '<div class="empty-state">No trade/trading channels found in any server.</div>';
    return;
  }
  // Show first guild's channels by default
  if(!state.selectedGuildId || !state.filteredChannels.some(c=>c.guildId===state.selectedGuildId)){
    state.selectedGuildId = state.filteredChannels[0].guildId;
    renderServerList();
  }
  const chs = state.filteredChannels.filter(c => c.guildId === state.selectedGuildId);
  renderChannelCheckboxes(chs.length > 0 ? chs : state.filteredChannels);
}

function renderChannelCheckboxes(chs){
  const container = document.getElementById('channelList');
  container.innerHTML = chs.map(c =>
    '<div class="channel-grid-item">'+
      '<input type="checkbox" value="'+c.id+'" checked>'+
      '<span class="cname">#'+escHtml(c.name)+'</span>'+
      '<span class="cguild">'+escHtml(c.guildName)+'</span>'+
    '</div>'
  ).join('');
}

function getSelectedChannels(){
  return Array.from(document.querySelectorAll('#channelList input[type="checkbox"]:checked')).map(cb=>cb.value);
}

// ─── Invites ──────────────────────────────────────────────────────────────
function extractCode(str){
  let m = str.match(/(?:discord\.(?:gg|com\/invite)\/)([\w-]+)/i);
  return m ? m[1] : str.trim().replace(/^https?:\/\//,'').replace(/^(?:discord\.)?(?:gg|com\/invite)\//,'');
}

function renderInvites(){
  const c = document.getElementById('inviteList');
  if(state.invites.length===0){ c.innerHTML='<div class="empty-state">No invites added.</div>'; return; }
  c.innerHTML = state.invites.map((inv,i)=>
    '<div class="invite-item"><span class="code">'+escHtml(inv)+'</span><span class="del" data-idx="'+i+'">✕</span></div>'
  ).join('');
  c.querySelectorAll('.del').forEach(el=>{
    el.addEventListener('click',()=>{
      const idx = parseInt(el.dataset.idx);
      state.invites.splice(idx,1);
      localStorage.setItem('nova_invites',JSON.stringify(state.invites));
      renderInvites();
    });
  });
}

async function joinAllServers(){
  if(!state.token){ showToast('Not logged in','error'); return; }
  if(state.invites.length===0){ showToast('No invites to join','error'); return; }
  let joined = 0;
  for(const raw of state.invites){
    const code = extractCode(raw);
    if(!code) continue;
    try {
      await API.joinGuild(state.token, code);
      joined++;
      showToast('Joined: '+code,'success');
      await sleep(rand(3000, 6000)); // humanized delay between joins
    } catch(e){ /* already in or invalid */ await sleep(rand(1000,3000)); }
  }
  if(joined>0) showToast('Joined '+joined+' server(s)','success');
  else showToast('No new servers joined (maybe already in)','info');
  // Reload guilds/channels
  if(joined>0){ await sleep(2000); await loadGuildsAndChannels(); }
}

// ─── Auto Messages ───────────────────────────────────────────────────────
function renderAutoMessages(){
  const c = document.getElementById('msgList');
  if(state.messages.length===0){ c.innerHTML='<div class="empty-state">No messages in queue.</div>'; return; }
  c.innerHTML = state.messages.map((msg,i)=>
    '<div class="msg-item"><span style="flex:1;word-break:break-word">'+escHtml(msg)+'</span><span class="del" data-idx="'+i+'">✕</span></div>'
  ).join('');
  c.querySelectorAll('.del').forEach(el=>{
    el.addEventListener('click',()=>{
      const idx = parseInt(el.dataset.idx);
      state.messages.splice(idx,1);
      localStorage.setItem('nova_automessages',JSON.stringify(state.messages));
      renderAutoMessages();
    });
  });
}

// ─── Message Sender with Anti-Detect ─────────────────────────────────────
async function startSending(){
  if(state.running) return;
  const msg = state.messages[0];
  if(!msg || state.messages.length===0){ showToast('Add at least one message to the queue','error'); return; }
  const channels = getSelectedChannels();
  if(channels.length===0){ showToast('Select at least one channel','error'); return; }
  const count = parseInt(document.getElementById('sendCount').value) || 1;
  const minDelay = (parseFloat(document.getElementById('minDelay').value)||5)*1000;
  const maxDelay = (parseFloat(document.getElementById('maxDelay').value)||12)*1000;
  if(minDelay>=maxDelay){ showToast('Max must be > min delay','error'); return; }

  // Save settings
  state.sendCount = count;
  state.minDelay = parseFloat(document.getElementById('minDelay').value)||5;
  state.maxDelay = parseFloat(document.getElementById('maxDelay').value)||12;
  localStorage.setItem('nova_sendCount',state.sendCount);
  localStorage.setItem('nova_minDelay',state.minDelay);
  localStorage.setItem('nova_maxDelay',state.maxDelay);

  state.running = true;
  state.stopped = false;
  const total = channels.length * count;
  let sent = 0;

  document.getElementById('startBtn').disabled = true;
  document.getElementById('stopBtn').disabled = false;
  document.getElementById('statusText2').textContent = 'Running (anti-detect)';
  document.getElementById('statusText2').style.color = '#43b581';
  document.getElementById('totalCount').textContent = total;
  document.getElementById('sentCount').textContent = '0';
  document.getElementById('progressFill').style.width = '0%';

  showToast('Started — anti-detection active','success');

  for(let i=0; i<count; i++){
    if(state.stopped) break;

    // Shuffle channel order each cycle (looks random)
    const shuffled = shuffle([...channels]);

    for(let j=0; j<shuffled.length; j++){
      if(state.stopped) break;
      const chId = shuffled[j];

      try {
        // Anti-detection: use minDelay as base (higher than before)
        const delay = rand(minDelay, maxDelay);
        document.getElementById('statusText2').textContent = 'Wait '+(delay/1000).toFixed(1)+'s...';
        await sleep(delay);

        // Human typing simulation
        await Evasion.humanTyping(state.token, chId);
        document.getElementById('statusText2').textContent = 'Sending...';
        await API.sendMsg(state.token, chId, msg);
        sent++;
        document.getElementById('sentCount').textContent = sent;
        document.getElementById('progressFill').style.width = Math.round((sent/total)*100)+'%';
      } catch(e){
        showToast('Error: '+e.message,'error');
        await sleep(rand(3000,6000));
      }
    }

    // Anti-detection: random break between cycles
    if(i < count-1 && !state.stopped){
      await Evasion.maybeTakeBreak();
      if(!state.stopped){
        const cycleBreak = rand(8000, 20000);
        document.getElementById('statusText2').textContent = 'Cycle '+(i+1)+'/'+count+' — break '+(cycleBreak/1000).toFixed(0)+'s';
        await sleep(cycleBreak);
      }
    }
  }

  state.running = false;
  document.getElementById('startBtn').disabled = false;
  document.getElementById('stopBtn').disabled = true;
  if(state.stopped){
    document.getElementById('statusText2').textContent = 'Stopped';
    document.getElementById('statusText2').style.color = '#f04747';
    showToast('Stopped — '+sent+' messages sent','info');
  } else {
    document.getElementById('statusText2').textContent = 'Complete ✓';
    document.getElementById('statusText2').style.color = '#43b581';
    document.getElementById('progressFill').style.width = '100%';
    showToast('Complete — '+sent+' messages sent','success');
  }
}

function stopSending(){
  state.stopped = true;
  state.running = false;
  document.getElementById('startBtn').disabled = false;
  document.getElementById('stopBtn').disabled = true;
  showToast('Stopping...','warning');
}

// ─── DM Listener (Anti-Detect: 12-20s interval) ─────────────────────────
function startDMListener(){
  if(state.dmListenerInterval) clearInterval(state.dmListenerInterval);
  state.dmListenerInterval = setInterval(async ()=>{
    if(!state.token || !state.dmReply) return;
    try {
      const dms = await API.getDMs(state.token);
      for(const dm of dms){
        if(dm.type !== 1) continue;
        if(state.knownDMChannels.has(dm.id)) continue;
        state.knownDMChannels.add(dm.id);
        const msgs = await API.getChannelMsgs(state.token, dm.id, 1);
        if(msgs && msgs.length>0 && msgs[0].author.id !== state.user.id){
          // Humanized delay before replying
          await sleep(rand(4000, 10000));
          await API.sendMsg(state.token, dm.id, state.dmReply);
          showToast('Replied to DM from '+msgs[0].author.username,'success');
        }
      }
    } catch(_){}
  }, rand(12000, 20000)); // randomized interval
}

// ─── Friend Accepter (Anti-Detect: 10-18s interval) ─────────────────────
function startFriendAccepter(){
  if(state.friendAccepterInterval) clearInterval(state.friendAccepterInterval);
  state.friendAccepterInterval = setInterval(async ()=>{
    if(!state.token) return;
    try {
      const rels = await API.getFriendReqs(state.token);
      for(const rel of rels){
        if(rel.type === 3){ // incoming friend request
          await API.acceptFriendReq(state.token, rel.id);
          showToast('Accepted friend: '+rel.user.username,'success');
          await sleep(rand(2000, 4000));
        }
      }
    } catch(_){}
  }, rand(10000, 18000)); // randomized interval
}

// ─── Event Listeners ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function(){

  // Login
  $('loginBtn').addEventListener('click', function(){
    const token = $('tokenInput').value.trim();
    if(token) login(token);
  });
  $('tokenInput').addEventListener('keydown', function(e){
    if(e.key === 'Enter') $('loginBtn').click();
  });

  // Invites
  $('addInviteBtn').addEventListener('click', function(){
    const val = $('inviteInput').value.trim();
    if(!val){ showToast('Enter an invite link','error'); return; }
    state.invites.push(val);
    localStorage.setItem('nova_invites', JSON.stringify(state.invites));
    $('inviteInput').value = '';
    renderInvites();
    showToast('Invite added','success');
  });
  $('inviteInput').addEventListener('keydown', function(e){
    if(e.key === 'Enter') $('addInviteBtn').click();
  });
  $('joinServersBtn').addEventListener('click', joinAllServers);

  // Messages
  $('addMsgBtn').addEventListener('click', function(){
    const val = $('autoMsgInput').value.trim();
    if(!val){ showToast('Enter a message','error'); return; }
    state.messages.push(val);
    localStorage.setItem('nova_automessages', JSON.stringify(state.messages));
    $('autoMsgInput').value = '';
    renderAutoMessages();
    showToast('Message added','success');
  });
  $('autoMsgInput').addEventListener('keydown', function(e){
    if(e.key === 'Enter' && e.ctrlKey) $('addMsgBtn').click();
  });

  // DM Reply
  $('saveDmReplyBtn').addEventListener('click', function(){
    const val = $('dmReplyInput').value.trim();
    state.dmReply = val;
    localStorage.setItem('nova_dmreply', val);
    document.getElementById('dmReplyStatus').textContent = val ? 'Active: "'+val.substring(0,30)+'..."' : 'Not set';
    showToast(val ? 'DM reply saved' : 'DM reply cleared','success');
  });

  // Select / Deselect all
  $('selectAllBtn').addEventListener('click', function(){
    document.querySelectorAll('#channelList input[type="checkbox"]').forEach(cb=>cb.checked=true);
  });
  $('deselectAllBtn').addEventListener('click', function(){
    document.querySelectorAll('#channelList input[type="checkbox"]').forEach(cb=>cb.checked=false);
  });

  // Start / Stop
  $('startBtn').addEventListener('click', startSending);
  $('stopBtn').addEventListener('click', stopSending);

  // Logout
  $('logoutBtn').addEventListener('click', logout);

  // Auto-login
  const savedToken = localStorage.getItem('nova_token');
  if(savedToken){
    $('tokenInput').value = savedToken;
    login(savedToken);
  }
});
