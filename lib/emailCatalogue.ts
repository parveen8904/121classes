// EVERY EMAIL THIS SITE SENDS ON ITS OWN, IN ONE LIST.
//
// The founder's ask, 19 Aug: one admin screen that answers "what triggers what
// mail, and what does it say". The editable templates on /admin/emails were
// only half the truth — a large share of the mail carries fixed wording written
// at its send-site, invisible to anyone who does not read code.
//
// This catalogue is maintained BY HAND against the send-sites. That is a
// deliberate trade: a hand list can say "when an examiner releases a copy" in
// words the office understands, where any automatic scan could only say which
// function called which. The price is that a NEW email must be added here when
// it is built — treat this file as part of building one.
//
// `template` names an editable template on /admin/emails; `fixed` means the
// wording lives in code at `file` and changing it is a code change.

export type CatalogueEntry = {
  trigger: string;        // when it fires, in office words
  to: string;             // who receives it
  subject: string;        // subject or its pattern
  template?: string;      // editable template key on /admin/emails
  fixed?: boolean;        // wording fixed in code
  file: string;           // where the send lives
  channelNote?: string;   // when a WhatsApp/Telegram copy rides along
};

export type CatalogueGroup = { group: string; entries: CatalogueEntry[] };

export const EMAIL_CATALOGUE: CatalogueGroup[] = [
  {
    group: "🎓 Account & login",
    entries: [
      { trigger: "Somebody registers on the site", to: "the new student", subject: "Verify your email", template: "email_verify", file: "app/auth/email-actions.ts" },
      { trigger: "They ask for the verification mail again", to: "the student", subject: "Verify your email", template: "email_verify_resend", file: "app/auth/email-actions.ts" },
      { trigger: "Forgot password (the form, or a failed login rescuing itself)", to: "the student", subject: "Reset your password", template: "password_reset", file: "app/auth/email-actions.ts · lib/loginRescue.ts" },
      { trigger: "A failed login where we can help further", to: "the student", subject: "Getting you back in", template: "login_help", file: "lib/loginRescue.ts" },
      { trigger: "Admin creates an account by hand", to: "the student", subject: "Your account is ready", template: "account_created", file: "app/admin/users/actions.ts" },
      { trigger: "First visit to the dashboard, once ever", to: "the student", subject: "Welcome — how your AI classroom works", template: "welcome_guide", file: "lib/emailTemplates.ts" },
      { trigger: "Bulk-granted student never signed in (rescue sweep)", to: "the student", subject: "Your access is waiting", fixed: true, file: "lib/firstLoginRescue.ts" },
    ],
  },
  {
    group: "💳 Money & access",
    entries: [
      { trigger: "A payment succeeds (website checkout, or the quarter-hourly reconcile of a stuck one)", to: "the payer", subject: "Your invoice CAPS/… — GST invoice attached", fixed: true, file: "lib/orderInvoice.ts" },
      { trigger: "An invoice is reissued to correct address/tax (same number)", to: "the payer", subject: "Corrected invoice CAPS/…", fixed: true, file: "lib/orderInvoice.ts" },
      { trigger: "Subscription bought → access opens", to: "the student", subject: "Payment received — subject unlocked", fixed: true, file: "app/learn/[courseId]/plans/payActions.ts" },
      { trigger: "A vendor/sponsor pays for a student", to: "the payer (invoice + Sponsor Guide)", subject: "Your invoice … / Thank you for your gift", fixed: true, file: "lib/giftProvision.ts" },
      { trigger: "Same vendor/sponsor sale", to: "the STUDENT (no amount shown, ever)", subject: "You have been supported 🎓", template: "gift_received", file: "lib/giftProvision.ts" },
      { trigger: "Bulk access grant lands", to: "each student granted", subject: "Your access is ready", template: "access_granted", file: "lib/grantQueue.ts" },
      { trigger: "Aldine/partner purchase provisioned", to: "the student", subject: "Your classes are ready", template: "purchase_provisioned", file: "lib/partnerEnroll.ts" },
      { trigger: "Admin sends a coupon", to: "student / sponsor", subject: "A coupon for you", template: "coupon_sent · coupon_sponsor", file: "app/admin/coupons/actions.ts" },
      { trigger: "Scholarship approved", to: "the applicant", subject: "Scholarship approved + coupon", template: "scholarship_approved", file: "app/admin/scholarships/actions.ts" },
      { trigger: "Book order paid", to: "the buyer", subject: "📦 Your book order is confirmed", fixed: true, file: "app/books/…/payActions.ts" },
      { trigger: "Books dispatched (tracking goes on)", to: "the buyer", subject: "Your books are on the way 🚚", fixed: true, file: "lib/dispatchNotify.ts" },
    ],
  },
  {
    group: "📝 Papers, tests & study",
    entries: [
      { trigger: "Examiner releases a checked copy", to: "the student", subject: "✅ Your checked copy is ready", fixed: true, file: "app/examiner/actions.ts", channelNote: "WhatsApp copy rides along (checked_copy_ready template)" },
      { trigger: "An MCQ test is marked", to: "the student", subject: "📝 Your test report", fixed: true, file: "app/learn/section/[sectionId]/testActions.ts", channelNote: "WhatsApp copy (test_report_ready)" },
      { trigger: "A live class is today (morning) and again ~15 min before", to: "everyone enrolled in the subject + anyone who pressed Notify me", subject: "Reminder: … starting soon", template: "class_reminder", file: "app/api/cron/class-reminders/route.ts", channelNote: "WhatsApp copy (live_class_today)" },
      { trigger: "Weekly study-plan nudge (deduped per week)", to: "students with a plan", subject: "Your study week", fixed: true, file: "lib/studyReminders.ts" },
      { trigger: "A doubt/question gets a human answer", to: "the asker", subject: "Your question — answered", template: "question_answered", file: "lib/answerDelivery.ts · app/admin/inbox/actions.ts" },
      { trigger: "Free trial code requested", to: "the visitor", subject: "Your trial code", template: "trial_code", file: "app/try/actions.ts" },
    ],
  },
  {
    group: "🎫 Support & office outreach",
    entries: [
      { trigger: "A support ticket is raised", to: "admins — and the warehouse operator ONLY for book-shaped tickets", subject: "🎫 New ticket TKT-…", fixed: true, file: "lib/tickets.ts" },
      { trigger: "A ticket is assigned to somebody", to: "the assignee", subject: "📞 Ticket assigned to you", fixed: true, file: "lib/tickets.ts" },
      { trigger: "Office replies to a ticket", to: "the student", subject: "TKT-… — about your query", fixed: true, file: "app/admin/tickets/actions.ts" },
      { trigger: "A ticket sits unanswered too long", to: "admins", subject: "Ticket overdue", fixed: true, file: "app/api/cron/tickets-escalate/route.ts" },
      { trigger: "Support form says thanks", to: "the writer", subject: "We received your message", template: "support_received", file: "app/support/actions.ts" },
      { trigger: "Mentoring desk — a nudge the office APPROVED and sent", to: "that one student", subject: "A note from CA Parveen Sharma Classes", fixed: true, file: "app/admin/mentoring/actions.ts" },
      { trigger: "Re-engagement drafts APPROVED by the team", to: "quiet students", subject: "varies (drafted per student)", fixed: true, file: "lib/reengage.ts" },
      { trigger: "Office sends chosen CVs to an employer", to: "the employer, resumes attached", subject: "Candidate profiles — CA Parveen Sharma Classes", fixed: true, file: "app/admin/cvs/actions.ts" },
      { trigger: "One-off notice from Admin → Notify students", to: "chosen students", subject: "as typed", fixed: true, file: "app/admin/notifications/actions.ts" },
      { trigger: "Vendor compliance finding — only after the office presses Send", to: "the vendor", subject: "About your listing", fixed: true, file: "lib/supporterWarn.ts" },
      { trigger: "Vendor all-clear letter — behind its button", to: "cleared vendors", subject: "Your site is cleared", fixed: true, file: "lib/supporterAllClear.ts" },
    ],
  },
  {
    group: "🏭 Reports & machinery (to the office, not students)",
    entries: [
      { trigger: "Nightly warehouse dispatch list", to: "Pawan ji (warehouse)", subject: "Orders to dispatch — with addresses", fixed: true, file: "lib/warehouse.ts · app/api/cron/day-orders/route.ts" },
      { trigger: "AI news digest for approval", to: "the founder", subject: "News digest", fixed: true, file: "app/api/cron/ai-digest/route.ts" },
      { trigger: "Placement feed digest", to: "the founder", subject: "New CA openings", fixed: true, file: "lib/jobsfeed.ts · lib/govtfeed.ts" },
      { trigger: "Nightly database backup", to: "backup mailbox", subject: "DB backup", fixed: true, file: "app/api/cron/backup-email/route.ts" },
      { trigger: "Site down / cost alarms", to: "ps@aldine.edu.in (alerts address)", subject: "⚠️ alert", fixed: true, file: "app/api/cron/uptime/route.ts · lib/costalerts.ts" },
      { trigger: "A student's inbound email arrives (bridge)", to: "auto-acknowledgement to the sender", subject: "We received your email", fixed: true, file: "app/api/email/inbound/route.ts" },
    ],
  },
];
