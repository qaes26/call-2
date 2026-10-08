/**
 * مدير الجلسات والحالة العائلية (Family Session Manager)
 * يدير حالة الاتصال المباشر، التواجد، وحالة المكالمات النشطة
 */
const config = require('../config');

class SessionManager {
    constructor() {
        // خريطة المستخدمين المتصلين: role -> Map<socketId, sessionInfo>
        this.activeRoles = new Map();
        
        // جلسة المكالمة النشطة حالياً (للعائلة مكالمة نشطة واحدة في الوقت نفسه)
        this.currentCall = null;
    }

    /**
     * تسجيل اتصال جديد لمستخدم بعد التحقق من التوكن
     */
    registerUser(socketId, user) {
        const { role, deviceId } = user;
        if (!config.validRoles.includes(role)) {
            return false;
        }

        if (!this.activeRoles.has(role)) {
            this.activeRoles.set(role, new Map());
        }

        const roleSessions = this.activeRoles.get(role);
        roleSessions.set(socketId, {
            socketId,
            role,
            deviceId,
            connectedAt: Date.now()
        });

        return true;
    }

    /**
     * إزالة مستخدم عند قطع الاتصال
     */
    unregisterUser(socketId) {
        let removedRole = null;
        for (const [role, sessions] of this.activeRoles.entries()) {
            if (sessions.has(socketId)) {
                sessions.delete(socketId);
                removedRole = role;
                if (sessions.size === 0) {
                    this.activeRoles.delete(role);
                }
                break;
            }
        }

        // إذا كان المستخدم في مكالمة جارية، إنهاء المكالمة
        if (this.currentCall && (this.currentCall.callerSocket === socketId || this.currentCall.calleeSocket === socketId)) {
            const terminatedCall = { ...this.currentCall };
            this.currentCall = null;
            return { removedRole, terminatedCall };
        }

        return { removedRole, terminatedCall: null };
    }

    /**
     * التحقق مما إذا كان دور معين متصلاً بالإنترنت
     */
    isRoleOnline(role) {
        const sessions = this.activeRoles.get(role);
        return sessions && sessions.size > 0;
    }

    /**
     * الحصول على جميع مقابس اتصال دور معين
     */
    getSocketsForRole(role) {
        const sessions = this.activeRoles.get(role);
        if (!sessions) return [];
        return Array.from(sessions.keys());
    }

    /**
     * الحصول على تقرير حالة التواجد لجميع أفراد العائلة
     */
    getPresenceStatus() {
        const status = {};
        for (const role of config.validRoles) {
            status[role] = {
                online: this.isRoleOnline(role),
                nameAr: config.roleNamesAr[role],
                devicesCount: this.activeRoles.get(role)?.size || 0
            };
        }
        return status;
    }

    /**
     * بدء مكالمة جديدة
     */
    startCall(callerRole, calleeRole, callerSocket, calleeSocket, callType = 'video') {
        if (this.currentCall) {
            return { success: false, reason: 'خط العائلة مشغول بمكالمة أخرى حالياً' };
        }

        this.currentCall = {
            id: `call_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
            callerRole,
            calleeRole,
            callerSocket,
            calleeSocket,
            callType,
            startedAt: Date.now(),
            status: 'ringing' // ringing, connected, ended
        };

        return { success: true, call: this.currentCall };
    }

    /**
     * قبول المكالمة وتغيير حالتها إلى متصلة
     */
    acceptCall(socketId) {
        if (!this.currentCall || this.currentCall.calleeSocket !== socketId) {
            return false;
        }
        this.currentCall.status = 'connected';
        this.currentCall.connectedAt = Date.now();
        return true;
    }

    /**
     * إنهاء المكالمة الحالية
     */
    endCall(socketId) {
        if (!this.currentCall) {
            return null;
        }

        if (this.currentCall.callerSocket === socketId || this.currentCall.calleeSocket === socketId) {
            const endedCall = { ...this.currentCall };
            this.currentCall = null;
            return endedCall;
        }

        return null;
    }

    /**
     * جلب المكالمة النشطة حالياً
     */
    getCurrentCall() {
        return this.currentCall;
    }
}

module.exports = new SessionManager();
