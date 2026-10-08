/**
 * تكوين النظام والأمان
 * System & Security Configuration
 */
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const config = {
    env: process.env.NODE_ENV || 'development',
    isProduction: process.env.NODE_ENV === 'production',
    port: parseInt(process.env.PORT, 10) || 3000,
    
    // رموز الأمان والمصادقة المخصصة لكل فرد في العائلة
    pins: {
        son: process.env.PIN_SON || '20052006',     // قيس (الابن)
        father: process.env.PIN_FATHER || '1973',    // الأب (الوالد)
        mother: process.env.PIN_MOTHER || '332211'   // الأم (الوالدة)
    },

    jwtSecret: process.env.JWT_SECRET || 'fallback_development_secret_only_change_me_in_prod',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '2h',
    allowedOrigin: process.env.ALLOWED_ORIGIN || '*',

    // إعدادات WebRTC STUN / TURN
    turnSharedSecret: process.env.TURN_SHARED_SECRET || '',
    stunServerUrl: process.env.STUN_SERVER_URL || 'stun:stun.cloudflare.com:3478',
    turnServerUrl: process.env.TURN_SERVER_URL || '',
    turnServerUrls: process.env.TURN_SERVER_URLS ? process.env.TURN_SERVER_URLS.split(',') : [],
    
    // الأدوار المسموح بها في النظام الأسري
    validRoles: ['son', 'father', 'mother'],
    roleNamesAr: {
        son: 'قيس (الابن)',
        father: 'الوالد (أبو قيس)',
        mother: 'الوالدة (أم قيس)'
    }
};

module.exports = config;
