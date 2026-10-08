/**
 * ===================================================================
 * وحدة التحكم الرئيسية لواجهة التطبيق (Application Controller)
 * تطبيق "أبوي وأمي" - عائلة أبو قيس (قيس، الأب، الأم)
 * اتصال متبادل كامل بين جميع الأطراف مع شاشات وأزرار مبسطة
 * ===================================================================
 */

let currentRole = 'son';
let authToken = null;
let currentIceServers = [];
let socket = null;
let activeCallTarget = null;
let isAudioMuted = false;
let isVideoStopped = false;
let lastPresenceData = null;

// تعريف بيانات أفراد العائلة
const FAMILY_MEMBERS = {
    son: {
        id: 'son',
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
    // محاولة استعادة الجلسة المحفوظة مسبقاً لدخول سريع للوالدين بدون طلب الرمز كل مرة
    const savedSession = localStorage.getItem('parents_call_session');
    if (savedSession) {
        try {
            const session = JSON.parse(savedSession);
            if (session.token && session.role) {
                currentRole = session.role;
                authToken = session.token;
                currentIceServers = session.iceServers || [];
                showDashboard(session.role);
                connectSignalingSocket(session.token);
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

    let deviceId = localStorage.getItem('parents_call_device_id');
    if (!deviceId) {
        deviceId = 'dev_' + Math.random().toString(36).substring(2, 12);
        localStorage.setItem('parents_call_device_id', deviceId);
    }

    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pin, role: currentRole, deviceId })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            authToken = data.token;
            currentIceServers = data.iceServers;

            localStorage.setItem('parents_call_session', JSON.stringify({
                token: data.token,
                role: currentRole,
                iceServers: data.iceServers
            }));

            showDashboard(currentRole);
            connectSignalingSocket(authToken);
        } else {
            showToast(data.message || 'رمز PIN غير صحيح لهذا الحساب.');
        }
    } catch (err) {
        showToast('تعذر الاتصال بالخادم. يرجى التأكد من تشغيل الشبكة.');
    } finally {
        loginBtn.disabled = false;
        loginBtn.innerText = 'دخول وبدء الاتصال الآمن';
    }
}

function handleLogout() {
    localStorage.removeItem('parents_call_session');
    if (socket) socket.disconnect();
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

    // رسالة الترحيب بصاحب الجهاز
    const userMeta = FAMILY_MEMBERS[role];
    document.getElementById('currentUserGreeting').innerText = userMeta.greeting;
    document.getElementById('appSubtitle').innerText = 'الموقع يتيح الاتصال المباشر بين قيس والأب والأم بلمسة واحدة';

    // توليد بطاقتي الاتصال للطرفين الآخرين
    renderCallingCards(role);
}

function renderCallingCards(myRole) {
    const container = document.getElementById('callingCardsContainer');
    container.innerHTML = '';

    // تحديد الطرفين الآخرين
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
                        <span id="presenceDot_${targetRole}" class="presence-dot"></span>
                        <span id="presenceText_${targetRole}">جاري التحقق من التواجد...</span>
                    </div>
                </div>
            </div>
            <div class="call-action-icon">📞</div>
        `;

        container.appendChild(cardBtn);
    });

    if (lastPresenceData) {
        updatePresenceUI(lastPresenceData);
    }
}

// -------------------------------------------------------------
// 4. الاتصال بمقبس الإشارات المحصن (Socket.IO over WSS)
// -------------------------------------------------------------
function connectSignalingSocket(token) {
    socket = io({
        auth: { token },
        transports: ['websocket', 'polling']
    });

    window.webRtcManager.init(socket, currentIceServers);

    // ربط مدقق الأمان لعرض حالة التشفير الحقيقية
    window.webRtcManager.onSecurityStatusChange = (status) => {
        const badge = document.getElementById('securityAuditBadge');
        const text = document.getElementById('securityAuditText');
        if (badge && text) {
            text.innerText = `مشفر طرف-لطرف (${status.cipherSuite})`;
            badge.style.borderColor = 'rgba(34, 197, 94, 0.8)';
        }
    };

    // تحديث التواجد وحالة أفراد العائلة الحية
    socket.on('presence-update', (presence) => {
        lastPresenceData = presence;
        updatePresenceUI(presence);
    });

    // استقبال مكالمة واردة
    socket.on('incoming-call', (callData) => {
        handleIncomingCall(callData);
    });

    // رنين عند الطرف الآخر
    socket.on('call-ringing', () => {
        window.audioFx.startRingback();
    });

    // قبول المكالمة
    socket.on('call-accepted', async () => {
        document.getElementById('outgoingCallModal').style.display = 'none';
        window.audioFx.stop();
        window.audioFx.playConnectedSound();

        showActiveCallScreen();
        await window.webRtcManager.createOffer();
    });

    // رفض المكالمة
    socket.on('call-rejected', (data) => {
        document.getElementById('outgoingCallModal').style.display = 'none';
        window.audioFx.stop();
        window.audioFx.playHangupSound();
        showToast(data.reason || 'تم رفض المكالمة');
        resetCallState();
    });

    // تبادل إشارات WebRTC
    socket.on('webrtc-offer', async (offerData) => {
        await window.webRtcManager.handleOfferAndAnswer(offerData);
    });

    socket.on('webrtc-answer', async (answerData) => {
        await window.webRtcManager.handleAnswer(answerData);
    });

    socket.on('ice-candidate', async (candidateData) => {
        await window.webRtcManager.addIceCandidate(candidateData);
    });

    // انتهاء المكالمة
    socket.on('call-ended', (data) => {
        window.audioFx.playHangupSound();
        showToast(data.reason || 'انتهت المكالمة');
        resetCallState();
    });

    socket.on('call-error', (data) => {
        window.audioFx.stop();
        document.getElementById('outgoingCallModal').style.display = 'none';
        showToast(data.message || 'تعذر إجراء المكالمة');
        resetCallState();
    });

    socket.on('connect_error', (err) => {
        if (err.message && err.message.includes('UNAUTHORIZED')) {
            showToast('انتهت صلاحية الجلسة، يرجى إعادة إدخال رمز PIN');
            handleLogout();
        }
    });
}

// -------------------------------------------------------------
// 5. تحديث مؤشرات التواجد الحية
// -------------------------------------------------------------
function updatePresenceUI(presence) {
    if (!presence) return;

    ['son', 'father', 'mother'].forEach(role => {
        const dot = document.getElementById(`presenceDot_${role}`);
        const text = document.getElementById(`presenceText_${role}`);
        if (dot && text) {
            const isOnline = Boolean(presence[role]?.online);
            dot.className = isOnline ? 'presence-dot online' : 'presence-dot';
            text.innerText = isOnline ? 'متصل بالإنترنت الآن 🟢' : 'غير متصل حالياً ⚪';
        }
    });
}

// -------------------------------------------------------------
// 6. بدء الاتصال بلمسة واحدة (1-Tap Call)
// -------------------------------------------------------------
async function initiateCall(targetRole) {
    if (!socket || !socket.connected) {
        showToast('جاري إعادة الاتصال بالخادم...');
        return;
    }

    activeCallTarget = targetRole;
    const targetMeta = FAMILY_MEMBERS[targetRole];

    try {
        const localStream = await window.webRtcManager.startLocalMedia(true, true);
        const localVideo = document.getElementById('localVideo');
        if (localVideo) localVideo.srcObject = localStream;

        document.getElementById('outgoingTargetName').innerText = `جاري الاتصال بـ: ${targetMeta.name}`;
        document.getElementById('outgoingAvatar').innerText = targetMeta.avatar;
        document.getElementById('outgoingCallModal').style.display = 'flex';

        window.audioFx.startRingback();

        socket.emit('call-request', {
            targetRole,
            callType: 'video'
        });
    } catch (err) {
        showToast('يرجى السماح بالوصول إلى الكاميرا والميكروفون لإجراء المكالمة.');
        resetCallState();
    }
}

function cancelOutgoingCall() {
    window.audioFx.stop();
    if (socket) socket.emit('end-call');
    document.getElementById('outgoingCallModal').style.display = 'none';
    resetCallState();
}

// -------------------------------------------------------------
// 7. معالجة المكالمة الواردة
// -------------------------------------------------------------
function handleIncomingCall(callData) {
    const callerMeta = FAMILY_MEMBERS[callData.callerRole] || { name: callData.callerRole, avatar: '📞' };
    
    document.getElementById('incomingCallerName').innerText = `مكالمة واردة من: ${callerMeta.name} 📞`;
    document.getElementById('incomingAvatar').innerText = callerMeta.avatar;
    document.getElementById('incomingCallModal').style.display = 'flex';

    window.audioFx.startIncomingRingtone();
}

async function answerCall(accepted) {
    window.audioFx.stop();
    document.getElementById('incomingCallModal').style.display = 'none';

    if (!accepted) {
        if (socket) socket.emit('call-response', { accepted: false });
        resetCallState();
        return;
    }

    try {
        const localStream = await window.webRtcManager.startLocalMedia(true, true);
        const localVideo = document.getElementById('localVideo');
        if (localVideo) localVideo.srcObject = localStream;

        showActiveCallScreen();
        window.audioFx.playConnectedSound();

        if (socket) socket.emit('call-response', { accepted: true });
    } catch (err) {
        showToast('تعذر تشغيل الكاميرا والميكروفون.');
        if (socket) socket.emit('call-response', { accepted: false });
        resetCallState();
    }
}

// -------------------------------------------------------------
// 8. شاشة المكالمة المرئية النشطة
// -------------------------------------------------------------
function showActiveCallScreen() {
    document.getElementById('activeCallScreen').style.display = 'flex';
    const remoteVideo = document.getElementById('remoteVideo');
    if (remoteVideo && window.webRtcManager.remoteStream) {
        remoteVideo.srcObject = window.webRtcManager.remoteStream;
    }
}

function endCurrentCall() {
    if (socket) socket.emit('end-call');
    window.audioFx.playHangupSound();
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

    activeCallTarget = null;
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

// -------------------------------------------------------------
// 9. تنبيهات واجهة المستخدم (Toast Notifications)
// -------------------------------------------------------------
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
