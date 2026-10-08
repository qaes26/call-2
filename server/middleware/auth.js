/**
 * وحدة التحقق والمصادقة الأمنية (Authentication Middleware)
 * تستخدم رموز JWT قصيرة الأمد والمقارنة الآمنة زمنياً (Timing-safe comparison)
 * تدعم الرمز المخصص لكل فرد في العائلة (قيس، الأب، الأم)
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');

class AuthMiddleware {
    /**
     * مقارنة آمنة للرمز السري الخاص بالدور المختار تمنع هجمات التحليل الزمني (Timing Attacks)
     */
    static verifyPin(role, providedPin) {
        if (typeof providedPin !== 'string' || !role) return false;
        
        const expectedPin = config.pins[role];
        if (!expectedPin) return false;

        const pinBuffer = Buffer.from(providedPin);
        const secretBuffer = Buffer.from(expectedPin);

        if (pinBuffer.length !== secretBuffer.length) {
            // تنفيذ مقارنة وهمية للحفاظ على ثبات الوقت الزمني
            crypto.timingSafeEqual(pinBuffer, pinBuffer);
            return false;
        }

        return crypto.timingSafeEqual(pinBuffer, secretBuffer);
    }

    /**
     * توليد رمز JWT قصير الأمد ومحصن
     */
    static generateToken(role, deviceId) {
        if (!config.validRoles.includes(role)) {
            throw new Error('دور غير صالح');
        }

        const payload = {
            role,
            deviceId: String(deviceId || 'unknown_device').substring(0, 64),
            jti: crypto.randomBytes(16).toString('hex') // Unique token identifier
        };

        return jwt.sign(payload, config.jwtSecret, {
            expiresIn: config.jwtExpiresIn,
            algorithm: 'HS256'
        });
    }

    /**
     * التحقق من الرمز في طلبات HTTP API
     */
    static authenticateHttp(req, res, next) {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.startsWith('Bearer ') 
            ? authHeader.substring(7) 
            : req.query.token;

        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'غير مصرح: رمز الدخول مفقود'
            });
        }

        try {
            const decoded = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
            req.user = decoded;
            next();
        } catch (error) {
            return res.status(403).json({
                success: false,
                message: 'غير مصرح: رمز الجلسة منتهي أو غير صالح'
            });
        }
    }

    /**
     * التحقق من الرمز في مصافحة Socket.io (Handshake Middleware)
     */
    static authenticateSocket(socket, next) {
        const token = socket.handshake.auth?.token || socket.handshake.query?.token;

        if (!token) {
            const err = new Error('UNAUTHORIZED_MISSING_TOKEN');
            err.data = { message: 'رمز الأمان مفقود' };
            return next(err);
        }

        try {
            const decoded = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
            if (!config.validRoles.includes(decoded.role)) {
                return next(new Error('INVALID_ROLE'));
            }

            socket.data.user = decoded;
            next();
        } catch (error) {
            const err = new Error('UNAUTHORIZED_EXPIRED_OR_INVALID');
            err.data = { message: 'انتهت صلاحية الجلسة أو الرمز غير صالح' };
            return next(err);
        }
    }
}

module.exports = AuthMiddleware;
