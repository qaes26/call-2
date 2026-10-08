/**
 * خدمة توليد بيانات اعتماد TURN المؤقتة (Ephemeral Credentials)
 * متوافقة مع RFC 5766 و Coturn REST API
 * تمنع تسريب بيانات الدخول الثابتة وتضمن انتهاء صلاحية الجلسة تلقائياً
 */
const crypto = require('crypto');
const config = require('../config');

class TurnService {
    /**
     * توليد قائمة خوادم ICE (STUN/TURN) مؤمنة وموقوتة
     * @param {string} userId - معرّف المستخدم أو دوره
     * @param {number} ttlSeconds - صلاحية الاعتماد بالثواني (افتراضياً ساعة)
     * @returns {Array<RTCIceServer>}
     */
    static getIceServers(userId, ttlSeconds = 3600) {
        const iceServers = [];

        // 1. خوادم STUN الأساسية (مجانية ومفتوحة لاستكشاف العناوين الخارجية)
        const stunUrls = [
            config.stunServerUrl,
            'stun:stun.cloudflare.com:3478',
            'stun:stun.l.google.com:19302'
        ].filter(Boolean);

        iceServers.push({
            urls: Array.from(new Set(stunUrls))
        });

        // 2. خوادم TURN المشفرة والمحمية بمفاتيح مؤقتة (HMAC-SHA1)
        if (config.turnSharedSecret && (config.turnServerUrl || config.turnServerUrls.length > 0)) {
            const expiryTimestamp = Math.floor(Date.now() / 1000) + ttlSeconds;
            const sanitizedUserId = String(userId || 'family-member').replace(/[^a-zA-Z0-9_-]/g, '');
            const username = `${expiryTimestamp}:${sanitizedUserId}`;

            // توليد كلمة المرور بتشفير HMAC-SHA1 لمطابقة خادم Coturn
            const hmac = crypto.createHmac('sha1', config.turnSharedSecret);
            hmac.update(username);
            const credential = hmac.digest('base64');

            const turnUrls = [];
            if (config.turnServerUrl) {
                turnUrls.push(config.turnServerUrl);
            }
            if (config.turnServerUrls && config.turnServerUrls.length > 0) {
                turnUrls.push(...config.turnServerUrls);
            }

            iceServers.push({
                urls: turnUrls,
                username: username,
                credential: credential
            });
        }

        return iceServers;
    }
}

module.exports = TurnService;
