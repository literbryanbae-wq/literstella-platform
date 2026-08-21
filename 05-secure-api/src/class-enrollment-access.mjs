export const CLASS_BOOK_ALL = "all";

const LEGACY_MAIL_ALIASES = Object.freeze({
  "daum.net": "hanmail.net",
  "hanmail.net": "daum.net",
});

export function classEnrollmentEmailCandidates(value) {
  const email = String(value || "").trim().toLowerCase();
  const at = email.lastIndexOf("@");
  if (at <= 0) return email ? [email] : [];

  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const aliasDomain = LEGACY_MAIL_ALIASES[domain];
  return aliasDomain ? [email, `${local}@${aliasDomain}`] : [email];
}

export function classBookRequestSatisfied(requestedBook, grantedBooks) {
  const requested = String(requestedBook || "").trim().toLowerCase();
  const granted = new Set((grantedBooks || []).map((book) => String(book || "").trim().toLowerCase()).filter(Boolean));
  if (!granted.size) return false;
  return requested === CLASS_BOOK_ALL || granted.has(requested);
}
