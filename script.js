var state = {
    token: null,
    user: null,
    channels: [],
    running: false,
    stopped: false
};

function $(id) { return document.getElementById(id); }

function showToast(msg, type) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'toast ' + (type || 'info');
    t.style.display = 'block';
    setTimeout(function(){ t.style.display = 'none'; }, 3000);
}

function rand(min, max) {
    return Math.random() * (max - min) + min;
}

function sleep(ms) {
    return new Promise(function(r){ setTimeout(r, ms); });
}

var API = {
    BASE: 'https://discord.com/api/v9',
    headers: function(t) {
        return {
            'Authorization': t || '',
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        };
    },
    request: async function(token, path, opts) {
        opts = opts || {};
        opts.headers = Object.assign({}, this.headers(token), opts.headers || {});
        var resp = await fetch(this.BASE + path, opts);
        var data = resp.status === 204 ? null : await resp.json();
        if (!resp.ok) throw new Error(data && data.message || 'HTTP ' + resp.status);
        return data;
    },
    getMe: function(t) { return API.request(t, '/users/@me'); },
    getGuilds: function(t) { return API.request(t, '/users/@me/guilds'); },
    getGuildChannels: function(t, g) { return API.request(t, '/guilds/' + g + '/channels'); },
    sendMessage: function(t, c, content) {
        return API.request(t, '/channels/' + c + '/messages', {
            method: 'POST',
            body: JSON.stringify({content: content, nonce: Date.now().toString(), tts: false, flags: 0})
        });
    },
    triggerTyping: function(t, c) {
        return API.request(t, '/channels/' + c + '/typing', { method: 'POST' });
    }
};

async function login(token) {
    try {
        state.user = await API.getMe(token);
        state.token = token;
        localStorage.setItem('nova_token', token);
        showToast('Logged in as ' + state.user.username, 'success');
        $('loginScreen').style.display = 'none';
        $('dashboard').style.display = 'block';
        $('statusDot').className = 'status-dot online';
        $('statusText').textContent = 'Connected';
        $('userTag').textContent = state.user.username + '#' + state.user.discriminator;
        await loadChannels();
    } catch(e) {
        showToast('Invalid token: ' + e.message, 'error');
    }
}

function logout() {
    state.token = null;
    state.user = null;
    state.running = false;
    state.stopped = true;
    localStorage.removeItem('nova_token');
    $('dashboard').style.display = 'none';
    $('loginScreen').style.display = 'flex';
    $('statusDot').className = 'status-dot offline';
    $('statusText').textContent = 'Disconnected';
    showToast('Logged out', 'info');
}

async function loadChannels() {
    if (!state.token) return;
    try {
        $('channelList').innerHTML = '<div class="empty-state" style="color:#888;">Loading channels...</div>';
        state.channels = [];
        var guilds = await API.getGuilds(state.token);
        for (var i = 0; i < guilds.length; i++) {
            var chs = await API.getGuildChannels(state.token, guilds[i].id);
            for (var j = 0; j < chs.length; j++) {
                if (chs[j].type === 0) {
                    state.channels.push({ id: chs[j].id, name: chs[j].name, guild: guilds[i].name });
                }
            }
        }
        renderChannels();
        showToast('Loaded ' + state.channels.length + ' text channels from ' + guilds.length + ' servers', 'success');
    } catch(e) {
        showToast('Failed to load channels: ' + e.message, 'error');
    }
}

function renderChannels() {
    var container = $('channelList');
    if (state.channels.length === 0) {
        container.innerHTML = '<div class="empty-state">No text channels found.</div>';
        return;
    }
    var html = '';
    for (var i = 0; i < state.channels.length; i++) {
        var c = state.channels[i];
        html += '<div class="channel-item">' +
            '<input type="checkbox" value="' + c.id + '" checked>' +
            '<span class="name">#' + c.name + '</span>' +
            '<span class="id">' + c.guild + '</span>' +
            '<span class="id">' + c.id + '</span>' +
            '</div>';
    }
    container.innerHTML = html;
}

function getSelectedChannels() {
    var checkboxes = document.querySelectorAll('#channelList input[type="checkbox"]:checked');
    var ids = [];
    for (var i = 0; i < checkboxes.length; i++) {
        ids.push(checkboxes[i].value);
    }
    return ids;
}

async function startSending() {
    if (state.running) return;

    var msg = $('messageInput').value.trim();
    if (!msg) { showToast('Enter a message to send', 'error'); return; }

    var channels = getSelectedChannels();
    if (channels.length === 0) { showToast('Select at least one channel', 'error'); return; }

    var count = parseInt($('sendCount').value) || 1;
    var minDelay = (parseFloat($('minDelay').value) || 3) * 1000;
    var maxDelay = (parseFloat($('maxDelay').value) || 8) * 1000;
    var showTyping = $('typingToggle').checked;

    if (minDelay >= maxDelay) { showToast('Max delay must be greater than min delay', 'error'); return; }

    state.running = true;
    state.stopped = false;

    var total = channels.length * count;
    var sent = 0;

    $('startBtn').disabled = true;
    $('stopBtn').disabled = false;
    $('statusText2').textContent = 'Running';
    $('statusText2').style.color = '#43b581';
    $('totalCount').textContent = total;
    $('sentCount').textContent = '0';
    $('progressFill').style.width = '0%';

    showToast('Started sending to ' + channels.length + ' channels', 'info');

    for (var i = 0; i < count; i++) {
        if (state.stopped) break;

        for (var j = 0; j < channels.length; j++) {
            if (state.stopped) break;
            var chId = channels[j];

            try {
                // Humanized: random delay before typing
                var delay = rand(minDelay, maxDelay);
                $('statusText2').textContent = 'Waiting ' + (delay/1000).toFixed(1) + 's...';
                await sleep(delay);

                // Show typing indicator
                if (showTyping) {
                    $('statusText2').textContent = 'Typing in channel...';
                    await API.triggerTyping(state.token, chId);
                    await sleep(rand(1500, 3500)); // Type for 1.5-3.5 seconds
                }

                // Send the message
                $('statusText2').textContent = 'Sending...';
                await API.sendMessage(state.token, chId, msg);
                sent++;
                $('sentCount').textContent = sent;
                $('progressFill').style.width = Math.round((sent / total) * 100) + '%';

            } catch(e) {
                showToast('Error on channel ' + chId + ': ' + e.message, 'error');
                await sleep(2000);
            }
        }

        // Humanized: longer break between cycles
        if (i < count - 1 && !state.stopped) {
            var cycleBreak = rand(5000, 12000);
            $('statusText2').textContent = 'Cycle ' + (i+1) + '/' + count + ' — break ' + (cycleBreak/1000).toFixed(0) + 's';
            await sleep(cycleBreak);
        }
    }

    state.running = false;
    $('startBtn').disabled = false;
    $('stopBtn').disabled = true;

    if (state.stopped) {
        $('statusText2').textContent = 'Stopped';
        $('statusText2').style.color = '#f04747';
        showToast('Stopped — ' + sent + ' messages sent', 'info');
    } else {
        $('statusText2').textContent = 'Complete ✓';
        $('statusText2').style.color = '#43b581';
        $('progressFill').style.width = '100%';
        showToast('Complete — ' + sent + ' messages sent', 'success');
    }
}

function stopSending() {
    state.stopped = true;
    state.running = false;
    $('startBtn').disabled = false;
    $('stopBtn').disabled = true;
    showToast('Stopping...', 'warning');
}

// ─── Event Listeners ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
    // Login
    $('loginBtn').addEventListener('click', function() {
        var token = $('tokenInput').value.trim();
        if (token) login(token);
    });
    $('tokenInput').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') $('loginBtn').click();
    });

    // Load channels
    $('loadChannelsBtn').addEventListener('click', loadChannels);

    // Select / Deselect all
    $('selectAllBtn').addEventListener('click', function() {
        var cbs = document.querySelectorAll('#channelList input[type="checkbox"]');
        for (var i = 0; i < cbs.length; i++) cbs[i].checked = true;
    });
    $('deselectAllBtn').addEventListener('click', function() {
        var cbs = document.querySelectorAll('#channelList input[type="checkbox"]');
        for (var i = 0; i < cbs.length; i++) cbs[i].checked = false;
    });

    // Start / Stop
    $('startBtn').addEventListener('click', startSending);
    $('stopBtn').addEventListener('click', stopSending);

    // Logout
    $('logoutBtn').addEventListener('click', logout);

    // Auto-login if token saved
    var savedToken = localStorage.getItem('nova_token');
    if (savedToken) {
        $('tokenInput').value = savedToken;
        login(savedToken);
    }
});
