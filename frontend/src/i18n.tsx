import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { storage } from "@/src/utils/storage";

export type Locale = "en" | "tl";

const STORAGE_KEY = "inked_locale";

// Only headlines, CTAs, and section titles are translated.
// Artist bios, reviews and user-generated content stay in their original language.
const DICT: Record<string, Record<Locale, string>> = {
  // Sign in / sign up
  "auth.tagline": { en: "BOOK YOUR NEXT PIECE", tl: "PA-BOOK NG SUNOD MONG DISENYO" },
  "auth.signin.title": { en: "SIGN IN", tl: "MAG-SIGN IN" },
  "auth.signup.title": { en: "CREATE\nACCOUNT", tl: "GUMAWA NG\nACCOUNT" },
  "auth.signup.subtitle": { en: "JOIN THE STUDIO", tl: "SUMALI SA STUDIO" },
  "auth.email": { en: "EMAIL", tl: "EMAIL" },
  "auth.password": { en: "PASSWORD", tl: "PASSWORD" },
  "auth.name": { en: "NAME", tl: "PANGALAN" },
  "auth.signin.cta": { en: "SIGN IN", tl: "MAG-SIGN IN" },
  "auth.signin.loading": { en: "SIGNING IN...", tl: "NAGSA-SIGN IN..." },
  "auth.signup.cta": { en: "CREATE ACCOUNT", tl: "GUMAWA NG ACCOUNT" },
  "auth.signup.loading": { en: "CREATING...", tl: "GINAGAWA..." },
  "auth.goto.signup": { en: "CREATE AN ACCOUNT →", tl: "GUMAWA NG ACCOUNT →" },
  "auth.goto.signin": { en: "← BACK TO SIGN IN", tl: "← BUMALIK SA SIGN IN" },

  // Tabs & Discover
  "tab.discover": { en: "DISCOVER", tl: "TUKLASIN" },
  "tab.bookings": { en: "BOOKINGS", tl: "BOOKINGS" },
  "tab.messages": { en: "MESSAGES", tl: "MENSAHE" },
  "tab.profile": { en: "PROFILE", tl: "PROFILE" },
  "discover.hello": { en: "HELLO", tl: "KUMUSTA" },
  "discover.search": { en: "SEARCH ARTISTS", tl: "MAGHANAP NG ARTIST" },
  "discover.featured": { en: "ARTIST OF THE WEEK", tl: "ARTIST NG LINGGO" },
  "discover.featured.cta": { en: "BOOK NOW", tl: "MAG-BOOK NA" },
  "discover.featured.endsIn": { en: "ENDS IN", tl: "TATAPOS SA" },
  "discover.empty": { en: "NO\nARTISTS\nFOUND", tl: "WALANG\nARTIST\nNAKITA" },
  "discover.reset": { en: "RESET FILTERS", tl: "I-RESET" },

  // Booking flow
  "book.step": { en: "STEP", tl: "HAKBANG" },
  "book.of": { en: "OF", tl: "SA" },
  "book.step1": { en: "SELECT DATE & TIME", tl: "PUMILI NG PETSA AT ORAS" },
  "book.step2": { en: "DESCRIBE PIECE", tl: "ILARAWAN ANG DISENYO" },
  "book.step3": { en: "REVIEW & PAY", tl: "REPASUHIN AT BAYARAN" },
  "book.location": { en: "SESSION LOCATION", tl: "LOKASYON NG SESSION" },
  "book.atStudio": { en: "AT STUDIO", tl: "SA STUDIO" },
  "book.homeService": { en: "HOME SERVICE", tl: "PA-HOUSE CALL" },
  "book.homeService.hint": { en: "ARTIST TRAVELS TO YOU", tl: "PUPUNTA ANG ARTIST SA IYO" },
  "book.homeService.address": { en: "YOUR ADDRESS", tl: "IYONG ADDRESS" },
  "book.homeService.addressPlaceholder": { en: "STREET, BARANGAY, CITY", tl: "STREET, BARANGAY, LUNGSOD" },
  "book.homeService.fee": { en: "HOME SERVICE FEE", tl: "HOUSE-CALL FEE" },
  "book.homeService.unavailable": { en: "THIS ARTIST DOESN'T OFFER HOME SERVICE", tl: "WALANG HOUSE-CALL SI ARTIST" },
  "book.date": { en: "DATE", tl: "PETSA" },
  "book.time": { en: "TIME", tl: "ORAS" },
  "book.hours": { en: "ESTIMATED HOURS", tl: "TAGAL (ORAS)" },
  "book.checking": { en: "CHECKING AVAILABILITY...", tl: "TINITINGNAN..." },
  "book.booked": { en: "BOOKED", tl: "BOOKED NA" },
  "book.fullyBooked": { en: "FULLY BOOKED — TRY ANOTHER DATE", tl: "PUNO NA — PUMILI NG IBANG PETSA" },
  "book.describe": { en: "DESCRIBE YOUR TATTOO", tl: "ILARAWAN ANG TATTOO" },
  "book.describe.placeholder": { en: "SIZE, PLACEMENT, STYLE, INSPIRATION...", tl: "LAKI, LUGAR, ISTILO, INSPIRASYON..." },
  "book.describe.hint": { en: "MIN 6 CHARACTERS. THE ARTIST WILL FOLLOW UP TO CONFIRM DETAILS.", tl: "MINIMUM 6 NA LETRA. MAG-MESSAGE ANG ARTIST PARA KUMPIRMAHIN." },
  "book.reference": { en: "REFERENCE IMAGE (OPTIONAL)", tl: "REFERENCE (OPTIONAL)" },
  "book.reference.cta": { en: "ADD INSPIRATION PHOTO", tl: "MAGDAGDAG NG LARAWAN" },
  "book.reference.hint": { en: "SO THE ARTIST CAN PREP THE DESIGN", tl: "PARA MAKA-PREPARE ANG ARTIST" },
  "book.summary": { en: "SUMMARY", tl: "SUMARYO" },
  "book.artist": { en: "ARTIST", tl: "ARTIST" },
  "book.rate": { en: "RATE", tl: "TAWAG-KADA-ORAS" },
  "book.total": { en: "EST. TOTAL", tl: "TINATAYANG TOTAL" },
  "book.depositDue": { en: "DEPOSIT DUE NOW", tl: "DOWNPAYMENT NGAYON" },
  "book.notes": { en: "YOUR NOTES", tl: "IYONG NOTA" },
  "book.paymentMethod": { en: "PAYMENT METHOD", tl: "PARAAN NG BAYAD" },
  "book.secured": { en: "SECURED BY STRIPE · 100% REFUNDABLE 48H BEFORE", tl: "SIGURADO SA STRIPE · 100% REFUND 48H BAGO" },
  "book.policy": { en: "POLICY →", tl: "POLICY →" },
  "book.continue": { en: "CONTINUE", tl: "MAGPATULOY" },
  "book.pay": { en: "PAY", tl: "BAYARAN" },
  "book.deposit": { en: "DEPOSIT", tl: "DOWNPAYMENT" },
  "book.processing": { en: "PROCESSING...", tl: "PROSESO..." },
  "book.uploading": { en: "UPLOADING...", tl: "INAAPLOD..." },
  "book.confirmed": { en: "BOOKING\nCONFIRMED", tl: "NA-BOOK NA!" },
  "book.paid": { en: "PAID", tl: "BAYAD NA" },
  "book.pending": { en: "PENDING", tl: "NAKA-HINTAY" },
  "book.viewBookings": { en: "VIEW MY BOOKINGS", tl: "TINGNAN ANG BOOKINGS" },
  "book.backDiscover": { en: "BACK TO DISCOVER", tl: "BUMALIK SA DISCOVER" },

  // Bookings tab
  "bookings.upcoming": { en: "UPCOMING", tl: "PARATING" },
  "bookings.past": { en: "PAST", tl: "NAKARAAN" },
  "bookings.empty.upcoming": { en: "NO\nUPCOMING\nSESSIONS", tl: "WALANG\nPARATING NA\nSESSION" },
  "bookings.empty.past": { en: "NO\nPAST\nSESSIONS", tl: "WALANG\nNAKARAAN NA\nSESSION" },
  "bookings.explore": { en: "EXPLORE ARTISTS", tl: "TUKLASIN ANG MGA ARTIST" },
  "bookings.cancel": { en: "CANCEL", tl: "I-CANCEL" },
  "bookings.bookAgain": { en: "BOOK AGAIN", tl: "MAG-BOOK ULIT" },
  "bookings.today": { en: "TODAY", tl: "NGAYON" },
  "bookings.tomorrow": { en: "TOMORROW", tl: "BUKAS" },
  "bookings.daysAway": { en: "DAYS AWAY", tl: "ARAW NA LANG" },
  "bookings.getReady": { en: "GET READY", tl: "MAGHANDA NA" },
  "bookings.followup.title": { en: "HOW WAS YOUR SESSION?", tl: "KUMUSTA ANG SESSION MO?" },
  "bookings.followup.leaveReview": { en: "LEAVE REVIEW", tl: "MAG-REVIEW" },
  "bookings.followup.bookAgain": { en: "BOOK AGAIN", tl: "MAG-BOOK ULIT" },
  "bookings.followup.dismiss": { en: "Later", tl: "Mamaya" },

  // Profile
  "profile.title": { en: "PROFILE", tl: "PROFILE" },
  "profile.section.account": { en: "ACCOUNT", tl: "ACCOUNT" },
  "profile.section.support": { en: "SUPPORT", tl: "SUPPORT" },
  "profile.wishlist": { en: "MY WISHLIST", tl: "AKING WISHLIST" },
  "profile.bookings": { en: "MY BOOKINGS", tl: "MGA BOOKING" },
  "profile.messages": { en: "MESSAGES", tl: "MENSAHE" },
  "profile.discover": { en: "DISCOVER ARTISTS", tl: "TUKLASIN ANG ARTIST" },
  "profile.help": { en: "HELP CENTER", tl: "TULONG" },
  "profile.privacy": { en: "PRIVACY & TERMS", tl: "PRIVACY AT TERMS" },
  "profile.language": { en: "LANGUAGE", tl: "WIKA" },
  "profile.signout": { en: "SIGN OUT", tl: "MAG-SIGN OUT" },
  "profile.delete": { en: "DELETE MY ACCOUNT", tl: "BURAHIN ANG ACCOUNT KO" },
  "profile.delete.confirm.title": { en: "DELETE ACCOUNT", tl: "BURAHIN ANG ACCOUNT" },
  "profile.delete.confirm.body": {
    en: "This permanently removes your account, bookings history, messages, favorites, and reviews. This cannot be undone.",
    tl: "Permanenteng buburahin nito ang iyong account, mga booking, mensahe, favorites, at reviews. Hindi na ito maibabalik.",
  },
  "profile.delete.confirm.cta": { en: "DELETE FOREVER", tl: "TULUYANG BURAHIN" },
  "profile.delete.cancel": { en: "KEEP ACCOUNT", tl: "PANATILIHIN" },

  // Language toggle
  "lang.english": { en: "ENGLISH", tl: "ENGLISH" },
  "lang.tagalog": { en: "TAGALOG", tl: "TAGALOG" },

  // Admin dashboard
  "tab.admin": { en: "ADMIN", tl: "ADMIN" },
  "admin.title": { en: "ADMIN\nCONSOLE", tl: "ADMIN\nCONSOLE" },
  "admin.subtitle": { en: "MANAGE THE STUDIO", tl: "PAMAHALAAN ANG STUDIO" },
  "admin.overview": { en: "OVERVIEW", tl: "OVERVIEW" },
  "admin.stats.users": { en: "USERS", tl: "MGA USER" },
  "admin.stats.artists": { en: "ARTISTS", tl: "ARTISTS" },
  "admin.stats.bookings": { en: "BOOKINGS", tl: "BOOKINGS" },
  "admin.stats.gross": { en: "GROSS REVENUE", tl: "GROSS REVENUE" },
  "admin.stats.commission": { en: "INKED COMMISSION", tl: "KOMISYON NG INKED" },
  "admin.stats.artistEarn": { en: "ARTIST EARNINGS", tl: "KITA NG ARTIST" },
  "admin.stats.pendingPayouts": { en: "PENDING PAYOUTS", tl: "PARATING NA PAYOUT" },
  "admin.stats.paid": { en: "PAID", tl: "BAYAD" },
  "admin.stats.refunded": { en: "REFUNDED", tl: "REFUND" },
  "admin.stats.cancelled": { en: "CANCELLED", tl: "CANCELLED" },
  "admin.nav.users": { en: "USERS", tl: "MGA USER" },
  "admin.nav.artists": { en: "ARTISTS", tl: "ARTISTS" },
  "admin.nav.bookings": { en: "BOOKINGS", tl: "BOOKINGS" },
  "admin.nav.payments": { en: "PAYMENTS", tl: "MGA BAYAD" },
  "admin.nav.commissions": { en: "COMMISSIONS", tl: "KOMISYON" },
  "admin.nav.payouts": { en: "PAYOUTS", tl: "PAYOUTS" },
  "admin.users.title": { en: "USERS", tl: "MGA USER" },
  "admin.artists.title": { en: "ARTISTS", tl: "ARTISTS" },
  "admin.artists.add": { en: "+ NEW ARTIST", tl: "+ BAGONG ARTIST" },
  "admin.artists.edit": { en: "EDIT", tl: "I-EDIT" },
  "admin.artists.disable": { en: "DISABLE", tl: "I-DISABLE" },
  "admin.artists.enable": { en: "ENABLE", tl: "I-ENABLE" },
  "admin.artists.pending": { en: "PENDING EARNINGS", tl: "PARATING NA KITA" },
  "admin.artists.paidOut": { en: "PAID OUT", tl: "BINAYARAN NA" },
  "admin.artists.block": { en: "BLOCK DATE", tl: "I-BLOCK ANG PETSA" },
  "admin.artists.blocked": { en: "BLOCKED DATES", tl: "BLOCKED NA PETSA" },
  "admin.artists.status": { en: "STATUS", tl: "STATUS" },
  "admin.artists.active": { en: "ACTIVE", tl: "ACTIVE" },
  "admin.artists.inactive": { en: "INACTIVE", tl: "HINDI ACTIVE" },
  "admin.bookings.title": { en: "BOOKINGS", tl: "BOOKINGS" },
  "admin.bookings.all": { en: "ALL", tl: "LAHAT" },
  "admin.bookings.refund": { en: "REFUND", tl: "REFUND" },
  "admin.bookings.filter.paid": { en: "PAID", tl: "BAYAD" },
  "admin.bookings.filter.unpaid": { en: "UNPAID", tl: "HINDI BAYAD" },
  "admin.bookings.filter.refunded": { en: "REFUNDED", tl: "REFUND" },
  "admin.commissions.title": { en: "COMMISSIONS", tl: "KOMISYON" },
  "admin.commissions.subtitle": { en: "PER-ARTIST BREAKDOWN", tl: "BAWAT ARTIST" },
  "admin.payouts.title": { en: "PAYOUTS", tl: "PAYOUTS" },
  "admin.payouts.create": { en: "CREATE PAYOUT", tl: "GUMAWA NG PAYOUT" },
  "admin.payments.title": { en: "PAYMENTS LOG", tl: "PAYMENTS LOG" },
  "admin.save": { en: "SAVE", tl: "I-SAVE" },
  "admin.cancel": { en: "CANCEL", tl: "I-CANCEL" },
  "admin.confirm": { en: "CONFIRM", tl: "KUMPIRMAHIN" },
  "admin.close": { en: "CLOSE", tl: "ISARA" },
  "admin.role.admin": { en: "ADMIN", tl: "ADMIN" },
  "admin.role.user": { en: "USER", tl: "USER" },
  "admin.role.promote": { en: "MAKE ADMIN", tl: "GAWING ADMIN" },
  "admin.role.demote": { en: "REVOKE ADMIN", tl: "TANGGALIN ADMIN" },
  "admin.user.delete.title": { en: "DELETE USER?", tl: "BURAHIN ANG USER?" },
  "admin.user.delete.confirm": { en: "DELETE USER", tl: "BURAHIN USER" },
  "admin.user.delete.button": { en: "DELETE", tl: "BURAHIN" },
};

type Ctx = {
  locale: Locale;
  setLocale: (l: Locale) => Promise<void>;
  t: (key: keyof typeof DICT) => string;
};

const I18nContext = createContext<Ctx | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    (async () => {
      const stored = await storage.getItem<Locale>(STORAGE_KEY, "en" as Locale);
      if (stored === "en" || stored === "tl") setLocaleState(stored);
    })();
  }, []);

  const setLocale = useCallback(async (l: Locale) => {
    setLocaleState(l);
    await storage.setItem(STORAGE_KEY, l);
  }, []);

  const t = useCallback((key: keyof typeof DICT) => {
    return DICT[key]?.[locale] ?? DICT[key]?.en ?? String(key);
  }, [locale]);

  return <I18nContext.Provider value={{ locale, setLocale, t }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const c = useContext(I18nContext);
  if (!c) throw new Error("useI18n must be used inside I18nProvider");
  return c;
}
