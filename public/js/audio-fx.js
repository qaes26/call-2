/**
 * ===================================================================
 * نظام المؤثرات الصوتية ونغمات الرنين (Web Audio API Synthesizer)
 * يعمل بدون الحاجة لأي ملفات صوتية خارجية لتفادي أخطاء 404 أو الحظر
 * ===================================================================
 */

class AudioFx {
    constructor() {
        this.audioCtx = null;
        this.ringingInterval = null;
        this.isRinging = false;
    }

    init() {
        if (!this.audioCtx) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.audioCtx = new AudioContext();
        }
        if (this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }
    }

    /**
     * تشغيل نغمة جرس الاتصال الصادر (Outgoing Ringback Tone)
     */
    startRingback() {
        this.init();
        this.stop();
        this.isRinging = true;

        const playTone = () => {
            if (!this.isRinging) return;

            const now = this.audioCtx.currentTime;
            const osc1 = this.audioCtx.createOscillator();
            const osc2 = this.audioCtx.createOscillator();
            const gain = this.audioCtx.createGain();

            osc1.type = 'sine';
            osc1.frequency.setValueAtTime(440, now); // تردد 440 هرتز
            osc2.type = 'sine';
            osc2.frequency.setValueAtTime(480, now); // تردد 480 هرتز

            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(0.15, now + 0.1);
            gain.gain.setValueAtTime(0.15, now + 1.6);
            gain.gain.linearRampToValueAtTime(0, now + 1.8);

            osc1.connect(gain);
            osc2.connect(gain);
            gain.connect(this.audioCtx.destination);

            osc1.start(now);
            osc2.start(now);
            osc1.stop(now + 1.8);
            osc2.stop(now + 1.8);
        };

        playTone();
        this.ringingInterval = setInterval(playTone, 3500);
    }

    /**
     * تشغيل نغمة الرنين للمكالمة الواردة (Incoming Call Ringtone)
     * لحن هادئ وعالي وواضح مناسب للوالدين وكبار السن
     */
    startIncomingRingtone() {
        this.init();
        this.stop();
        this.isRinging = true;

        // تفعيل الاهتزاز في الهواتف الذكية
        if ('vibrate' in navigator) {
            try {
                navigator.vibrate([600, 300, 600, 300, 1000]);
            } catch (e) {
                console.warn('Vibration API not allowed yet');
            }
        }

        const melody = [
            { f: 523.25, d: 0.25 }, // C5
            { f: 659.25, d: 0.25 }, // E5
            { f: 783.99, d: 0.35 }, // G5
            { f: 1046.50, d: 0.50 }, // C6
            { f: 783.99, d: 0.25 },
            { f: 1046.50, d: 0.60 }
        ];

        const playMelody = () => {
            if (!this.isRinging) return;
            let timeOffset = this.audioCtx.currentTime;

            melody.forEach(note => {
                const osc = this.audioCtx.createOscillator();
                const gain = this.audioCtx.createGain();

                osc.type = 'triangle';
                osc.frequency.setValueAtTime(note.f, timeOffset);

                gain.gain.setValueAtTime(0, timeOffset);
                gain.gain.linearRampToValueAtTime(0.3, timeOffset + 0.05);
                gain.gain.exponentialRampToValueAtTime(0.001, timeOffset + note.d);

                osc.connect(gain);
                gain.connect(this.audioCtx.destination);

                osc.start(timeOffset);
                osc.stop(timeOffset + note.d);

                timeOffset += note.d + 0.05;
            });

            // تكرار الاهتزاز
            if ('vibrate' in navigator) {
                try {
                    navigator.vibrate([500, 300, 500]);
                } catch (e) {}
            }
        };

        playMelody();
        this.ringingInterval = setInterval(playMelody, 2800);
    }

    /**
     * صوت نجاح تأسيس المكالمة (Connected Chime)
     */
    playConnectedSound() {
        this.init();
        this.stop();

        const now = this.audioCtx.currentTime;
        const notes = [587.33, 880]; // D5, A5
        notes.forEach((freq, i) => {
            const osc = this.audioCtx.createOscillator();
            const gain = this.audioCtx.createGain();
            const t = now + (i * 0.15);

            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, t);

            gain.gain.setValueAtTime(0, t);
            gain.gain.linearRampToValueAtTime(0.2, t + 0.03);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);

            osc.connect(gain);
            gain.connect(this.audioCtx.destination);

            osc.start(t);
            osc.stop(t + 0.3);
        });
    }

    /**
     * صوت إنهاء المكالمة (Hangup Tone)
     */
    playHangupSound() {
        this.init();
        this.stop();

        const now = this.audioCtx.currentTime;
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(320, now);
        osc.frequency.linearRampToValueAtTime(160, now + 0.35);

        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

        osc.connect(gain);
        gain.connect(this.audioCtx.destination);

        osc.start(now);
        osc.stop(now + 0.35);
    }

    /**
     * إيقاف أي رنين جاري
     */
    stop() {
        this.isRinging = false;
        if (this.ringingInterval) {
            clearInterval(this.ringingInterval);
            this.ringingInterval = null;
        }
        if ('vibrate' in navigator) {
            try {
                navigator.vibrate(0); // إيقاف الاهتزاز
            } catch (e) {}
        }
    }
}

window.audioFx = new AudioFx();
