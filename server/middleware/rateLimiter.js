/**
 * محدد معدل الطلبات (Rate Limiting) للحماية من هجمات DoS / DDoS والتخمين
 */
const rateLimit = require('express-rate-limit');

// حماية واجهة المصادقة من هجمات القوة الغاشمة (Brute Force)
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 دقيقة
    max: 12, // أقصى حد 12 محاولة لكل عنوان IP
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        message: 'تم تجاوز عدد محاولات الدخول المسموح بها. يرجى المحاولة بعد 15 دقيقة.'
    }
});

// حماية واجهات API العامة
const apiLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 دقائق
    max: 150,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        message: 'تم تجاوز معدل الطلبات المسموح به.'
    }
});

// محدد معدل إشارات المقابس (Socket.io Signaling Flood Protection)
class SocketRateLimiter {
    constructor(maxEventsPerSec = 25) {
        this.maxEventsPerSec = maxEventsPerSec;
        this.socketCounters = new Map();
    }

    checkLimit(socketId) {
        const now = Date.now();
        const record = this.socketCounters.get(socketId) || { count: 0, resetTime: now + 1000 };

        if (now > record.resetTime) {
            record.count = 1;
            record.resetTime = now + 1000;
            this.socketCounters.set(socketId, record);
            return true;
        }

        record.count += 1;
        this.socketCounters.set(socketId, record);

        if (record.count > this.maxEventsPerSec) {
            return false; // تجاوز الحد المسموح
        }

        return true;
    }

    cleanSocket(socketId) {
        this.socketCounters.delete(socketId);
    }
}

module.exports = {
    authLimiter,
    apiLimiter,
    socketRateLimiter: new SocketRateLimiter(30)
};
