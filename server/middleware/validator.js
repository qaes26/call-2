/**
 * التحقق الصارم من المدخلات وسلامة بيانات الإشارات (Signaling Input Validator)
 * يمنع هجمات الحقن (Injection Attacks) وتمرير كائنات مشوهة (Malformed SDP/ICE)
 */
const validator = require('validator');
const config = require('../config');

class InputValidator {
    /**
     * التحقق من طلب تسجيل الدخول (PIN & Role)
     */
    static validateLoginPayload(req, res, next) {
        const { pin, role, deviceId } = req.body;

        if (!pin || typeof pin !== 'string') {
            return res.status(400).json({ success: false, message: 'رمز PIN مطلوب' });
        }

        if (pin.length < 4 || pin.length > 32) {
            return res.status(400).json({ success: false, message: 'طول رمز PIN غير صحيح' });
        }

        if (!role || !config.validRoles.includes(role)) {
            return res.status(400).json({ success: false, message: 'الدور المحدد غير صالح' });
        }

        req.sanitizedBody = {
            pin: validator.trim(pin),
            role: validator.trim(role),
            deviceId: deviceId ? validator.trim(String(deviceId)).substring(0, 64) : 'web-device'
        };

        next();
    }

    /**
     * التحقق من صحة طلب بدء المكالمة
     */
    static validateCallRequest(payload) {
        if (!payload || typeof payload !== 'object') return false;
        const { targetRole, callType } = payload;
        
        if (!targetRole || !config.validRoles.includes(targetRole)) return false;
        if (callType && !['video', 'audio'].includes(callType)) return false;

        return true;
    }

    /**
     * التحقق من صحة عرض SDP (Offer) وفرض احتواءه على بصمة DTLS/SRTP
     */
    static validateSdpOffer(payload) {
        if (!payload || typeof payload !== 'object') return false;
        const { sdp, type } = payload;

        if (type !== 'offer') return false;
        if (typeof sdp !== 'string' || sdp.length < 50 || sdp.length > 100000) return false;

        // التحقق الإلزامي من وجود تشفير DTLS في الـ SDP (End-to-End Encryption Requirement)
        if (!sdp.includes('a=fingerprint:')) {
            console.warn('[SECURITY ALERT] مرفوض: العرض لا يحتوي على بصمة تشفير DTLS الإلزامية!');
            return false;
        }

        return true;
    }

    /**
     * التحقق من صحة إجابة SDP (Answer) وفرض احتواءها على بصمة DTLS/SRTP
     */
    static validateSdpAnswer(payload) {
        if (!payload || typeof payload !== 'object') return false;
        const { sdp, type } = payload;

        if (type !== 'answer') return false;
        if (typeof sdp !== 'string' || sdp.length < 50 || sdp.length > 100000) return false;

        // فرض تشفير DTLS
        if (!sdp.includes('a=fingerprint:')) {
            console.warn('[SECURITY ALERT] مرفوض: الرد لا يحتوي على بصمة تشفير DTLS الإلزامية!');
            return false;
        }

        return true;
    }

    /**
     * التحقق من صحة مرشح ICE (Candidate)
     */
    static validateIceCandidate(payload) {
        if (!payload || typeof payload !== 'object') return false;
        // في WebRTC، قد يكون المرشح فارغاً للإشارة إلى انتهاء البحث (End of candidates)
        if (payload.candidate === null || payload.candidate === '') return true;

        if (typeof payload.candidate !== 'string') return false;
        if (payload.candidate.length > 2000) return false;

        return true;
    }
}

module.exports = InputValidator;
