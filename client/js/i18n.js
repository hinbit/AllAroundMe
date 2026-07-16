/* AllAroundMe i18n: he (default) / en / ar / ru.
   Static text: elements carry data-i18n / data-i18n-ph (placeholder) keys.
   Dynamic text: window.AAM_T(key). The choice persists in localStorage and,
   once a session exists, on the server profile. he+ar are RTL, en+ru LTR. */
(function () {
  'use strict';

  const DICT = {
    he: {
      dir: 'rtl', name: 'עברית',
      'brand.he': 'בעברית קוראים לזה מסביב',
      'menu.map': 'מפה מסביב', 'menu.map.sub': 'כל שירותי הרפואה סביבך — מהאלפון החי של אשכולות',
      'menu.finder': 'איתור רופא לפי תחום', 'menu.finder.sub': 'עץ בחירה מהיר: התמחות ← איזור בגוף ← תגיות',
      'menu.voice': 'ספרו לנו מה קרה', 'menu.voice.sub': 'הקלטה קולית ← תמלול ← המלצת AI ← רופאים במפה',
      'menu.reviews': 'ביקורות על רופאים', 'menu.reviews.sub': 'דרגו את הרופאים שבחרתם וראו מה אחרים אומרים',
      'menu.points': 'הנקודות והתגים שלי', 'menu.doctor': 'כניסת רופאים', 'menu.doctor.sub': 'שאלונים, דוחות, שיתופי מידע',
      'splash.skip': 'דלג ›', 'splash.never': 'עזבו אותי — בלי מסך פתיחה יותר',
      'finder.title': '🩺 איתור רופא לפי תחום', 'finder.pick': 'בחרו התמחות:', 'finder.back': '‹ חזרה',
      'finder.all': '✅ כל', 'finder.hint': 'אפשר לסמן כמה תגיות יחד — גם מענפים שונים',
      'finder.mine': 'הבחירה שלי: ', 'finder.go': 'חפשו לי אותם במפה', 'finder.loading': 'טוען את עץ התגיות…',
      'finder.unavailable': 'עץ התגיות אינו זמין כרגע',
      'points.title': '💎 הפרופיל שלי', 'points.loading': 'טוען…', 'points.unavailable': 'הפרופיל אינו זמין כרגע',
      'points.points': 'נקודות', 'points.searches': 'חיפושים', 'points.visits': 'ביקורים', 'points.reviews': 'ביקורות',
      'points.nobadges': 'עוד אין תגים — חפשו, בחרו ותדרגו כדי להרוויח 🏅',
      'rate.lead': '⭐ נשמח לדעת —', 'rate.q': 'תרצה/י לדרג אותם?', 'rate.one': 'בחרת לאחרונה רופא',
      'rate.many': 'בחרת לאחרונה {n} רופאים', 'rate.yes': 'כן, לדרג ⭐', 'rate.no': 'ממשיכים ›',
      'phone.title': '📱 הפרופיל עוקב אחריך', 'phone.hint': 'חברו מספר וואטסאפ — הנקודות והביקורות יעברו איתכם לכל מכשיר',
      'phone.ph': 'מספר וואטסאפ (למשל 0501234567)', 'phone.send': 'שלחו לי קוד',
      'phone.codePh': 'הקוד שקיבלתם בוואטסאפ', 'phone.verify': 'אימות ✓',
      'phone.connected': 'מחובר למספר', 'phone.sent': 'קוד נשלח בוואטסאפ 📲',
      'phone.merged': '🎉 הפרופילים אוחדו — הכל איתך שוב', 'phone.ok': '✓ הטלפון חובר לפרופיל',
      'badge.new': 'תג חדש',
      'rev.title': '⭐ ביקורות', 'rev.back': '‹ חזרה למסביב', 'rev.mine': 'הרופאים שבחרת',
      'rev.none': 'אין כרגע רופאים שממתינים לדירוג. בחרו רופא במפה 🎯 ואז חזרו לדרג.',
      'rev.freePh': 'או: הקלידו שם רופא לדירוג חופשי', 'rev.freeGo': 'דרגו רופא ›',
      'rev.simple': '⭐ דירוג כללי', 'rev.domains': '🎛️ 5 תחומים',
      'rev.textPh': 'אפשר גם לכתוב כמה מילים… (או להקליט בדף המפה)',
      'rev.send': 'שליחת הביקורת (+5 נקודות)', 'rev.sent': '⭐ תודה! הביקורת נשמרה (+5 נקודות)',
      'rev.starsFirst': 'סמנו כמה כוכבים', 'rev.domainsFirst': 'סמנו כוכבים לפחות בתחום אחד',
      'rev.feed': 'מה אחרים אומרים', 'rev.locked': 'תנו ביקורת ראשונה כדי לראות ביקורות של אחרים',
      'rev.few': 'נתת {n} ביקורות — בינתיים מוצגות כמה ביקורות אקראיות. מ-3 ביקורות נפתחות המובילות של כל יום.',
      'rev.top': '🏆 הביקורות המובילות של היום', 'rev.meta': 'ביקורת על הביקורת:',
      'rev.metaSaved': '👍 הדירוג על הביקורת נשמר (+2 נקודות)',
      'rev.verified': '✓ ביקור מאומת', 'rev.reply': 'תגובת הרופא/ה',
      'rev.flag': '🚩 דיווח', 'rev.flagWhy': 'מה הבעיה בביקורת הזו? (לא חובה)', 'rev.flagged': 'תודה, הדיווח התקבל',
    },
    en: {
      dir: 'ltr', name: 'English',
      'brand.he': 'in Hebrew we call it Misaviv — all around',
      'menu.map': 'Map around me', 'menu.map.sub': 'Every medical service near you — from the live Eshkolot directory',
      'menu.finder': 'Find a doctor by field', 'menu.finder.sub': 'Quick tree: specialty → body area → tags',
      'menu.voice': 'Tell us what happened', 'menu.voice.sub': 'Voice note → transcript → AI advice → doctors on the map',
      'menu.reviews': 'Doctor reviews', 'menu.reviews.sub': 'Rate the doctors you chose and see what others say',
      'menu.points': 'My points & badges', 'menu.doctor': 'Doctors sign-in', 'menu.doctor.sub': 'Questionnaires, reports, data sharing',
      'splash.skip': 'Skip ›', 'splash.never': 'Leave me alone — no more splash',
      'finder.title': '🩺 Find a doctor by field', 'finder.pick': 'Pick a specialty:', 'finder.back': '‹ Back',
      'finder.all': '✅ All', 'finder.hint': 'Combine several tags — even from different branches',
      'finder.mine': 'My picks: ', 'finder.go': 'Find them on the map', 'finder.loading': 'Loading the tag tree…',
      'finder.unavailable': 'The tag tree is unavailable right now',
      'points.title': '💎 My profile', 'points.loading': 'Loading…', 'points.unavailable': 'Profile unavailable right now',
      'points.points': 'points', 'points.searches': 'searches', 'points.visits': 'visits', 'points.reviews': 'reviews',
      'points.nobadges': 'No badges yet — search, choose and rate to earn 🏅',
      'rate.lead': '⭐ Quick question —', 'rate.q': 'Would you like to rate them?', 'rate.one': 'you recently chose a doctor',
      'rate.many': 'you recently chose {n} doctors', 'rate.yes': 'Yes, rate ⭐', 'rate.no': 'Continue ›',
      'phone.title': '📱 Your profile follows you', 'phone.hint': 'Link a WhatsApp number — points and reviews move with you to any device',
      'phone.ph': 'WhatsApp number (e.g. 0501234567)', 'phone.send': 'Send me a code',
      'phone.codePh': 'The code you got on WhatsApp', 'phone.verify': 'Verify ✓',
      'phone.connected': 'Linked to', 'phone.sent': 'Code sent on WhatsApp 📲',
      'phone.merged': '🎉 Profiles merged — everything is back with you', 'phone.ok': '✓ Phone linked to your profile',
      'badge.new': 'New badge',
      'rev.title': '⭐ Reviews', 'rev.back': '‹ Back to Misaviv', 'rev.mine': 'Doctors you chose',
      'rev.none': 'No doctors waiting for a rating. Pick a doctor on the map 🎯 and come back.',
      'rev.freePh': 'Or: type a doctor name to rate freely', 'rev.freeGo': 'Rate a doctor ›',
      'rev.simple': '⭐ Overall rating', 'rev.domains': '🎛️ 5 areas',
      'rev.textPh': 'You can also write a few words… (or record on the map page)',
      'rev.send': 'Send review (+5 points)', 'rev.sent': '⭐ Thanks! Review saved (+5 points)',
      'rev.starsFirst': 'Pick some stars first', 'rev.domainsFirst': 'Star at least one area',
      'rev.feed': 'What others say', 'rev.locked': 'Give your first review to see others’ reviews',
      'rev.few': 'You gave {n} reviews — showing a few random ones. From 3 reviews the daily top opens up.',
      'rev.top': '🏆 Today’s top reviews', 'rev.meta': 'Review the review:',
      'rev.metaSaved': '👍 Your rating of this review was saved (+2 points)',
      'rev.verified': '✓ Verified visit', 'rev.reply': 'Doctor’s reply',
      'rev.flag': '🚩 Report', 'rev.flagWhy': 'What’s wrong with this review? (optional)', 'rev.flagged': 'Thanks, report received',
    },
    ar: {
      dir: 'rtl', name: 'العربية',
      'brand.he': 'بالعبرية نسمّيها مِسافيف — من حولك',
      'menu.map': 'خريطة من حولي', 'menu.map.sub': 'كل الخدمات الطبية القريبة منك — من دليل إشكولوت الحي',
      'menu.finder': 'ابحث عن طبيب حسب المجال', 'menu.finder.sub': 'شجرة سريعة: تخصص ← منطقة الجسم ← وسوم',
      'menu.voice': 'أخبرنا ماذا حدث', 'menu.voice.sub': 'تسجيل صوتي ← نص ← توصية ذكاء اصطناعي ← أطباء على الخريطة',
      'menu.reviews': 'تقييمات الأطباء', 'menu.reviews.sub': 'قيّم الأطباء الذين اخترتهم واطّلع على آراء الآخرين',
      'menu.points': 'نقاطي وأوسمتي', 'menu.doctor': 'دخول الأطباء', 'menu.doctor.sub': 'استبيانات، تقارير، مشاركة بيانات',
      'splash.skip': 'تخطَّ ›', 'splash.never': 'اتركوني — بدون شاشة افتتاح بعد الآن',
      'finder.title': '🩺 ابحث عن طبيب حسب المجال', 'finder.pick': 'اختر تخصصًا:', 'finder.back': '‹ رجوع',
      'finder.all': '✅ كل', 'finder.hint': 'يمكن اختيار عدة وسوم معًا — حتى من فروع مختلفة',
      'finder.mine': 'اختياراتي: ', 'finder.go': 'اعثر عليهم على الخريطة', 'finder.loading': 'جارٍ تحميل شجرة الوسوم…',
      'finder.unavailable': 'شجرة الوسوم غير متاحة حاليًا',
      'points.title': '💎 ملفي الشخصي', 'points.loading': 'جارٍ التحميل…', 'points.unavailable': 'الملف غير متاح حاليًا',
      'points.points': 'نقاط', 'points.searches': 'عمليات بحث', 'points.visits': 'زيارات', 'points.reviews': 'تقييمات',
      'points.nobadges': 'لا أوسمة بعد — ابحث واختر وقيّم لتربح 🏅',
      'rate.lead': '⭐ سؤال سريع —', 'rate.q': 'هل تودّ تقييمهم؟', 'rate.one': 'اخترت مؤخرًا طبيبًا',
      'rate.many': 'اخترت مؤخرًا {n} أطباء', 'rate.yes': 'نعم، للتقييم ⭐', 'rate.no': 'نتابع ›',
      'phone.title': '📱 ملفك يتبعك', 'phone.hint': 'اربط رقم واتساب — النقاط والتقييمات تنتقل معك إلى أي جهاز',
      'phone.ph': 'رقم واتساب (مثلًا 0501234567)', 'phone.send': 'أرسلوا لي رمزًا',
      'phone.codePh': 'الرمز الذي وصلك على واتساب', 'phone.verify': 'تحقق ✓',
      'phone.connected': 'مرتبط بالرقم', 'phone.sent': 'أُرسل الرمز عبر واتساب 📲',
      'phone.merged': '🎉 تم دمج الملفات — كل شيء عاد إليك', 'phone.ok': '✓ رُبط الهاتف بالملف',
      'badge.new': 'وسام جديد',
      'rev.title': '⭐ تقييمات', 'rev.back': '‹ عودة إلى مسافيف', 'rev.mine': 'الأطباء الذين اخترتهم',
      'rev.none': 'لا يوجد أطباء بانتظار التقييم. اختر طبيبًا على الخريطة 🎯 ثم عُد.',
      'rev.freePh': 'أو: اكتب اسم طبيب لتقييم حر', 'rev.freeGo': 'قيّم طبيبًا ›',
      'rev.simple': '⭐ تقييم عام', 'rev.domains': '🎛️ 5 مجالات',
      'rev.textPh': 'يمكنك أيضًا كتابة بضع كلمات… (أو التسجيل في صفحة الخريطة)',
      'rev.send': 'إرسال التقييم (+5 نقاط)', 'rev.sent': '⭐ شكرًا! حُفظ التقييم (+5 نقاط)',
      'rev.starsFirst': 'حدد بعض النجوم أولًا', 'rev.domainsFirst': 'ضع نجومًا في مجال واحد على الأقل',
      'rev.feed': 'ماذا يقول الآخرون', 'rev.locked': 'أعطِ تقييمك الأول لترى تقييمات الآخرين',
      'rev.few': 'أعطيت {n} تقييمات — تُعرض بضعة تقييمات عشوائية. من 3 تقييمات تُفتح قائمة اليوم.',
      'rev.top': '🏆 أفضل تقييمات اليوم', 'rev.meta': 'قيّم التقييم:',
      'rev.metaSaved': '👍 حُفظ تقييمك لهذا التقييم (+2 نقاط)',
      'rev.verified': '✓ زيارة موثّقة', 'rev.reply': 'ردّ الطبيب',
      'rev.flag': '🚩 إبلاغ', 'rev.flagWhy': 'ما مشكلة هذا التقييم؟ (اختياري)', 'rev.flagged': 'شكرًا، استُلم البلاغ',
    },
    ru: {
      dir: 'ltr', name: 'Русский',
      'brand.he': 'на иврите это называется Мисавив — вокруг',
      'menu.map': 'Карта вокруг меня', 'menu.map.sub': 'Все медицинские службы рядом — из живого справочника Эшколот',
      'menu.finder': 'Найти врача по области', 'menu.finder.sub': 'Быстрое дерево: специальность → часть тела → теги',
      'menu.voice': 'Расскажите, что случилось', 'menu.voice.sub': 'Голос → расшифровка → совет ИИ → врачи на карте',
      'menu.reviews': 'Отзывы о врачах', 'menu.reviews.sub': 'Оцените выбранных врачей и читайте чужие отзывы',
      'menu.points': 'Мои баллы и значки', 'menu.doctor': 'Вход для врачей', 'menu.doctor.sub': 'Анкеты, отчёты, обмен данными',
      'splash.skip': 'Пропустить ›', 'splash.never': 'Оставьте меня — больше без заставки',
      'finder.title': '🩺 Найти врача по области', 'finder.pick': 'Выберите специальность:', 'finder.back': '‹ Назад',
      'finder.all': '✅ Все', 'finder.hint': 'Можно отметить несколько тегов — даже из разных веток',
      'finder.mine': 'Мой выбор: ', 'finder.go': 'Найти их на карте', 'finder.loading': 'Загружаю дерево тегов…',
      'finder.unavailable': 'Дерево тегов сейчас недоступно',
      'points.title': '💎 Мой профиль', 'points.loading': 'Загрузка…', 'points.unavailable': 'Профиль сейчас недоступен',
      'points.points': 'баллов', 'points.searches': 'поисков', 'points.visits': 'визитов', 'points.reviews': 'отзывов',
      'points.nobadges': 'Пока нет значков — ищите, выбирайте и оценивайте 🏅',
      'rate.lead': '⭐ Короткий вопрос —', 'rate.q': 'Хотите их оценить?', 'rate.one': 'вы недавно выбрали врача',
      'rate.many': 'вы недавно выбрали {n} врачей', 'rate.yes': 'Да, оценить ⭐', 'rate.no': 'Дальше ›',
      'phone.title': '📱 Профиль следует за вами', 'phone.hint': 'Привяжите номер WhatsApp — баллы и отзывы переедут на любое устройство',
      'phone.ph': 'Номер WhatsApp (например 0501234567)', 'phone.send': 'Прислать код',
      'phone.codePh': 'Код из WhatsApp', 'phone.verify': 'Подтвердить ✓',
      'phone.connected': 'Привязан номер', 'phone.sent': 'Код отправлен в WhatsApp 📲',
      'phone.merged': '🎉 Профили объединены — всё снова с вами', 'phone.ok': '✓ Телефон привязан к профилю',
      'badge.new': 'Новый значок',
      'rev.title': '⭐ Отзывы', 'rev.back': '‹ Назад в Мисавив', 'rev.mine': 'Выбранные вами врачи',
      'rev.none': 'Нет врачей, ожидающих оценки. Выберите врача на карте 🎯 и возвращайтесь.',
      'rev.freePh': 'Или введите имя врача для свободной оценки', 'rev.freeGo': 'Оценить врача ›',
      'rev.simple': '⭐ Общая оценка', 'rev.domains': '🎛️ 5 областей',
      'rev.textPh': 'Можно написать пару слов… (или записать голос на странице карты)',
      'rev.send': 'Отправить отзыв (+5 баллов)', 'rev.sent': '⭐ Спасибо! Отзыв сохранён (+5 баллов)',
      'rev.starsFirst': 'Сначала поставьте звёзды', 'rev.domainsFirst': 'Поставьте звёзды хотя бы в одной области',
      'rev.feed': 'Что говорят другие', 'rev.locked': 'Оставьте первый отзыв, чтобы видеть чужие',
      'rev.few': 'Вы дали {n} отзывов — пока показаны случайные. С 3 отзывов открывается топ дня.',
      'rev.top': '🏆 Лучшие отзывы дня', 'rev.meta': 'Оценить отзыв:',
      'rev.metaSaved': '👍 Ваша оценка отзыва сохранена (+2 балла)',
      'rev.verified': '✓ Подтверждённый визит', 'rev.reply': 'Ответ врача',
      'rev.flag': '🚩 Пожаловаться', 'rev.flagWhy': 'Что не так с этим отзывом? (необязательно)', 'rev.flagged': 'Спасибо, жалоба получена',
    },
  };

  const LANGS = ['he', 'en', 'ar', 'ru'];
  // ?lang=en wins (shareable links, QR codes, testing) and is remembered
  const forced = new URLSearchParams(location.search).get('lang');
  let lang = (LANGS.includes(forced) && forced) || localStorage.getItem('aam_lang') || 'he';
  if (!LANGS.includes(lang)) lang = 'he';
  if (forced && LANGS.includes(forced)) localStorage.setItem('aam_lang', forced);

  function t(key, vars) {
    let s = (DICT[lang] && DICT[lang][key]) || DICT.he[key] || key;
    if (vars) for (const k of Object.keys(vars)) s = s.replace('{' + k + '}', vars[k]);
    return s;
  }

  function apply() {
    document.documentElement.lang = lang;
    document.documentElement.dir = DICT[lang].dir;
    document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
    document.dispatchEvent(new CustomEvent('aam:lang', { detail: { lang } }));
  }

  function setLang(next) {
    if (!LANGS.includes(next) || next === lang) return;
    lang = next;
    localStorage.setItem('aam_lang', lang);
    apply();
    if (window.AAM && AAM.uid && !AAM.uid.startsWith('local-')) {
      fetch('/api/profile/lang', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: AAM.uid, lang }),
      }).catch(() => {});
    }
  }

  // 🌐 switcher, injected wherever <div id="aam-lang"></div> exists
  function mountSwitcher() {
    const host = document.getElementById('aam-lang');
    if (!host) return;
    const sel = document.createElement('select');
    sel.className = 'aam-lang-select';
    sel.setAttribute('aria-label', 'Language / שפה');
    for (const l of LANGS) {
      const o = document.createElement('option');
      o.value = l; o.textContent = DICT[l].name;
      if (l === lang) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener('change', () => setLang(sel.value));
    host.appendChild(sel);
  }

  window.AAM_T = t;
  window.AAM_LANG = {
    get lang() { return lang; },
    set: setLang,
    apply,
    // adopt the server-stored choice on first handshake (unless user picked locally)
    adopt(serverLang) {
      if (serverLang && !localStorage.getItem('aam_lang')) setLang(serverLang);
    },
  };

  document.addEventListener('DOMContentLoaded', () => { mountSwitcher(); apply(); });
  if (document.readyState !== 'loading') { mountSwitcher(); apply(); }
})();
