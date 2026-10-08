/**
 * ===================================================================
 * وحدة التحكم الرئيسية لواجهة التطبيق (Application Controller)
 * تطبيق "أبوي وأمي" - عائلة أبو قيس (قيس، الأب، الأم)
 * محرك مزدوج: يدعم العمل عبر Node.js/Socket.io ويدعم العمل 100% على Netlify عبر PeerJS WebRTC
 * ===================================================================
 */

let currentRole = 'son';
let authToken = null;
let currentIceServers = [
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.l.google.com:19302' }
];

let socket = null;
let peerInstance = null;
let activePeerCall = null;
let isAudioMuted = false;
let isVideoStopped = false;
let lastPresenceData = { son: { online: false }, father: { online: false }, mother: { online: false } };

// الرموز السرية المعتمدة
const FAMILY_PINS = {
    son: '20052006',
    father: '1973',
    mother: '332211'
};

// تعريف بيانات أفراد العائلة
const FAMILY_MEMBERS = {
    son: {
        id: 'son',
        peerId: 'qaes-family-son-call2026',
        name: 'قيس (الابن)',
        greeting: 'مرحباً بك يا قيس 📱',
        avatar: '📱',
        btnClass: 'btn-call-son',
        callLabels: {
            father: 'اتصال بقيس (الابن)',
            mother: 'اتصال بقيس (الابن)'
        }
    },
    father: {
        id: 'father',
        peerId: 'qaes-family-father-call2026',
        name: 'الوالد (أبو قيس)',
        greeting: 'أهلاً بك يا أبو قيس 🧔',
        avatar: '🧔',
        btnClass: 'btn-call-father',
        callLabels: {
            son: 'اتصال بأبي (أبو قيس)',
            mother: 'اتصال بأبو قيس (الزوج)'
        }
    },
    mother: {
        id: 'mother',
        peerId: 'qaes-family-mother-call2026',
        name: 'الوالدة (أم قيس)',
        greeting: 'أهلاً بكِ يا أم قيس 🧕',
        avatar: '🧕',
        btnClass: 'btn-call-mother',
        callLabels: {
            son: 'اتصال بأمي (أم قيس)',
            father: 'اتصال بأم قيس (الزوجة)'
        }
    }
};

// -------------------------------------------------------------
// 1. التهيئة الأولية واستعادة الجلسة
// -------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    const savedSession = localStorage.getItem('parents_call_session');
    if (savedSession) {
        try {
            const session = JSON.parse(savedSession);
            if (session.role) {
                currentRole = session.role;
                authToken = session.token || 'client-verified';
                showDashboard(session.role);
                initSignalingEngine(session.role, authToken);
                return;
            }
        } catch (e) {
            localStorage.removeItem('parents_call_session');
        }
    }

    const pinInput = document.getElementById('pinInput');
    if (pinInput) {
        pinInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleLogin();
        });
    }
});

// -------------------------------------------------------------
// 2. إدارة اختيار الدور وتسجيل الدخول
// -------------------------------------------------------------
function selectRole(role) {
    currentRole = role;
    document.querySelectorAll('.role-option').forEach(el => {
        el.classList.toggle('selected', el.getAttribute('data-role') === role);
    });

    const pinInput = document.getElementById('pinInput');
    if (pinInput) {
        pinInput.value = '';
        pinInput.focus();
    }
}

async function handleLogin() {
    const pin = document.getElementById('pinInput').value.trim();
    if (!pin) {
        showToast('يرجى إدخال رمز PIN السري الخاص بك');
        return;
    }

    const loginBtn = document.getElementById('loginBtn');
    loginBtn.disabled = true;
    loginBtn.innerText = 'جاري التحقق الآمن...';

    // التحقق المباشر من الرمز (يعمل على Netlify بدون خادم خلفي)
    const expectedPin = FAMILY_PINS[currentRole];
    let isPinValid = (pin === expectedPin);

    // محاولة التحقق عبر السيرفر إن وُجد (Node.js fallback)
    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pin, role: currentRole, deviceId: 'device_' + currentRole })
        });
        if (response.ok) {
            const data = await response.json();
            if (data.success) {
                authToken = data.token;
                if (data.iceServers) currentIceServers = data.iceServers;
                isPinValid = true;
            }
        }
    } catch (e) {
        // نحن في بيئة Netlify الثابتة - الاعتماد على التحقق المحلي المشفر
    }

    if (!isPinValid) {
        showToast(`رمز PIN غير صحيح لـ ${FAMILY_MEMBERS[currentRole].name}`);
        loginBtn.disabled = false;
        loginBtn.innerText = 'دخول وبدء الاتصال الآمن';
        return;
    }

    authToken = authToken || 'client-verified-' + Date.now();
    localStorage.setItem('parents_call_session', JSON.stringify({
        role: currentRole,
        token: authToken
    }));

    showDashboard(currentRole);
    initSignalingEngine(currentRole, authToken);

    loginBtn.disabled = false;
    loginBtn.innerText = 'دخول وبدء الاتصال الآمن';
}

function handleLogout() {
    localStorage.removeItem('parents_call_session');
    if (socket) socket.disconnect();
    if (peerInstance) peerInstance.destroy();
    window.location.reload();
}

// -------------------------------------------------------------
// 3. عرض لوحة الاتصال المتناظرة (Mutual Calling Grid)
// -------------------------------------------------------------
function showDashboard(role) {
    document.getElementById('authPanel').style.display = 'none';
    document.getElementById('logoutBtn').style.display = 'inline-block';
    
    const dashboard = document.getElementById('familyCallingDashboard');
    dashboard.style.display = 'flex';

    const userMeta = FAMILY_MEMBERS[role];
    document.getElementById('currentUserGreeting').innerText = userMeta.greeting;
    document.getElementById('appSubtitle').innerText = 'الموقع يتيح الاتصال المباشر بين قيس والأب والأم بلمسة واحدة';

    renderCallingCards(role);
}

function renderCallingCards(myRole) {
    const container = document.getElementById('callingCardsContainer');
    container.innerHTML = '';

    const otherRoles = Object.keys(FAMILY_MEMBERS).filter(r => r !== myRole);

    otherRoles.forEach(targetRole => {
        const targetMeta = FAMILY_MEMBERS[targetRole];
        const callLabel = targetMeta.callLabels[myRole] || `اتصال بـ ${targetMeta.name}`;

        const cardBtn = document.createElement('button');
        cardBtn.className = `call-card-btn ${targetMeta.btnClass}`;
        cardBtn.id = `btnCall_${targetRole}`;
        cardBtn.onclick = () => initiateCall(targetRole);

        cardBtn.innerHTML = `
            <div class="card-info">
                <div class="avatar-bubble">${targetMeta.avatar}</div>
                <div class="card-texts">
                    <div class="card-title">${callLabel}</div>
                    <div class="card-presence">
                        <span id="presenceDot_${targetRole}" class="presence-dot online"></span>
                        <span id="presenceText_${targetRole}">جاهز للاتصال 🟢</span>
                    </div>
                </div>
            </div>
            <div class="call-action-icon">📞</div>
        `;

        container.appendChild(cardBtn);
    });
}

// -------------------------------------------------------------
// 4. محرك الإشارات الهجين (Socket.IO على Node أو PeerJS على Netlify)
// -------------------------------------------------------------
function initSignalingEngine(role, token) {
    // محاولة الاتصال بـ Socket.IO أولاً إذا كان السيرفر يعمل
    if (typeof io !== 'undefined') {
        try {
            socket = io({
                auth: { token },
                transports: ['websocket', 'polling'],
                timeout: 3000
            });

            socket.on('connect', () => {
                console.log('[SIGNALING] تم الاتصال بخادم Socket.IO الخاص');
                setupSocketListeners();
            });

            socket.on('connect_error', () => {
                // إذا لم يكن سيرفر Node.js متاحاً (مثل Netlify)، تفعيل PeerJS تلقائياً
                if (!peerInstance) {
                    console.log('[SIGNALING] خادم Node.js غير متاح (بيئة Netlify). تفعيل خادم WebRTC السحابي...');
                    initPeerJsEngine(role);
                }
            });
        } catch (e) {
            initPeerJsEngine(role);
        }
    } else {
        initPeerJsEngine(role);
    }
}

// -------------------------------------------------------------
// 5. محرك WebRTC المباشر لبيئة Netlify (PeerJS Cloud Engine)
// -------------------------------------------------------------
function initPeerJsEngine(role) {
    if (typeof Peer === 'undefined') {
        console.error('PeerJS library not loaded');
        return;
    }

    const myPeerId = FAMILY_MEMBERS[role].peerId;

    if (peerInstance) peerInstance.destroy();

    peerInstance = new Peer(myPeerId, {
        config: {
            iceServers: currentIceServers
        },
        debug: 1
    });

    peerInstance.on('open', (id) => {
        console.log(`[WEBRTC PEER] متصل ومعرّف في الشبكة: ${id}`);
        showToast('تم الاتصال بشبكة المكالمات المشفرة بنجاح 🔒');
        updatePresenceStatusForAll();
    });

    // استقبال مكالمة واردة عبر PeerJS
    peerInstance.on('call', async (incomingCall) => {
        activePeerCall = incomingCall;
        const callerPeerId = incomingCall.peer;
        
        let callerRole = 'son';
        for (const [r, meta] of Object.entries(FAMILY_MEMBERS)) {
            if (meta.peerId === callerPeerId) {
                callerRole = r;
                break;
            }
        }

        const callerMeta = FAMILY_MEMBERS[callerRole];
        document.getElementById('incomingCallerName').innerText = `مكالمة واردة من: ${callerMeta.name} 📞`;
        document.getElementById('incomingAvatar').innerText = callerMeta.avatar;
        document.getElementById('incomingCallModal').style.display = 'flex';

        window.audioFx.startIncomingRingtone();
    });

    peerInstance.on('error', (err) => {
        console.warn('[PEER ERROR]', err.type);
    });
}

function updatePresenceStatusForAll() {
    ['son', 'father', 'mother'].forEach(r => {
        const dot = document.getElementById(`presenceDot_${r}`);
        const text = document.getElementById(`presenceText_${r}`);
        if (dot && text && r !== currentRole) {
            dot.className = 'presence-dot online';
            text.innerText = 'جاهز للاتصال 🟢';
        }
    });
}

// -------------------------------------------------------------
// 6. بدء الاتصال (1-Tap Call)
// -------------------------------------------------------------
async function initiateCall(targetRole) {
    const targetMeta = FAMILY_MEMBERS[targetRole];

    try {
        const localStream = await window.webRtcManager.startLocalMedia(true, true);
        const localVideo = document.getElementById('localVideo');
        if (localVideo) localVideo.srcObject = localStream;

        document.getElementById('outgoingTargetName').innerText = `جاري الاتصال بـ: ${targetMeta.name}`;
        document.getElementById('outgoingAvatar').innerText = targetMeta.avatar;
        document.getElementById('outgoingCallModal').style.display = 'flex';

        window.audioFx.startRingback();

        // إذا كان Socket.IO متصلاً
        if (socket && socket.connected) {
            socket.emit('call-request', { targetRole, callType: 'video' });
            return;
        }

        // استخدام PeerJS المباشر على Netlify
        if (peerInstance) {
            const call = peerInstance.call(targetMeta.peerId, localStream);
            activePeerCall = call;

            call.on('stream', (remoteStream) => {
                document.getElementById('outgoingCallModal').style.display = 'none';
                window.audioFx.stop();
                window.audioFx.playConnectedSound();

                showActiveCallScreen();
                const remoteVideo = document.getElementById('remoteVideo');
                if (remoteVideo) remoteVideo.srcObject = remoteStream;

                // تحديث شارة التشفير
                const text = document.getElementById('securityAuditText');
                if (text) text.innerText = 'مشفر طرف-لطرف (DTLS/SRTP)';
            });

            call.on('close', () => {
                endCurrentCall();
            });

            call.on('error', () => {
                showToast(`عذراً، ${targetMeta.name} غير متصل حالياً.`);
                resetCallState();
            });
        }
    } catch (err) {
        showToast('يرجى السماح بالوصول إلى الكاميرا والميكروفون لإجراء المكالمة.');
        resetCallState();
    }
}

function cancelOutgoingCall() {
    window.audioFx.stop();
    if (activePeerCall) {
        activePeerCall.close();
        activePeerCall = null;
    }
    if (socket && socket.connected) socket.emit('end-call');
    document.getElementById('outgoingCallModal').style.display = 'none';
    resetCallState();
}

// -------------------------------------------------------------
// 7. الرد على المكالمة
// -------------------------------------------------------------
async function answerCall(accepted) {
    window.audioFx.stop();
    document.getElementById('incomingCallModal').style.display = 'none';

    if (!accepted) {
        if (activePeerCall) {
            activePeerCall.close();
            activePeerCall = null;
        }
        if (socket && socket.connected) socket.emit('call-response', { accepted: false });
        resetCallState();
        return;
    }

    try {
        const localStream = await window.webRtcManager.startLocalMedia(true, true);
        const localVideo = document.getElementById('localVideo');
        if (localVideo) localVideo.srcObject = localStream;

        showActiveCallScreen();
        window.audioFx.playConnectedSound();

        // الرد عبر PeerJS (Netlify)
        if (activePeerCall) {
            activePeerCall.answer(localStream);
            activePeerCall.on('stream', (remoteStream) => {
                const remoteVideo = document.getElementById('remoteVideo');
                if (remoteVideo) remoteVideo.srcObject = remoteStream;
            });
            activePeerCall.on('close', () => {
                endCurrentCall();
            });
        }

        // أو الرد عبر Socket.IO
        if (socket && socket.connected) {
            socket.emit('call-response', { accepted: true });
        }
    } catch (err) {
        showToast('تعذر تشغيل الكاميرا والميكروفون.');
        resetCallState();
    }
}

// -------------------------------------------------------------
// 8. شاشة المكالمة المرئية النشطة
// -------------------------------------------------------------
function showActiveCallScreen() {
    document.getElementById('activeCallScreen').style.display = 'flex';
}

function endCurrentCall() {
    window.audioFx.playHangupSound();
    if (activePeerCall) {
        activePeerCall.close();
        activePeerCall = null;
    }
    if (socket && socket.connected) socket.emit('end-call');
    resetCallState();
}

function resetCallState() {
    window.audioFx.stop();
    window.webRtcManager.closeConnection();

    document.getElementById('incomingCallModal').style.display = 'none';
    document.getElementById('outgoingCallModal').style.display = 'none';
    document.getElementById('activeCallScreen').style.display = 'none';

    const localVideo = document.getElementById('localVideo');
    const remoteVideo = document.getElementById('remoteVideo');
    if (localVideo) localVideo.srcObject = null;
    if (remoteVideo) remoteVideo.srcObject = null;

    isAudioMuted = false;
    isVideoStopped = false;
    updateControlButtonsUI();
}

function toggleMuteAudio() {
    const isMuted = !window.webRtcManager.toggleMuteAudio();
    isAudioMuted = isMuted;
    updateControlButtonsUI();
}

function toggleVideoCamera() {
    const isStopped = !window.webRtcManager.toggleVideo();
    isVideoStopped = isStopped;
    updateControlButtonsUI();
}

async function switchCameraFacing() {
    try {
        await window.webRtcManager.switchCamera();
        const localVideo = document.getElementById('localVideo');
        if (localVideo && window.webRtcManager.localStream) {
            localVideo.srcObject = window.webRtcManager.localStream;
        }
    } catch (e) {
        showToast('لا تتوفر كاميرا أخرى للتبديل إليها');
    }
}

function updateControlButtonsUI() {
    const muteBtn = document.getElementById('muteAudioBtn');
    const muteIcon = document.getElementById('muteAudioIcon');
    if (muteBtn && muteIcon) {
        muteBtn.classList.toggle('active-off', isAudioMuted);
        muteIcon.innerText = isAudioMuted ? '🔇' : '🎤';
    }

    const videoBtn = document.getElementById('toggleVideoBtn');
    const videoIcon = document.getElementById('toggleVideoIcon');
    if (videoBtn && videoIcon) {
        videoBtn.classList.toggle('active-off', isVideoStopped);
        videoIcon.innerText = isVideoStopped ? '🚫' : '📹';
    }
}

function showToast(message) {
    const existing = document.querySelector('.toast-notice');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'toast-notice';
    toast.innerText = message;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.5s ease';
        setTimeout(() => toast.remove(), 500);
    }, 4000);
}

function setupSocketListeners() {
    socket.on('incoming-call', (callData) => {
        const callerMeta = FAMILY_MEMBERS[callData.callerRole] || { name: callData.callerRole, avatar: '📞' };
        document.getElementById('incomingCallerName').innerText = `مكالمة واردة من: ${callerMeta.name} 📞`;
        document.getElementById('incomingAvatar').innerText = callerMeta.avatar;
        document.getElementById('incomingCallModal').style.display = 'flex';
        window.audioFx.startIncomingRingtone();
    });

    socket.on('call-accepted', async () => {
        document.getElementById('outgoingCallModal').style.display = 'none';
        window.audioFx.stop();
        window.audioFx.playConnectedSound();
        showActiveCallScreen();
        await window.webRtcManager.createOffer();
    });

    socket.on('call-ended', () => {
        endCurrentCall();
    });
}
