# تطبيق "أبوي وأمي" (My Parents Call) - نظام اتصال صوتي ومرئي فائق الأمان

> **تطوير هندسي وأمني متخصص**: مهندس برمجيات WebRTC / VoIP وخبير أمن سيبراني (Cybersecurity Architect).  
> **الهدف الأساسي**: تمكين الوالدين من إجراء واستقبال مكالمات مرئية وصوتية فائقة الجودة بكبسة زر واحدة، مع تطبيق معايير التشفير الصارمة (Zero-Trust & DTLS-SRTP) لمنع أي تجسس أو اعتراض للبيانات (Man-in-the-Middle) بعد الرفع والاستضافة.

---

## 📑 المحتويات
1. [المعمارية الأمنية ونموذج الحماية (Security Architecture & Threat Model)](#1-المعمارية-الأمنية-ونموذج-الحماية)
2. [ميزات واجهة الوالدين وسهولة الاستخدام (Accessibility & UX)](#2-ميزات-واجهة-الوالدين)
3. [هيكلية المشروع البرمجية](#3-هيكلية-المشروع)
4. [التشغيل المحلي والاختبار السريع](#4-التشغيل-المحلي-والاختبار)
5. [دليل النشر والإنتاج الشامل (Production Deployment Checklist)](#5-دليل-النشر-والإنتاج-الشامل)
   - [إعداد جدار الحماية (UFW Firewall)](#أ-إعداد-جدار-الحماية-ufw)
   - [تثبيت وإعداد خادم Coturn المشفر](#ب-تثبيت-وإعداد-خادم-coturn)
   - [إصدار شهادات SSL/TLS الحديثة](#ج-إصدار-شهادات-ssltls)
   - [إعداد Nginx Reverse Proxy مع WSS](#د-إعداد-nginx-reverse-proxy)
   - [تشغيل خدمة النظام (Systemd Service)](#هـ-تشغيل-خدمة-النظام-systemd)

---

## 1. المعمارية الأمنية ونموذج الحماية

```
[ متصفح الوالد / الوالدة ]                                  [ متصفح الابن ]
          │                                                       │
          │ 1. مصادقة PIN آمنة زمنياً (Timing-Safe)                 │
          │    وحصول على رمز JWT قصير الأمد (15m - 2h)            │
          ▼                                                       ▼
   ╔═════════════════════════════════════════════════════════════════════╗
   ║        خادم الإشارات المحصن (Hardened Signaling Server)            ║
   ║   - إجبار HTTPS و Secure WebSockets (WSS)                           ║
   ║   - ترويسات أمان Helmet و CSP صارم و HSTS Preload                  ║
   ║   - حماية DoS/DDoS ومحدد معدل الطلبات (Rate Limiting)              ║
   ║   - فحص وتطهير حزم SDP/ICE لمنع الـ Injection                      ║
   ║   - توليد بيانات اعتماد TURN مؤقتة بمفاتيح HMAC-SHA1               ║
   ╚═════════════════════════════════════════════════════════════════════╝
          │                                                       │
          │ 2. تبادل إشارات SDP مع فرض وجود بصمة التشفير            │
          │    (Mandatory a=fingerprint:sha-256)                  │
          ▼                                                       ▼
          ◄═══════════════════════════════════════════════════════►
             3. قناة وسائط مباشرة ومغلقة بطبقة تشفير طرف-إلى-طرف
                (DTLS 1.2+ / SRTP AES-GCM 128/256 End-to-End)
             (في حال حجب الشبكات يمر التدفق عبر TURN مشفر بمفاتيح مؤقتة)
```

### كيف يمنع النظام هجمات اعتراض البيانات (Man-in-the-Middle)؟
1. **تشفير قناة الإشارات (Signaling Hardening)**: تتم كافة عمليات تبادل المفاتيح حصراً عبر WSS / HTTPS مع فرض TLS 1.3 وحظر الإصدارات القديمة (TLS 1.0/1.1)، مما يمنع اعتراض رسائل SDP الأولية.
2. **التحقق الإلزامي من بصمة التشفير (Mandatory SDP Fingerprint Verification)**: يرفض الخادم والعميل أي حزمة SDP لا تتضمن بصمة `a=fingerprint:sha-256` الموقعة بالشهادة الفريدة للجهاز، مما يضمن أن قناة الوسائط مشفرة مباشرة بين أجهزة العائلة دون أي وسيط مفكوك التشفير.
3. **بيانات اعتماد TURN المؤقتة (Ephemeral TURN Credentials - RFC 5766)**: لا يتم تخزين أي كلمات مرور ثابتة لخوادم TURN في كود العميل. يقوم السيرفر بتوليد اسم مستخدم مؤقت مدمج بوقت انتهاء صلاحية (Timestamp) وكلمة مرور مشفرة بـ HMAC-SHA1 تنتهي تلقائياً بعد فترة قصيرة، مما يمنع استغلال السيرفر أو تتبعه.
4. **عزل النطاقات (Strict CORS & Origin Binding)**: تقتصر مصافحة Socket.io على النطاق المصرح به فقط.
5. **مقاومة هجمات التخمين والفيضان (Anti-Brute Force & Rate Limiting)**: محدد معدل صارم يمنع محاولات تخمين رمز PIN العائلي، بالإضافة لفلتر يمنع إغراق الخادم بحزم ICE المزيفة.

---

## 2. ميزات واجهة الوالدين

- **أزرار ضخمة بلمسة واحدة (1-Tap Call)**: زران كبيران بتباين لوني عالي؛ زر أخضر زمردي للوالد (أبي) وزر وردي ياقوتي للوالدة (أمي).
- **حالة التواجد الحية (Live Presence Dots)**: نقطة خضراء متوهجة توضح للابن فوراً ما إذا كان هاتف الوالد أو الوالدة متصلاً وجاهزاً للمكالمة.
- **نغمات رنين مولدة داخلياً (Web Audio API Synthesizer)**: تعمل بدون الحاجة لملفات mp3 قد تتعطل أو تُحظر، مع تفعيل اهتزاز الهاتف (Vibration API) تلقائياً عند الرنين.
- **شارة تأكيد التشفير الفورية**: فحص آلي في الخلفية يعرض شارة خضراء تفيد بحالة التشفير الحقيقية (DTLS-SRTP / AES-GCM).
- **دعم تثبيت التطبيق (PWA)**: يمكن تثبيت التطبيق بلمسة واحدة على الشاشة الرئيسية لهواتف الوالدين (أندرويد وآيفون) ليعمل كتطبيق أصيل كامل الشاشة.

---

## 3. هيكلية المشروع

```
parents-call/
├── .env                     # متغيرات البيئة المحلية والإنتاج
├── .env.example             # نموذج المتغيرات
├── package.json             # التبعيات وأوامر التشغيل
├── server/
│   ├── server.js            # خادم الإشارات المحصن (Express + Socket.io)
│   ├── config.js            # إعدادات الأمان وقراءة المتغيرات
│   ├── middleware/
│   │   ├── auth.js          # المصادقة بـ JWT والمقارنة الآمنة زمنياً
│   │   ├── rateLimiter.js   # حماية من هجمات DoS والتخمين
│   │   └── validator.js     # التحقق الصارم من حزم SDP/ICE
│   └── services/
│       ├── turnService.js   # توليد بيانات اعتماد TURN المؤقتة (HMAC-SHA1)
│       └── sessionManager.js# إدارة جلسات وتواجد أفراد العائلة
├── public/
│   ├── index.html           # واجهة الوالدين العربية المبسطة
│   ├── css/style.css        # التنسيقات العصرية والأزرار الضخمة
│   ├── js/
│   │   ├── app.js           # وحدة التحكم التفاعلية
│   │   ├── webrtc.js        # إدارة اتصالات WebRTC وتدقيق التشفير
│   │   └── audio-fx.js      # مولد نغمات الرنين المدمج
│   └── manifest.json        # ملف PWA للتثبيت على الهواتف
└── deploy/
    ├── turnserver.conf      # إعدادات Coturn لبيئة الإنتاج
    ├── nginx.conf           # إعدادات Nginx العكسي المشفر مع WSS
    ├── parents-call.service # ملف خدمة Systemd
    ├── Dockerfile           # بناء حاوية التطبيق
    └── docker-compose.yml   # تشغيل متكامل بالحاويات
```

---

## 4. التشغيل المحلي والاختبار

1. الدخول إلى مجلد المشروع وتثبيت الحزم:
   ```bash
   cd parents-call
   npm install
   ```

2. ضبط ملف `.env` (مضبوط وجاهز لرموز العائلة):
   ```env
   PORT=3000
   PIN_SON=20052006     # رمز قيس (الابن)
   PIN_FATHER=1973      # رمز الأب (أبو قيس)
   PIN_MOTHER=332211    # رمز الأم (أم قيس)
   JWT_SECRET=super_secure_jwt_secret_parents_call_2026_xyz987654321_protect_family
   ```

3. تشغيل الخادم:
   ```bash
   npm start
   ```

4. فتح المتصفح على:
   `http://localhost:3000`
   - **قيس**: يسجل الدخول برمز `20052006` -> يظهر له زران: "اتصال بأبي" و "اتصال بأمي".
   - **الأب (أبو قيس)**: يسجل الدخول برمز `1973` -> يظهر له زران: "اتصال بقيس" و "اتصال بأم قيس".
   - **الأم (أم قيس)**: تسجل الدخول برمز `332211` -> يظهر لها زران: "اتصال بقيس" و "اتصال بأبو قيس".
   - الاتصال متبادل وكامل بين الجميع وبكبسة زر واحدة مع صوت الرنين وتشغيل الكاميرا والصوت مشفرين (E2EE)!

---

## 5. دليل النشر والإنتاج الشامل (Production Deployment Checklist)

عند رفع التطبيق على خادم سحابي عام (مثل Ubuntu 22.04 / 24.04 VPS):

### أ. إعداد جدار الحماية (UFW)
تتطلب مكالمات WebRTC فتح منافذ الإشارات ومنافذ تدفق الصوت والفيديو:

```bash
# منافذ الويب والـ SSL
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# منافذ خادم الإشارات وخادم Coturn STUN/TURN
sudo ufw allow 3478/tcp
sudo ufw allow 3478/udp
sudo ufw allow 5349/tcp
sudo ufw allow 5349/udp

# منافذ ترحيل الوسائط المشفرة (WebRTC Media Relay UDP Ports)
sudo ufw allow 49152:65535/udp

# تفعيل الجدار الناري
sudo ufw enable
```

---

### ب. تثبيت وإعداد خادم Coturn
خادم Coturn ضروري لضمان وصول المكالمات حتى لو كان هاتف الوالد خلف شبكة 4G/5G ذات جدار حماية مزدوج (Symmetric NAT):

```bash
sudo apt-get update
sudo apt-get install coturn -y
```

قم بنسخ الإعدادات المحصنة من `deploy/turnserver.conf` إلى `/etc/turnserver.conf`:
```bash
sudo cp deploy/turnserver.conf /etc/turnserver.conf
```
عدّل في الملف:
- `realm=turn.yourdomain.com`
- `static-auth-secret=مفتاح_سري_قوي` (وضعه نفسه في `TURN_SHARED_SECRET` بملف `.env`)
- فعّل الخدمة:
```bash
sudo systemctl enable coturn
sudo systemctl restart coturn
```

---

### ج. إصدار شهادات SSL/TLS الحديثة
WebRTC **يرفض نهائياً** فتح الكاميرا أو الميكروفون بدون اتصال HTTPS آمن في بيئة الإنتاج:

```bash
sudo apt-get install certbot python3-certbot-nginx -y
sudo certbot certonly --standalone -d family.yourdomain.com -d turn.yourdomain.com
```

---

### د. إعداد Nginx Reverse Proxy مع WSS
انسخ ملف الإعدادات المحصن:
```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/parents-call
sudo ln -s /etc/nginx/sites-available/parents-call /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

### هـ. تشغيل خدمة النظام (Systemd Service)
لضمان عمل الخادم 24/7 وإعادة تشغيله تلقائياً عند أي إعادة إقلاع:

```bash
sudo cp deploy/parents-call.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable parents-call
sudo systemctl start parents-call
```

---

## 🔒 قائمة التحقق الأمنية النهائية قبل الاستخدام الفعلي:
- [x] تغيير `FAMILY_SECRET_PIN` في `.env` إلى رمز يعرفه أفراد العائلة فقط.
- [x] تغيير `JWT_SECRET` إلى نص عشوائي قوي 256-bit.
- [x] حصر `ALLOWED_ORIGIN` في النطاق الفعلي `https://family.yourdomain.com`.
- [x] التحقق من ظهور شارة `🔒 مشفر طرف-لطرف (DTLS-SRTP)` الخضراء أثناء المكالمة.
