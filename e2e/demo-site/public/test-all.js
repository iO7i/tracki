/* Tracki Test-All Console — drives the real snippet + public ingest APIs only. */
(function () {
  "use strict";
  var cfg = window.__tracki_cfg || {};
  var base = (cfg.endpoint || "http://localhost:4000/v1/events").replace(/\/v1\/events$/, "");
  var lang = document.documentElement.lang === "en" ? "en" : "ar";
  var anonId = "ta_" + Math.random().toString(36).slice(2, 10);
  var sessionId = "ta_s_" + Math.random().toString(36).slice(2, 10);
  var lastInquiry = "";

  // ---- i18n ----------------------------------------------------------------
  var T = {
    title: { ar: "وحدة اختبار تراكي", en: "Tracki Test-All Console" },
    subtitle: {
      ar: "افحص الحل بالكامل من صفحة واحدة — كل شيء يمرّ عبر السكربت الحقيقي وواجهات الاستقبال العامة.",
      en: "Exercise the whole solution from one page — everything runs through the real snippet and public ingest APIs.",
    },
    devOnly: { ar: "أداة تطوير/اختبار", en: "dev / QA tool" },
    keyLabel: { ar: "مفتاح المشروع", en: "Project key" },
    apply: { ar: "تطبيق", en: "Apply" },
    needKey: { ar: "ألصق مفتاح pk_ ثم طبّق", en: "Paste a pk_ key and Apply" },
    snippetLoaded: { ar: "السكربت محمّل ✓", en: "snippet loaded ✓" },
    snippetWaiting: { ar: "بانتظار المفتاح…", en: "waiting for key…" },
    run: { ar: "تشغيل", en: "Run" },
    secEvents: { ar: "١· أحداث سلوكية", en: "1 · Behavioral events" },
    secEventsHint: { ar: "تُرسَل عبر السكربت إلى /v1/events", en: "Sent via the snippet to /v1/events" },
    secStruggles: { ar: "٢· صعوبات (كاشفات السكربت)", en: "2 · Struggles (snippet detectors)" },
    secStrugglesHint: {
      ar: "تفاعلات حقيقية يرصدها السكربت تلقائياً",
      en: "Real interactions the snippet auto-detects",
    },
    secAi: { ar: "٣· المساعدة والذكاء الاصطناعي", en: "3 · Self-service & AI" },
    secAiHint: { ar: "الإجابات موثّقة أو تُصعّد بصدق", en: "Answers are grounded or escalate honestly" },
    secWa: { ar: "٤· جسر واتساب", en: "4 · WhatsApp bridge" },
    secWaHint: { ar: "تحويل يحمل السياق + محاكاة وارد", en: "Context handoff + simulated inbound" },
    secKb: { ar: "٥· حلقة المعرفة", en: "5 · Knowledge loop" },
    secKbHint: { ar: "بحث بلا نتيجة متكرر → فجوة/مسودة", en: "Recurring no-result search → gap / draft" },
    secVerify: { ar: "تحقّق في لوحة التحكم", en: "Verify in the dashboard" },
    secVerifyHint: {
      ar: "افتح السطح المناسب لتأكيد وصول البيانات",
      en: "Open the matching surface to confirm data landed",
    },
    pageview: { ar: "مشاهدة صفحة", en: "Pageview" },
    pageviewD: { ar: "tracki.page() — حدث مشاهدة", en: "tracki.page() — a pageview event" },
    track: { ar: "حدث مخصّص", en: "Custom event" },
    trackD: { ar: "tracki.track('add_to_cart')", en: "tracki.track('add_to_cart')" },
    identify: { ar: "تعريف هوية (PII)", en: "Identify (PII)" },
    identifyD: {
      ar: "بريد + هاتف خليجي — يجب أن يُخفى عند التخزين (تحقّق باللوحة)",
      en: "Email + GCC phone — must be masked at rest (verify in dashboard)",
    },
    rage: { ar: "نقرات غاضبة", en: "Rage clicks" },
    rageD: { ar: "نقرات سريعة متكررة على زر", en: "A rapid burst of real clicks" },
    abandon: { ar: "ترك نموذج", en: "Form abandon" },
    abandonD: { ar: "تركيز حقل ثم مغادرته دون إرسال", en: "Focus a field then leave without submit" },
    jsError: { ar: "خطأ جافاسكربت", en: "JS error" },
    jsErrorD: { ar: "خطأ غير ملتقَط يرصده السكربت", en: "An uncaught error the snippet captures" },
    openFaq: { ar: "فتح الأسئلة الشائعة", en: "Open FAQ widget" },
    openFaqD: { ar: "tracki.faq()", en: "tracki.faq()" },
    openChat: { ar: "فتح الوكيل", en: "Open Agent chat" },
    openChatD: { ar: "tracki.chat()", en: "tracki.chat()" },
    askG: { ar: "اسأل الوكيل (موثّق)", en: "Ask Agent (grounded)" },
    askGD: {
      ar: "سؤال ضمن النطاق — يُتوقّع إجابة بمصدر (يتطلّب سؤالاً شائعاً منشوراً)",
      en: "In-scope — expects a cited answer (requires a published FAQ)",
    },
    askO: { ar: "اسأل الوكيل (خارج النطاق)", en: "Ask Agent (out-of-scope)" },
    askOD: { ar: "يُتوقّع تصعيد بلا اختلاق", en: "Expects honest escalation, no fabrication" },
    handoff: { ar: "تحويل إلى واتساب", en: "Escalate → WhatsApp" },
    handoffD: { ar: "/v1/handoff → رمز استعلام + رابط", en: "/v1/handoff → inquiry code + link" },
    simulate: { ar: "محاكاة وارد واتساب", en: "Simulate inbound" },
    simulateD: { ar: "/v1/whatsapp/simulate يحمل الرمز", en: "/v1/whatsapp/simulate carrying the code" },
    kbGap: { ar: "إثارة فجوة معرفية", en: "Trigger a knowledge gap" },
    kbGapD: { ar: "بحث بلا نتيجة ×٣ لنفس السؤال", en: "Same no-result search ×3" },
    logTitle: { ar: "سجل الشبكة (ingest)", en: "Network log (ingest)" },
    pass: { ar: "ناجح", en: "PASS" },
    fail: { ar: "فشل", en: "FAIL" },
  };
  function t(k) {
    return (T[k] && T[k][lang]) || k;
  }

  // ---- network log + fetch wrap -------------------------------------------
  var logEl;
  function log(msg, cls) {
    if (!logEl) return;
    var line = document.createElement("div");
    line.className = "l " + (cls || "");
    var ts = new Date().toISOString().slice(11, 19);
    line.textContent = ts + "  " + msg;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  }
  var origFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    var method = (init && init.method) || (input && input.method) || "GET";
    var p = origFetch(input, init);
    if (/\/v1\/|localhost:4000/.test(url)) {
      var short = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0];
      p.then(function (r) {
        log(method + " " + short + " → " + r.status, r.ok ? "ok" : "bad");
      }).catch(function () {
        log(method + " " + short + " → network error", "bad");
      });
    }
    return p;
  };

  // ---- helpers -------------------------------------------------------------
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs)
      Object.keys(attrs).forEach(function (k) {
        if (k === "class") n.className = attrs[k];
        else if (k === "text") n.textContent = attrs[k];
        else if (k === "html") n.innerHTML = attrs[k];
        else n.setAttribute(k, attrs[k]);
      });
    (kids || []).forEach(function (c) {
      n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return n;
  }
  function api(path, body) {
    // Use the wrapped fetch so probe requests show in the live log.
    return fetch(base + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then(function (r) {
      return r.json().then(
        function (j) {
          return { status: r.status, ok: r.ok, json: j };
        },
        function () {
          return { status: r.status, ok: r.ok, json: {} };
        },
      );
    });
  }
  function ready() {
    return !!(window.tracki && window.tracki.loaded);
  }

  // ---- actions -------------------------------------------------------------
  function res(node, text, cls) {
    node.textContent = text;
    node.className = "result " + (cls || "info");
  }
  function ev(type, props) {
    return fetch(cfg.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        key: cfg.key,
        anonId: anonId,
        sessionId: sessionId,
        sentAt: Date.now(), // required by eventBatchSchema — omitting it silently drops the batch
        events: [
          {
            type: type,
            ts: Date.now(),
            path: "/test-all",
            url: location.href,
            props: props || {},
          },
        ],
      }),
    });
  }

  var actions = {
    pageview: function (r) {
      window.tracki.page({ name: "test-all" });
      res(r, "tracki.page() ✓", "ok");
    },
    track: function (r) {
      window.tracki.track("add_to_cart", { sku: "SKU-1", price: 99 });
      res(r, "tracki.track('add_to_cart') ✓", "ok");
    },
    identify: function (r) {
      window.tracki.identify("user_" + Math.random().toString(36).slice(2, 8), {
        email: "tester@demo.sa",
        phone: "+966500000000",
        name: "Test User",
      });
      res(r, (lang === "ar" ? "أُرسلت — تحقّق من الإخفاء باللوحة" : "sent — verify masking in dashboard"), "ok");
    },
    rage: function (r) {
      var tgt = document.getElementById("rage-target");
      for (var i = 0; i < 7; i++) tgt.click();
      res(r, "7× click ✓", "ok");
    },
    abandon: function (r) {
      var f = document.getElementById("abandon-field");
      f.focus();
      f.value = "partial…";
      setTimeout(function () {
        f.blur();
      }, 400);
      res(r, (lang === "ar" ? "تركيز ثم مغادرة ✓" : "focus → blur ✓"), "ok");
    },
    jsError: function (r) {
      setTimeout(function () {
        throw new Error("test-all synthetic error");
      }, 0);
      res(r, (lang === "ar" ? "أُطلق خطأ ✓" : "error thrown ✓"), "ok");
    },
    openFaq: function (r) {
      if (!ready()) return res(r, t("needKey"), "bad");
      window.tracki.faq();
      res(r, "tracki.faq() ✓", "ok");
    },
    openChat: function (r) {
      if (!ready()) return res(r, t("needKey"), "bad");
      window.tracki.chat();
      res(r, "tracki.chat() ✓", "ok");
    },
    askG: function (r) {
      res(r, "…", "info");
      return api("/v1/chat", {
        key: cfg.key,
        anonId: anonId,
        sessionId: sessionId,
        message: lang === "ar" ? "كيف أدفع" : "how do I pay",
      }).then(function (o) {
        var j = o.json || {};
        var pass = j.escalate === false && !!j.citation;
        res(
          r,
          (pass ? "✓ " + t("pass") : "• " + t("fail")) +
            " — escalate=" + j.escalate + ", cited=" + !!j.citation +
            "\n" + (j.reply || ""),
          pass ? "ok" : "bad",
        );
      });
    },
    askO: function (r) {
      res(r, "…", "info");
      return api("/v1/chat", {
        key: cfg.key,
        anonId: anonId,
        sessionId: sessionId,
        message: lang === "ar" ? "ما هو الطقس اليوم" : "what is the weather today",
      }).then(function (o) {
        var j = o.json || {};
        var pass = j.escalate === true && !j.citation;
        res(
          r,
          (pass ? "✓ " + t("pass") : "• " + t("fail")) +
            " — escalate=" + j.escalate + ", cited=" + !!j.citation,
          pass ? "ok" : "bad",
        );
      });
    },
    handoff: function (r) {
      res(r, "…", "info");
      return api("/v1/handoff", {
        key: cfg.key,
        anonId: anonId,
        sessionId: sessionId,
        path: "/test-all",
        locale: lang,
      }).then(function (o) {
        var j = o.json || {};
        if (j.inquiryCode) {
          lastInquiry = j.inquiryCode;
          res(r, j.inquiryCode + "  ·  " + (j.deepLink || ""), "ok");
        } else {
          res(r, "• " + t("fail") + " — " + JSON.stringify(j), "bad");
        }
      });
    },
    simulate: function (r) {
      res(r, "…", "info");
      var text = (lastInquiry ? lastInquiry + " " : "") + (lang === "ar" ? "مرحبا" : "hello");
      return api("/v1/whatsapp/simulate", { key: cfg.key, from: "966500000000", text: text }).then(
        function (o) {
          res(
            r,
            o.ok ? "✓ " + t("pass") + (lastInquiry ? " — " + (lang === "ar" ? "بالسياق" : "with context") : "") : "• " + t("fail") + " — " + o.status,
            o.ok ? "ok" : "bad",
          );
        },
      );
    },
    kbGap: function (r) {
      res(r, "…", "info");
      var q = "zzqx nonsense gap";
      return Promise.all([ev("faq_search_noresult", { query: q }), ev("faq_search_noresult", { query: q }), ev("faq_search_noresult", { query: q })]).then(
        function () {
          res(r, (lang === "ar" ? "أُطلقت ٣ عمليات بحث بلا نتيجة — تحقّق في صوت العميل/المعرفة" : "fired ×3 — verify in VoC / Knowledge"), "ok");
        },
      );
    },
  };

  var SECTIONS = [
    { sec: "secEvents", hint: "secEventsHint", items: ["pageview", "track", "identify"] },
    { sec: "secStruggles", hint: "secStrugglesHint", items: ["rage", "abandon", "jsError"], fixtures: true },
    { sec: "secAi", hint: "secAiHint", items: ["openFaq", "openChat", "askG", "askO"] },
    { sec: "secWa", hint: "secWaHint", items: ["handoff", "simulate"] },
    { sec: "secKb", hint: "secKbHint", items: ["kbGap"] },
  ];
  var LABELS = {
    pageview: "pageview", track: "track", identify: "identify", rage: "rage", abandon: "abandon",
    jsError: "jsError", openFaq: "openFaq", openChat: "openChat", askG: "askG", askO: "askO",
    handoff: "handoff", simulate: "simulate", kbGap: "kbGap",
  };

  // ---- render --------------------------------------------------------------
  function render() {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    var app = document.getElementById("app");
    app.textContent = "";

    var langBtn = el("button", { class: "ghost" }, [lang === "ar" ? "English" : "العربية"]);
    langBtn.onclick = function () {
      lang = lang === "ar" ? "en" : "ar";
      render();
    };
    app.appendChild(
      el("div", { class: "topbar" }, [
        el("div", { class: "brand" }, [el("span", { class: "mark", text: "T" }), t("title")]),
        el("div", { class: "row-controls" }, [el("span", { class: "pill", text: t("devOnly") }), langBtn]),
      ]),
    );
    app.appendChild(el("p", { class: "subtitle", text: t("subtitle") }));

    // Key bar
    var keyInput = el("input", { value: cfg.key || "", placeholder: "pk_…", dir: "ltr" });
    var statusEl = el("span", { class: "status" });
    function refreshStatus() {
      if (!cfg.key) {
        statusEl.textContent = t("needKey");
        statusEl.className = "status bad";
      } else if (ready()) {
        statusEl.textContent = t("snippetLoaded");
        statusEl.className = "status ok";
      } else {
        statusEl.textContent = t("snippetWaiting");
        statusEl.className = "status";
      }
    }
    var applyBtn = el("button", { class: "primary" }, [t("apply")]);
    applyBtn.onclick = function () {
      var v = keyInput.value.trim();
      if (!v) return;
      var u = new URL(location.href);
      u.searchParams.set("key", v);
      location.href = u.toString();
    };
    app.appendChild(
      el("div", { class: "keybar" }, [el("span", { text: t("keyLabel") + ":" }), keyInput, applyBtn, statusEl]),
    );

    SECTIONS.forEach(function (s) {
      var sec = el("div", { class: "section" }, [
        el("h2", { text: t(s.sec) }),
        el("p", { class: "hint", text: t(s.hint) }),
      ]);
      s.items.forEach(function (id) {
        var result = el("div", { class: "result info" });
        var btn = el("button", { class: "primary", "data-act": id }, [t("run")]);
        btn.onclick = function () {
          try {
            var out = actions[id](result);
            if (out && out.catch) out.catch(function (e) { res(result, "ERR " + e.message, "bad"); });
          } catch (e) {
            res(result, "ERR " + e.message, "bad");
          }
        };
        sec.appendChild(
          el("div", { class: "action" }, [
            el("div", {}, [
              el("div", { class: "label", text: t(LABELS[id]) }),
              el("div", { class: "desc", text: t(LABELS[id] + "D") }),
              result,
            ]),
            el("div", { class: "row-controls" }, [btn]),
          ]),
        );
      });
      if (s.fixtures) {
        sec.appendChild(
          el("div", { class: "fixture" }, [
            el("button", { id: "rage-target", class: "ghost", type: "button", text: lang === "ar" ? "هدف النقر" : "click target" }),
            el("form", { id: "abandon-form" }, [
              el("input", { id: "abandon-field", name: "demo", placeholder: lang === "ar" ? "حقل تجريبي" : "demo field" }),
            ]),
          ]),
        );
      }
      app.appendChild(sec);
    });

    // Verify deep links
    var verify = el("div", { class: "section" }, [
      el("h2", { text: t("secVerify") }),
      el("p", { class: "hint", text: t("secVerifyHint") }),
    ]);
    var links = el("div", { class: "deeplinks" });
    var surfaces = ["live", "struggles", "agent", "inbox", "voc", "knowledge"];
    surfaces.forEach(function (sfc) {
      var href;
      if (cfg.org && cfg.project) {
        href = cfg.dash + "/" + lang + "/orgs/" + cfg.org + "/" + sfc + "?project=" + encodeURIComponent(cfg.project);
      } else {
        href = cfg.dash + "/" + lang + "/orgs";
      }
      links.appendChild(el("a", { href: href, target: "_blank", rel: "noopener", text: sfc }));
    });
    verify.appendChild(links);
    app.appendChild(verify);

    // Log panel
    app.appendChild(
      el("div", { id: "log" }, [el("div", { class: "loghead", text: t("logTitle") })]),
    );
    logEl = document.getElementById("log");

    refreshStatus();
    var poll = setInterval(function () {
      refreshStatus();
      if (ready()) clearInterval(poll);
    }, 500);
  }

  render();
})();
