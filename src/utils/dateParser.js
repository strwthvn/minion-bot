const { TIMEZONE_OFFSET } = require('../config');

const DATE_REGEX = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/;

/**
 * Parse "DD.MM.YYYY HH:mm" (MSK) → Date (UTC).
 * Returns { ok: true, date } or { ok: false, error }.
 */
function parse(input) {
  const trimmed = input.trim();
  const match = trimmed.match(DATE_REGEX);
  if (!match) {
    return { ok: false, error: 'Неверный формат. Используйте DD.MM.YYYY HH:mm' };
  }

  const [, dd, mm, yyyy, hh, min] = match.map(Number);

  const date = new Date(Date.UTC(yyyy, mm - 1, dd, hh - TIMEZONE_OFFSET, min));

  // Validate that the components didn't overflow (e.g. 32.01 → Feb 1)
  if (
    date.getUTCFullYear() !== yyyy ||
    date.getUTCMonth() !== mm - 1 + (hh - TIMEZONE_OFFSET < 0 ? -1 : hh - TIMEZONE_OFFSET >= 24 ? 1 : 0)
  ) {
    // Simpler: re-derive local components and compare
    const checkDate = new Date(date.getTime() + TIMEZONE_OFFSET * 3600_000);
    if (
      checkDate.getUTCDate() !== dd ||
      checkDate.getUTCMonth() + 1 !== mm ||
      checkDate.getUTCFullYear() !== yyyy
    ) {
      return { ok: false, error: 'Некорректная дата.' };
    }
  }

  if (date.getTime() <= Date.now()) {
    return { ok: false, error: 'Дата должна быть в будущем.' };
  }

  return { ok: true, date };
}

/**
 * Date (UTC) → "DD.MM.YYYY HH:mm МСК"
 */
function formatMSK(date) {
  if (typeof date === 'string') date = new Date(date);

  const msk = new Date(date.getTime() + TIMEZONE_OFFSET * 3600_000);
  const dd = String(msk.getUTCDate()).padStart(2, '0');
  const mm = String(msk.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = msk.getUTCFullYear();
  const hh = String(msk.getUTCHours()).padStart(2, '0');
  const min = String(msk.getUTCMinutes()).padStart(2, '0');

  return `${dd}.${mm}.${yyyy} ${hh}:${min} МСК`;
}

module.exports = { parse, formatMSK };
