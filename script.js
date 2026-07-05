// NOVA Selfbot - Full Application Logic
var state = {
    token: null,
    user: null,
    alts: JSON.parse(localStorage.getItem('nova_alts') || '[]'),
    invites: JSON.parse(localStorage.getItem('nova_invites') || '[]'),
    dmCache: JSON.parse(localStorage.getItem('nova_dm_cache') || '{}'),
    dmReplyEnabled: false,
    dmReplyMessage: "Hey! Thanks for reaching out. 🚀",
    dmPollInterval: null,
    dmSentCount: 0,
    spamRunning: false,
    channels: [],
    captchaKey: localStorage.getItem('nova_captcha_key') || '',
    pendingRegistration: null
};

function showToast(msg, type) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast ' + (type || 'info');
    t.style.display = 'block';
    setTimeout(function(){ t.style.display = 'none'; }, 3500);
}

var API = {
    BASE: 'https://discord.com/api/v9',
    headers: function(t) {
        return {
            'Authorization': t,
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
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
    getDMs: function(t) { return API.request(t, '/users/@me/channels'); },
    getRelationships: function(t) { return API.request(t, '/users/@me/relationships'); },
    getGuilds: function(t) { return API.request(t, '/users/@me/guilds'); },
    getGuildChannels: function(t, g) { return API.request(t, '/guilds/' + g + '/channels'); },
    sendMessage: function(t, c, content) {
        return API.request(t, '/channels/' + c + '/messages', {
            method: 'POST',
            body: JSON.stringify({content: content})
        });
    },
    resolveInvite: function(t, code) {
        return API.request(t, '/invites/' + code + '?with_counts=true&with_expiration=true');
    },
    joinInvite: function(t, code) {
        return API.request(t, '/invites/' + code, { method: 'POST' });
    },
    acceptFriendRequest: function(t, userId) {
        return API.request(t, '/users/@me/relationships', {
            method: 'PUT',
            body: JSON.stringify({id: userId, type: 1})
        });
    },
    getChannelMessages: function(t, c, limit) {
        return API.request(t, '/channels/' + c + '/messages?limit=' + (limit || 1));
    },
    registerAccount: function(email, password, username, dob, captchaKey) {
        return fetch(this.BASE + '/auth/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0'
            },
            body: JSON.stringify({
                email: email,
                password: password,
                username: username,
                date_of_birth: dob,
                consent: true,
                gift_code_sku_id: null,
                captcha_key: captchaKey
            })
        }).then(function(r){ return r.json(); });
    }
};

function saveAlts() { localStorage.setItem('nova_alts', JSON.stringify(state.alts)); }
function saveInvites() { localStorage.setItem('nova_invites', JSON.stringify(state.invites)); }
function saveDmCache() { localStorage.setItem('nova_dm_cache', JSON.stringify(state.dmCache)); }

function renderAltSelect() {
    var sel = document.getElementById('altSelect');
    sel.innerHTML = '<option value="">\u2014 Login with saved alt \u2014</option>';
    for (var i = 0; i < state.alts.length; i++) {
        var a = state.alts[i];
        if (a.token) {
            var opt = document.createElement('option');
            opt.value = a.token;
            opt.textContent = (a.email || a.username || 'Alt') + ' \uD83D\uDD11';
            sel.appendChild(opt);
        }
    }
}

function renderAltsList() {
    var container = document.getElementById('altListContainer');
    if (state.alts.length === 0) {
        container.innerHTML = '<div class="empty-state">No alt accounts saved yet.</div>';
        return;
    }
    var html = '';
    for (var i = 0; i < state.alts.length; i++) {
        var a = state.alts[i];
        html += '<div class="alt-account-item"><div class="info"><span class="email">' + (a.email || 'No email') + '</span><span class="meta">' + (a.username || '?') + ' \u2022 ' + (a.token ? '\u2705 token' : '\u274C no token') + '</span></div><div class="actions"><span class="status-tag ' + (a.token ? 'ready' : 'pending') + '">' + (a.token ? 'Ready' : 'No Token') + '</span><span class="del" data-index="' + i + '" style="color:#e05555;cursor:pointer;">\u2715</span></div></div>';
    }
    container.innerHTML = html;
    var dels = container.querySelectorAll('.del');
    for (var j = 0; j < dels.length; j++) {
        (function(idx) {
            dels[j].addEventListener('click', function() {
                state.alts.splice(idx, 1);
                saveAlts();
                renderAltsList();
                renderAltSelect();
                showToast('Alt removed', 'info');
            });
        })(parseInt(dels[j].dataset.index));
    }
}

function renderInvites() {
    var container = document.getElementById('inviteListContainer');
    if (state.invites.length === 0) {
        container.innerHTML = '<div class="empty-state">No invites added yet.</div>';
        return;
    }
    var html = '';
    for (var i = 0; i < state.invites.length; i++) {
        var code = state.invites[i].includes('/') ? state.invites[i].split('/').pop() : state.invites[i];
        html += '<div class="invite-item"><span class="code">discord.gg/' + code + '</span><span class="del" data-index="' + i + '" style="color:#e05555;cursor:pointer;">\u2715</span></div>';
    }
    container.innerHTML = html;
    var dels = container.querySelectorAll('.del');
    for (var j = 0; j < dels.length; j++) {
        (function(idx) {
            dels[j].addEventListener('click', function() {
                state.invites.splice(idx, 1);
                saveInvites();
                renderInvites();
                showToast('Invite removed', 'info');
            });
        })(parseInt(dels[j].dataset.index));
    }
}

function initAltTabs() {
    var tabs = document.querySelectorAll('.alt-tab');
    for (var i = 0; i < tabs.length; i++) {
        tabs[i].addEventListener('click', function() {
            var allTabs = document.querySelectorAll('.alt-tab');
            for (var j = 0; j < allTabs.length; j++) allTabs[j].classList.remove('active');
            var allSects = document.querySelectorAll('.alt-section');
            for (var k = 0; k < allSects.length; k++) allSects[k].classList.remove('active');
            this.classList.add('active');
            var target = document.getElementById(this.dataset.tab);
            if (target) target.classList.add('active');
        });
    }
}

async function solveCaptchaWith2Captcha(apiKey) {
    var submitResp = await fetch('https://2captcha.com/in.php?key=' + apiKey + '&method=hcaptcha&sitekey=4c672d35-0701-42b2-9e87-5c4d3a1e3e0c&pageurl=' + encodeURIComponent('https://discord.com/register') + '&json=1');
    var submitData = await submitResp.json();
    if (submitData.status !== 1) throw new Error('2captcha submit failed: ' + JSON.stringify(submitData));
    var taskId = submitData.request;
    for (var i = 0; i < 60; i++) {
        await new Promise(function(r){ setTimeout(r, 5000); });
        var resultResp = await fetch('https://2captcha.com/res.php?key=' + apiKey + '&action=get&id=' + taskId + '&json=1');
        var resultData = await resultResp.json();
        if (resultData.status === 1) return resultData.request;
        if (resultData.request && resultData.request !== 'CAPCHA_NOT_READY') throw new Error('2captcha: ' + resultData.request);
    }
    throw new Error('Captcha solving timed out');
}

async function finishRegistration() {
    if (!state.pendingRegistration) { showToast('No pending registration', 'error'); return; }
    var reg = state.pendingRegistration;
    var captchaKey;
    if (reg.apiKey) {
        showToast('Solving captcha via 2Captcha...', 'info');
        try {
            captchaKey = await solveCaptchaWith2Captcha(reg.apiKey);
            showToast('Captcha solved!', 'success');
        } catch(e) {
            showToast('2Captcha failed: ' + e.message, 'error');
            document.getElementById('captchaOverlay').classList.remove('active');
            state.pendingRegistration = null;
            return;
        }
    } else {
        captchaKey = prompt('Enter hCaptcha token (open console, type: hcaptcha.getResponse() and paste):');
        if (!captchaKey) { showToast('Captcha token required', 'error'); return; }
    }
    try {
        showToast('Registering account...', 'info');
        var result = await API.registerAccount(reg.email, reg.password, reg.username, reg.dob, captchaKey);
        if (result.token) {
            state.alts.push({
                email: reg.email,
                password: reg.password,
                username: reg.username,
                dob: reg.dob,
                token: result.token,
                created: new Date().toISOString()
            });
            saveAlts();
            renderAltsList();
            renderAltSelect();
            showToast('Account created: ' + reg.username, 'success');
            document.getElementById('captchaOverlay').classList.remove('active');
            state.pendingRegistration = null;
        } else if (result.captcha_key) {
            showToast('Captcha error: ' + result.captcha_key.join(', '), 'error');
        } else {
            showToast('Registration failed: ' + JSON.stringify(result), 'error');
        }
    } catch(e) {
        showToast('Error: ' + e.message, 'error');
    }
}

async function login(token) {
    try {
        state.user = await API.getMe(token);
        state.token = token;
        showToast('Logged in as ' + state.user.username, 'success');
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('dashboard').style.display = 'block';
        document.getElementById('statusDot').className = 'status-dot online';
        document.getElementById('statusText').textContent = 'Connected';
        document.getElementById('userTag').textContent = state.user.username + '#' + state.user.discriminator;
        if (state.dmReplyEnabled) startDmPolling();
    } catch(e) {
        showToast('Invalid token: ' + e.message, 'error');
    }
}

function logout() {
    state.token = null;
    state.user = null;
    if (state.dmPollInterval) { clearInterval(state.dmPollInterval); state.dmPollInterval = null; }
    document.getElementById('dashboard').style.display = 'none';
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('statusDot').className = 'status-dot offline';
    document.getElementById('statusText').textContent = 'Disconnected';
    showToast('Logged out', 'info');
}

async function processDMs() {
    if (!state.token || !state.dmReplyEnabled) return;
    try {
        var rels = await API.getRelationships(state.token);
        for (var i = 0; i < rels.length; i++) {
            if (rels[i].type === 3) {
                try {
                    await API.acceptFriendRequest(state.token, rels[i].id);
                    showToast('Accepted friend', 'info');
                } catch(_){}
            }
        }
        var channels = await API.getDMs(state.token);
        for (var j = 0; j < channels.length; j++) {
            var ch = channels[j];
            if (ch.type !== 1) continue;
            var cacheKey = 'sent_' + ch.id;
            if (state.dmCache[cacheKey]) continue;
            var msgs = await API.getChannelMessages(state.token, ch.id, 1);
            if (msgs && msgs.length > 0 && msgs[0].author && msgs[0].author.id !== state.user.id) {
                try {
                    await API.sendMessage(state.token, ch.id, state.dmReplyMessage);
                    state.dmCache[cacheKey] = true;
                    state.dmSentCount++;
                    saveDmCache();
                    document.querySelector('#dmStats').textContent = '\uD83D\uDCCA ' + state.dmSentCount + ' messages sent';
                    showToast('Replied to ' + msgs[0].author.username, 'success');
                } catch(_){}
            }
        }
    } catch(_){}
}

function startDmPolling() {
    if (state.dmPollInterval) clearInterval(state.dmPollInterval);
    state.dmPollInterval = setInterval(processDMs, 5000);
    processDMs();
}

async function fetchChannels() {
    if (!state.token) return;
    try {
        var guilds = await API.getGuilds(state.token);
        state.channels = [];
        for (var i = 0; i < guilds.length; i++) {
            var chs = await API.getGuildChannels(state.token, guilds[i].id);
            for (var j = 0; j < chs.length; j++) {
                if (chs[j].type === 0) state.channels.push({
                    id: chs[j].id,
                    name: '#' + chs[j].name,
                    guildName: guilds[i].name
                });
            }
        }
        var container = document.getElementById('channelListContainer');
        if (state.channels.length === 0) {
            container.innerHTML = '<div class="empty-state">No text channels found.</div>';
            return;
        }
        var html = '';
        for (var k = 0; k < state.channels.length; k++) {
            var c = state.channels[k];
            html += '<div class="channel-item"><input type="checkbox" value="' + c.id + '"><span class="channel-name">' + c.guildName + ' / ' + c.name + '</span><span class="channel-id">' + c.id + '</span></div>';
        }
        container.innerHTML = html;
        showToast('Loaded ' + state.channels.length + ' channels', 'info');
    } catch(e) {
        showToast('Failed: ' + e.message, 'error');
    }
}

async function runSpammer() {
    if (state.spamRunning) {
        state.spamRunning = false;
        document.getElementById('spamStatus').textContent = 'Stopped';
        document.getElementById('spamStatus').className = 'count stopped';
        document.getElementById('spamToggle').classList.remove('active');
        showToast('Spammer stopped', 'info');
        return;
    }
    var msg = document.getElementById('spamMessage').value.trim();
    if (!msg) { showToast('Enter a message', 'error'); return; }
    var delay = parseInt(document.getElementById('spamDelay').value) || 1500;
    var count = parseInt(document.getElementById('spamCount').value) || 1;
    var checked = document.querySelectorAll('#channelListContainer input[type="checkbox"]:checked');
    if (checked.length === 0) { showToast('Select channels', 'error'); return; }
    state.spamRunning = true;
    document.getElementById('spamStatus').textContent = 'Running';
    document.getElementById('spamStatus').className = 'count running';
    document.getElementById('spamToggle').classList.add('active');
    var total = checked.length * count;
    var done = 0;
    for (var i = 0; i < checked.length; i++) {
        if (!state.spamRunning) break;
        var chId = checked[i].value;
        for (var r = 0; r < count; r++) {
            if (!state.spamRunning) break;
            try {
                await API.sendMessage(state.token, chId, msg);
                done++;
                document.getElementById('spamProgress').style.width = Math.round((done/total)*100) + '%';
            } catch(e) {
                showToast('Error sending', 'error');
            }
            await new Promise(function(rs){ setTimeout(rs, delay); });
        }
    }
    state.spamRunning = false;
    document.getElementById('spamStatus').textContent = 'Complete';
    document.getElementById('spamStatus').className = 'count';
    document.getElementById('spamToggle').classList.remove('active');
    showToast('Spam complete!', 'success');
}

async function checkTokens() {
    var container = document.getElementById('tokenCheckResults');
    container.innerHTML = '<div style="color:#888;">Checking...</div>';
    var tokens = [];
    for (var i = 0; i < state.alts.length; i++) {
        if (state.alts[i].token) tokens.push({ email: state.alts[i].email, token: state.alts[i].token });
    }
    if (tokens.length === 0) {
        container.innerHTML = '<div class="empty-state">No tokens to check.</div>';
        return;
    }
    var results = [];
    for (var j = 0; j < tokens.length; j++) {
        try {
            var user = await API.getMe(tokens[j].token);
            results.push('\u2705 ' + (tokens[j].email || user.username) + ' \u2014 ' + user.username + '#' + user.discriminator);
        } catch(e) {
            results.push('\u274C ' + (tokens[j].email || tokens[j].token.slice(0,20) + '...') + ' \u2014 Invalid');
        }
    }
    container.innerHTML = results.map(function(r){
        return '<div style="padding:2px 0;">' + r + '</div>';
    }).join('');
    showToast('Checked ' + results.length + ' tokens', 'info');
}

async function joinAllServers() {
    if (state.invites.length === 0) { showToast('No invites saved', 'error'); return; }
    var tokens = [];
    for (var i = 0; i < state.alts.length; i++) {
        if (state.alts[i].token) tokens.push(state.alts[i].token);
    }
    if (tokens.length === 0) { showToast('No alt tokens', 'error'); return; }
    var done = 0;
    for (var j = 0; j < state.invites.length; j++) {
        var code = state.invites[j].includes('/') ? state.invites[j].split('/').pop() : state.invites[j];
        for (var k = 0; k < tokens.length; k++) {
            try { await API.joinInvite(tokens[k], code); } catch(_) {}
            done++;
            await new Promise(function(rs){ setTimeout(rs, 1500); });
        }
    }
    showToast('Processed ' + done + ' joins', 'success');
}

function exportData() {
    var data = { alts: state.alts, invites: state.invites, dmCache: state.dmCache };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'nova_backup.json';
    a.click();
    showToast('Data exported', 'success');
}

document.addEventListener('DOMContentLoaded', function() {
    initAltTabs();

    document.getElementById('loginBtn').addEventListener('click', function() {
        var token = document.getElementById('tokenInput').value.trim() || document.getElementById('altSelect').value;
        if (token) login(token);
    });

    document.getElementById('logoutBtn').addEventListener('click', logout);

    document.getElementById('createAltBtn').addEventListener('click', function() {
        var email = document.getElementById('createEmail').value.trim();
        var password = document.getElementById('createPassword').value.trim();
        var username = document.getElementById('createUsername').value.trim();
        var dob = document.getElementById('createDob').value.trim();
        var apiKey = document.getElementById('createCaptchaKey').value.trim() || state.captchaKey;
        if (!email || !password || !username || !dob) {
            showToast('Fill all fields (email, password, username, birthday)', 'error');
            return;
        }
        if (apiKey) {
            showToast('Solving with 2Captcha...', 'info');
            (async function(){
                try {
                    var captchaKey = await solveCaptchaWith2Captcha(apiKey);
                    showToast('Captcha solved! Creating account...', 'success');
                    var result = await API.registerAccount(email, password, username, dob, captchaKey);
                    if (result.token) {
                        state.alts.push({
                            email: email,
                            password: password,
                            username: username,
                            dob: dob,
                            token: result.token,
                            created: new Date().toISOString()
                        });
                        saveAlts();
                        renderAltsList();
                        renderAltSelect();
                        showToast('Account created: ' + username, 'success');
                    } else {
                        showToast('Registration failed: ' + JSON.stringify(result), 'error');
                    }
                } catch(e) {
                    showToast('Error: ' + e.message, 'error');
                }
            })();
        } else {
            state.pendingRegistration = { email: email, password: password, username: username, dob: dob, apiKey: null };
            document.getElementById('captchaOverlay').classList.add('active');
            document.getElementById('captchaIframe').srcdoc = '<!DOCTYPE html><html><head><script src="https://hcaptcha.com/1/api.js" async defer></script><style>body{margin:0;display:flex;align-items:center;justify-content:center;height:100%;background:#0a0a10;}.h-captcha{transform:scale(0.88);transform-origin:center;}</style></head><body><div class="h-captcha" data-sitekey="4c672d35-0701-42b2-9e87-5c4d3a1e3e0c" data-theme="dark"></div></body></html>';
        }
    });

    document.getElementById('captchaCloseBtn').addEventListener('click', function() {
        document.getElementById('captchaOverlay').classList.remove('active');
        state.pendingRegistration = null;
    });

    document.getElementById('captchaVerifyBtn').addEventListener('click', finishRegistration);

    document.getElementById('importAltBtn').addEventListener('click', function() {
        var email = document.getElementById('importEmail').value.trim();
        var token = document.getElementById('importToken').value.trim();
        if (!email || !token) { showToast('Email and token required', 'error'); return; }
        state.alts.push({ email: email, password: '', username: '', dob: '', token: token });
        saveAlts();
        renderAltsList();
        renderAltSelect();
        showToast('Alt imported', 'success');
    });

    document.getElementById('clearAltsBtn').addEventListener('click', function() {
        if (confirm('Clear all alt accounts?')) {
            state.alts = [];
            saveAlts();
            renderAltsList();
            renderAltSelect();
            showToast('All alts cleared', 'info');
        }
    });

    document.getElementById('addInviteBtn').addEventListener('click', function() {
        var inv = document.getElementById('inviteInput').value.trim();
        if (!inv) { showToast('Enter invite code', 'error'); return; }
        state.invites.push(inv);
        saveInvites();
        renderInvites();
        document.getElementById('inviteInput').value = '';
        showToast('Invite added', 'success');
    });

    document.getElementById('joinAllBtn').addEventListener('click', joinAllServers);

    document.getElementById('dmToggle').addEventListener('click', function() {
        state.dmReplyEnabled = !state.dmReplyEnabled;
        document.getElementById('dmToggle').classList.toggle('active');
        state.dmReplyMessage = document.getElementById('dmReplyMessage').value.trim() || state.dmReplyMessage;
        if (state.dmReplyEnabled && state.token) {
            startDmPolling();
            showToast('DM auto-reply enabled', 'success');
        } else {
            if (state.dmPollInterval) {
                clearInterval(state.dmPollInterval);
                state.dmPollInterval = null;
            }
            showToast('DM auto-reply disabled', 'info');
        }
    });

    document.getElementById('fetchDMsBtn').addEventListener('click', processDMs);
    document.getElementById('fetchChannelsBtn').addEventListener('click', fetchChannels);
    document.getElementById('spamToggle').addEventListener('click', runSpammer);
    document.getElementById('checkTokensBtn').addEventListener('click', checkTokens);

    document.getElementById('captchaKeyInput').value = state.captchaKey;
    document.getElementById('captchaKeyInput').addEventListener('change', function(e) {
        state.captchaKey = e.target.value;
        localStorage.setItem('nova_captcha_key', state.captchaKey);
    });

    document.getElementById('exportDataBtn').addEventListener('click', exportData);

    renderAltsList();
    renderInvites();
    renderAltSelect();
});
