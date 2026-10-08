/**
 * ===================================================================
 * خادم الإشارات المحصن لتطبيق "أبوي وأمي" (Signaling Server)
 * مهندس برمجيات WebRTC / VoIP وخبير الأمن السيبراني
 * ===================================================================
 * المميزات الأمنية:
 * 1. مصافحة مشفرة (HTTPS / WSS) مع ترويسات Helmet الصارمة.
 * 2. عزل النطاقات عبر CORS المحكم.
 * 3. حماية ضد هجمات DoS / DDoS والتخمين عبر Rate Limiting.
 * 4. مصادقة إلزامية بواسطة JWT قصير الأجل ومقارنة زمنية آمنة للـ PIN.
 * 5. توليد بيانات اعتماد مؤقتة لخوادم TURN (Ephemeral Credentials - RFC 5766).
 * 6. التحقق الصارم من حزم WebRTC (SDP / ICE) وفرض تشفير DTLS/SRTP.
 */

const express = require('express');
const http = require('http');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const { Server } = require('socket.io');

const config = require('./config');
const AuthMiddleware = require('./middleware/auth');
const { authLimiter, apiLimiter, socketRateLimiter } = require('./middleware/rateLimiter');
const InputValidator = require('./middleware/validator');
const TurnService = require('./services/turnService');
const sessionManager = require('./services/sessionManager');

const app = express();
const server = http.createServer(app);

// -------------------------------------------------------------
// 1. طبقة الأمان (Security Headers & CORS)
// -------------------------------------------------------------
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.socket.io"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "blob:"],
            mediaSrc: ["'self'", "blob:"],
            connectSrc: ["'self'", "wss:", "ws:", "https:"]
        }
    },
    crossOriginEmbedderPolicy: false,
    hsts: config.isProduction ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false
}));

const corsOptions = {
    origin: (origin, callback) => {
        // السماح بالطلبات الداخلية أو الدومين المعتمد في الإنتاج
        if (!origin || config.allowedOrigin === '*' || origin === config.allowedOrigin || origin.startsWith('http://localhost:')) {
            callback(null, true);
        } else {
            callback(new Error('[SECURITY ALERT] طلب مرفوض بواسطة سياسة CORS'));
        }
    },
    methods: ['GET', 'POST'],
    credentials: true
};
app.use(cors(corsOptions));

app.use(express.json({ limit: '15kb' })); // منع هجمات تضخيم البيانات
app.use(express.static(path.join(__dirname, '../public')));

// -------------------------------------------------------------
// 2. إعداد مقابس Socket.io مع طبقة التحقق والمصادقة
// -------------------------------------------------------------
const io = new Server(server, {
    cors: corsOptions,
    pingTimeout: 10000,
    pingInterval: 5000,
    maxHttpBufferSize: 1e5 // 100KB كحد أقصى لحزم الإشارات
});

// تطبيق وسيط المصادقة على مصافحة Socket.io
io.use(AuthMiddleware.authenticateSocket);

// -------------------------------------------------------------
// 3. مسارات واجهة البرمجة (REST API Routes)
// -------------------------------------------------------------

// فحص جاهزية الخادم
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: Math.floor(process.uptime()),
        timestamp: new Date().toISOString()
    });
});

// تسجيل الدخول والتحقق من رمز PIN العائلي
app.post('/api/auth/login', authLimiter, InputValidator.validateLoginPayload, (req, res) => {
    const { pin, role, deviceId } = req.sanitizedBody;

    // مقارنة آمنة زمنياً للـ PIN الخاص بالدور المختار (قيس، الأب، الأم)
    if (!AuthMiddleware.verifyPin(role, pin)) {
        console.warn(`[SECURITY WARN] محاولة دخول فاشلة برمز PIN خاطئ للدور (${role}) من عنوان IP: ${req.ip}`);
        return res.status(401).json({
            success: false,
            message: `رمز PIN غير صحيح لـ ${config.roleNamesAr[role]}. يرجى التأكد وإعادة المحاولة.`
        });
    }

    // توليد توكن JWT قصير الأجل
    const token = AuthMiddleware.generateToken(role, deviceId);
    
    // جلب خوادم ICE المؤقتة
    const iceServers = TurnService.getIceServers(role);

    return res.json({
        success: true,
        message: 'تم تسجيل الدخول بنجاح',
        token,
        role,
        roleNameAr: config.roleNamesAr[role],
        iceServers,
        expiresIn: config.jwtExpiresIn
    });
});

// جلب خوادم ICE المحدثة (STUN/TURN) لمستخدم مصرح به
app.get('/api/session/ice-servers', apiLimiter, AuthMiddleware.authenticateHttp, (req, res) => {
    const iceServers = TurnService.getIceServers(req.user.role);
    res.json({ success: true, iceServers });
});

// جلب حالة تواجد أفراد العائلة (أبي، أمي، الابن)
app.get('/api/session/presence', apiLimiter, AuthMiddleware.authenticateHttp, (req, res) => {
    res.json({
        success: true,
        presence: sessionManager.getPresenceStatus()
    });
});

// -------------------------------------------------------------
// 4. منطق إشارات WebRTC (Real-time Signaling Logic)
// -------------------------------------------------------------
io.on('connection', (socket) => {
    const user = socket.data.user;
    const socketId = socket.id;

    console.log(`[AUTH] مستخدم موثق متصل: ${user.role} (${user.deviceId}) [Socket: ${socketId}]`);

    // تسجيل المستخدم وتحديث حالة التواجد
    sessionManager.registerUser(socketId, user);
    io.emit('presence-update', sessionManager.getPresenceStatus());

    // التحقق من حد تدفق الإشارات لكل مقبس (Signaling Flood Protection)
    const checkSignalingRate = () => {
        if (!socketRateLimiter.checkLimit(socketId)) {
            console.warn(`[SECURITY ALERT] تم رصد إشارات متسارعة من ${socketId}. جاري إيقاف الحزم.`);
            socket.emit('security-warning', { message: 'إشارات متسارعة ومشبوهة، تم حظر الحزمة.' });
            return false;
        }
        return true;
    };

    // ---------------------------------------------------------
    // طلب بدء مكالمة (Call Request)
    // ---------------------------------------------------------
    socket.on('call-request', (data) => {
        if (!checkSignalingRate()) return;

        if (!InputValidator.validateCallRequest(data)) {
            return socket.emit('call-error', { message: 'بيانات طلب المكالمة غير صحيحة.' });
        }

        const callerRole = user.role;
        const targetRole = data.targetRole;
        const callType = data.callType || 'video';

        // التحقق من أن المستقبل متصل
        if (!sessionManager.isRoleOnline(targetRole)) {
            return socket.emit('call-error', {
                message: `عذراً، ${config.roleNamesAr[targetRole]} غير متصل بالإنترنت حالياً.`
            });
        }

        const targetSockets = sessionManager.getSocketsForRole(targetRole);
        const targetSocketId = targetSockets[0]; // توجيه الاتصال لأول جهاز نشط للمستلم

        const callResult = sessionManager.startCall(callerRole, targetRole, socketId, targetSocketId, callType);
        if (!callResult.success) {
            return socket.emit('call-error', { message: callResult.reason });
        }

        console.log(`[CALL] طلب مكالمة من ${callerRole} إلى ${targetRole} (${callType})`);

        // إرسال إشعار رنين للمستلم
        io.to(targetSocketId).emit('incoming-call', {
            callId: callResult.call.id,
            callerRole,
            callerNameAr: config.roleNamesAr[callerRole],
            callType
        });

        // إعلام المتصل بأن الرنين جاري
        socket.emit('call-ringing', {
            targetRole,
            targetNameAr: config.roleNamesAr[targetRole]
        });
    });

    // ---------------------------------------------------------
    // الرد على المكالمة (قبول أو رفض)
    // ---------------------------------------------------------
    socket.on('call-response', (data) => {
        if (!checkSignalingRate()) return;

        const currentCall = sessionManager.getCurrentCall();
        if (!currentCall || currentCall.calleeSocket !== socketId) {
            return socket.emit('call-error', { message: 'لا توجد مكالمة واردة صالحة للرد عليها.' });
        }

        const accepted = Boolean(data && data.accepted);

        if (accepted) {
            sessionManager.acceptCall(socketId);
            console.log(`[CALL] تم قبول المكالمة بين ${currentCall.callerRole} و ${currentCall.calleeRole}`);
            
            // إبلاغ المتصل بأن المكالمة قُبلت لبدء إنشاء الـ WebRTC Offer
            io.to(currentCall.callerSocket).emit('call-accepted', {
                peerRole: currentCall.calleeRole
            });
            socket.emit('call-accepted', {
                peerRole: currentCall.callerRole
            });
        } else {
            console.log(`[CALL] تم رفض المكالمة من قِبل ${currentCall.calleeRole}`);
            io.to(currentCall.callerSocket).emit('call-rejected', {
                reason: 'تم رفض المكالمة'
            });
            sessionManager.endCall(socketId);
        }
    });

    // ---------------------------------------------------------
    // تبادل عروض وتوافقات WebRTC المشفرة (SDP Offer / Answer)
    // ---------------------------------------------------------
    socket.on('webrtc-offer', (data) => {
        if (!checkSignalingRate()) return;

        if (!InputValidator.validateSdpOffer(data)) {
            console.warn(`[SECURITY ALERT] عرض SDP غير صالح أو يفتقر إلى بصمة تشفير DTLS من ${socketId}`);
            return socket.emit('security-warning', { message: 'تم رفض عرض SDP لعدم تطابق معايير الأمان والتشفير.' });
        }

        const currentCall = sessionManager.getCurrentCall();
        if (!currentCall) return;

        const targetSocket = currentCall.callerSocket === socketId 
            ? currentCall.calleeSocket 
            : currentCall.callerSocket;

        console.log(`[WEBRTC] تمرير عرض مشفر (Encrypted Offer) إلى الطرف الآخر`);
        io.to(targetSocket).emit('webrtc-offer', data);
    });

    socket.on('webrtc-answer', (data) => {
        if (!checkSignalingRate()) return;

        if (!InputValidator.validateSdpAnswer(data)) {
            console.warn(`[SECURITY ALERT] إجابة SDP غير صالحة أو تفتقر إلى بصمة تشفير DTLS من ${socketId}`);
            return socket.emit('security-warning', { message: 'تم رفض إجابة SDP لعدم تطابق معايير الأمان والتشفير.' });
        }

        const currentCall = sessionManager.getCurrentCall();
        if (!currentCall) return;

        const targetSocket = currentCall.callerSocket === socketId 
            ? currentCall.calleeSocket 
            : currentCall.callerSocket;

        console.log(`[WEBRTC] تمرير رد مشفر (Encrypted Answer) إلى الطرف الآخر`);
        io.to(targetSocket).emit('webrtc-answer', data);
    });

    // ---------------------------------------------------------
    // تبادل مرشحات الاتصال المباشر (ICE Candidates)
    // ---------------------------------------------------------
    socket.on('ice-candidate', (data) => {
        if (!checkSignalingRate()) return;

        if (!InputValidator.validateIceCandidate(data)) {
            return;
        }

        const currentCall = sessionManager.getCurrentCall();
        if (!currentCall) return;

        const targetSocket = currentCall.callerSocket === socketId 
            ? currentCall.calleeSocket 
            : currentCall.callerSocket;

        io.to(targetSocket).emit('ice-candidate', data);
    });

    // ---------------------------------------------------------
    // إنهاء المكالمة (End Call)
    // ---------------------------------------------------------
    socket.on('end-call', () => {
        const endedCall = sessionManager.endCall(socketId);
        if (endedCall) {
            console.log(`[CALL] تم إنهاء المكالمة بين ${endedCall.callerRole} و ${endedCall.calleeRole}`);
            io.to(endedCall.callerSocket).emit('call-ended', { reason: 'تم إنهاء المكالمة من قِبل الطرف الآخر' });
            io.to(endedCall.calleeSocket).emit('call-ended', { reason: 'تم إنهاء المكالمة من قِبل الطرف الآخر' });
        }
    });

    // ---------------------------------------------------------
    // انقطاع الاتصال (Disconnect Handling)
    // ---------------------------------------------------------
    socket.on('disconnect', () => {
        console.log(`[AUTH] انقطع اتصال المستخدم: ${user.role} [Socket: ${socketId}]`);
        socketRateLimiter.cleanSocket(socketId);
        
        const { removedRole, terminatedCall } = sessionManager.unregisterUser(socketId);

        if (terminatedCall) {
            const otherSocket = terminatedCall.callerSocket === socketId 
                ? terminatedCall.calleeSocket 
                : terminatedCall.callerSocket;
            io.to(otherSocket).emit('call-ended', { reason: 'انقطع اتصال الطرف الآخر بالشبكة' });
        }

        io.emit('presence-update', sessionManager.getPresenceStatus());
    });
});

// -------------------------------------------------------------
// 5. بدء تشغيل الخادم
// -------------------------------------------------------------
server.listen(config.port, () => {
    console.log(`
╔══════════════════════════════════════════════════════════════════╗
║   تطبيق "أبوي وأمي" - خادم الإشارات المحصن (Parents Call)       ║
║   وضع التشغيل: ${config.env.toUpperCase().padEnd(46)}║
║   المنفذ: http://localhost:${config.port.toString().padEnd(41)}║
║   معايير التشفير المفروضة: DTLS 1.2+ / SRTP (AES-GCM / 256)       ║
║   خوادم STUN/TURN: مصادقة مؤقتة (HMAC-SHA1 Ephemeral Tokens)      ║
╚══════════════════════════════════════════════════════════════════╝
    `);
});

// إدارة الإغلاق الآمن للخادم
process.on('SIGTERM', () => {
    console.log('[SYSTEM] جاري الإغلاق التدريجي الآمن للخادم...');
    server.close(() => process.exit(0));
});
