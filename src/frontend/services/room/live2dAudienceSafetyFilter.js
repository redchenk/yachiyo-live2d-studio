const DEFAULT_SAFE_USER_NAME = '这位观众';
const DEFAULT_MAX_TEXT_LENGTH = 500;
const DEFAULT_MAX_USER_NAME_LENGTH = 32;
const DEFAULT_ALLOWED_LINK_HOSTS = Object.freeze([
  'b23.tv',
  'bilibili.com',
  'bilibili.tv'
]);

const INVISIBLE_CHARACTER_PATTERN = /[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/gu;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu;
const PHONE_NUMBER_PATTERN = /(?:^|[^\d])(?:\+?86[\s-]?)?1[3-9](?:[\s-]?\d){9}(?:$|[^\d])/u;
const EMAIL_ADDRESS_PATTERN = /(?:^|[^\w.+-])[\w.+-]{1,64}@(?:[\w-]{1,63}\.)+[a-z]{2,24}(?:$|[^\w-])/iu;
const CONTACT_HANDLE_PATTERN = /(?:加|联系|聯繫|私聊|私信)?\s*(?:微信|微\s*信|v\s*x|v信|qq|q\s*q|扣扣|qq群|q群|telegram|t\s*g|电报|電報)\s*(?:号|號|群|是|为|為)?\s*[:：]?\s*[a-z0-9_-]{5,}/iu;
const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>"'，。！？；：、（）【】]+/giu;
const UNSAFE_PROTOCOL_PATTERN = /(?:javascript|data|file|vbscript)\s*:/iu;
const OBFUSCATED_LINK_PATTERN = /(?:[a-z0-9-]{2,63}\s*(?:\[\s*\.\s*\]|[.。]|点)\s*)+(?:com|cn|net|org|top|xyz|vip|cc|io)\b/iu;
const SHORT_LINK_HOSTS = new Set([
  'bit.ly',
  'cutt.ly',
  'is.gd',
  'rebrand.ly',
  'shorturl.at',
  't.co',
  'tiny.cc',
  'tinyurl.com'
]);

const PROMPT_INJECTION_PATTERNS = Object.freeze([
  /(?:忽略|无视|無視|忘掉|绕过|繞過).{0,16}(?:之前|先前|以上|所有|系统|系統|开发者|開發者).{0,16}(?:提示|指令|规则|規則|设定|設定)/iu,
  /(?:显示|顯示|输出|輸出|泄露|洩露|告诉我|告訴我|复述|複述).{0,16}(?:系统提示|系統提示|开发者指令|開發者指令|cookie|sessdata|token|api[\s_-]*key|密钥|密鑰)/iu,
  /(?:执行|執行|运行|運行).{0,10}(?:shell|powershell|cmd|终端|終端|命令|代码|代碼)/iu,
  /(?:越狱模式|越獄模式|jailbreak|dan\s*mode|developer\s*mode)/iu,
  /(?:<\s*\/?\s*(?:system|developer|assistant)\s*>|\[\s*(?:system|developer)\s*\])/iu,
  /ignore.{0,20}(?:previous|prior|all).{0,20}(?:instruction|prompt|rule)/iu,
  /(?:reveal|print|show|leak).{0,20}(?:system\s*prompt|developer\s*message|secret|cookie|token|api[\s_-]*key)/iu
]);

const EXPLICIT_SEXUAL_PATTERNS = Object.freeze([
  /(?:未成年|幼女|幼童|儿童|兒童).{0,8}(?:裸聊|裸照|色情|性行为|性行為|性交|约炮|約炮)/iu,
  /(?:强奸|強姦|乱伦|亂倫|兽交|獸交|儿童色情|兒童色情|裸聊招嫖|色情网站|色情網站)/iu,
  /(?:出售|贩卖|販賣|分享).{0,8}(?:裸照|成人视频|成人視頻|色情资源|色情資源)/iu
]);

const SEVERE_VIOLENCE_PATTERNS = Object.freeze([
  /(?:我要|我会|我會|准备|準備|现在去|現在去).{0,8}(?:杀了|殺了|弄死|砍死|炸死|枪杀|槍殺).{0,8}(?:你|他|她|他们|她们|全家|所有人)/iu,
  /(?:杀光|殺光|屠杀|屠殺|灭门|滅門|炸死|砍死).{0,10}(?:他们|她们|你们|全家|所有人|一群人)/iu,
  /(?:直播|教你|教程).{0,6}(?:自杀|自殺|杀人|殺人|制毒|炸弹|炸彈)/iu
]);

const HATE_PATTERNS = Object.freeze([
  /(?:支那|黑鬼|犹太猪|猶太豬)/iu,
  /(?:中国人|中國人|日本人|黑人|白人|犹太人|猶太人|穆斯林|女性|男性|同性恋|同性戀|残疾人|殘疾人).{0,10}(?:都该死|都該死|低等|滚出去|滾出去|应该灭绝|應該滅絕)/iu
]);

const SCAM_PATTERNS = Object.freeze([
  /(?:兼职|兼職).{0,6}(?:刷单|刷單).{0,8}(?:返利|佣金|傭金|日结|日結|加群|私聊)/iu,
  /(?:投资|投資|理财|理財|虚拟币|虛擬幣|炒币|炒幣).{0,12}(?:稳赚不赔|穩賺不賠|保本高收益|老师带单|老師帶單|内部群|內部群)/iu,
  /(?:充值|充钱|充錢|转账|轉賬).{0,8}(?:返利|送彩金|送彩金|翻倍|解冻|解凍)/iu,
  /(?:免费领取|免費領取|限时福利|限時福利|中奖|中獎).{0,10}(?:加群|加微信|点链接|點連結|扫码|掃碼)/iu,
  /(?:代刷|低价出售|低價出售).{0,8}(?:账号|賬號|帐号|点券|點券|金币|金幣).{0,8}(?:加微信|私聊|联系|聯繫)/iu
]);

const MILD_LANGUAGE_PATTERNS = Object.freeze([
  /傻[逼屄]/giu,
  /妈的|媽的/giu,
  /卧槽|臥槽/giu,
  /草泥马|草泥馬/giu,
  /他妈的|他媽的/giu,
  /(?:^|[^\p{L}])(?:fuck|shit|bitch)(?=$|[^\p{L}])/giu
]);

const ID_CARD_WEIGHTS = Object.freeze([7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]);
const ID_CARD_CHECK_CODES = '10X98765432';

function asCodePoints(value, maxLength) {
  return Array.from(value).slice(0, maxLength).join('');
}

function normalizeSafetyLevel(value) {
  const level = String(value || '').trim().toLowerCase();
  return ['strict', 'balanced', 'relaxed'].includes(level) ? level : 'balanced';
}

function normalizeLineBreaks(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n');
}

export function sanitizeLive2DAudienceText(value, options = {}) {
  const maxLength = Math.max(1, Math.round(Number(options.maxTextLength) || DEFAULT_MAX_TEXT_LENGTH));
  const normalized = normalizeLineBreaks(value)
    .normalize('NFKC')
    .replace(INVISIBLE_CHARACTER_PATTERN, '')
    .replace(CONTROL_CHARACTER_PATTERN, '')
    .replace(/[^\S\n]+/gu, ' ')
    .replace(/ *\n */gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
  return asCodePoints(normalized, maxLength);
}

export function sanitizeLive2DAudienceUserName(value, options = {}) {
  const maxLength = Math.max(1, Math.round(Number(options.maxUserNameLength) || DEFAULT_MAX_USER_NAME_LENGTH));
  const normalized = normalizeLineBreaks(value)
    .normalize('NFKC')
    .replace(INVISIBLE_CHARACTER_PATTERN, '')
    .replace(CONTROL_CHARACTER_PATTERN, '')
    .replace(/\s+/gu, ' ')
    .trim();
  return asCodePoints(normalized, maxLength) || DEFAULT_SAFE_USER_NAME;
}

function hasValidIdCardChecksum(candidate) {
  if (!/^\d{17}[\dX]$/u.test(candidate)) return false;
  const year = Number(candidate.slice(6, 10));
  const month = Number(candidate.slice(10, 12));
  const day = Number(candidate.slice(12, 14));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 1900 ||
    year > new Date().getUTCFullYear() + 1 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return false;
  }
  const sum = ID_CARD_WEIGHTS.reduce(
    (total, weight, index) => total + Number(candidate[index]) * weight,
    0
  );
  return ID_CARD_CHECK_CODES[sum % 11] === candidate[17];
}

function containsChineseIdCard(text) {
  const candidates = String(text || '').match(/(?:\d[\s-]?){17}[\dXx]/gu) || [];
  return candidates.some((value) => hasValidIdCardChecksum(value.replace(/[\s-]/gu, '').toUpperCase()));
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function maskValue(value) {
  return '＊'.repeat(Math.max(2, Array.from(String(value || '')).length));
}

function normalizeCustomEntries(options = {}) {
  const rawEntries = [];
  const sensitiveWords = options.sensitiveWords;
  if (typeof sensitiveWords === 'string') {
    rawEntries.push(...sensitiveWords.split(/\r?\n/gu));
  } else if (Array.isArray(sensitiveWords)) {
    rawEntries.push(...sensitiveWords);
  }

  const customBlacklist = options.customBlacklist;
  if (typeof customBlacklist === 'string') {
    rawEntries.push(...customBlacklist.split(/\r?\n/gu));
  } else if (Array.isArray(customBlacklist)) {
    rawEntries.push(...customBlacklist);
  }

  const defaultAction = options.customBlacklistAction === 'mask' ? 'mask' : 'drop';
  const seen = new Set();
  return rawEntries.flatMap((entry) => {
    const descriptor = entry && typeof entry === 'object'
      ? entry
      : { term: entry, action: defaultAction };
    const term = sanitizeLive2DAudienceText(descriptor.term ?? descriptor.word ?? '', {
      maxTextLength: 100
    });
    const key = term.toLocaleLowerCase();
    if (!term || seen.has(key)) return [];
    seen.add(key);
    return [{
      term,
      action: descriptor.action === 'mask' ? 'mask' : 'drop'
    }];
  });
}

function normalizeAllowedHosts(options = {}) {
  const configured = Array.isArray(options.allowedLinkHosts)
    ? options.allowedLinkHosts
    : [];
  return [...DEFAULT_ALLOWED_LINK_HOSTS, ...configured]
    .map((host) => String(host || '').trim().toLowerCase().replace(/^\.+|\.+$/gu, ''))
    .filter(Boolean);
}

function hostIsAllowed(host, allowedHosts) {
  const normalized = String(host || '').toLowerCase().replace(/\.+$/gu, '');
  return allowedHosts.some((allowed) => normalized === allowed || normalized.endsWith(`.${allowed}`));
}

function findUrlRisk(text, options = {}) {
  if (UNSAFE_PROTOCOL_PATTERN.test(text)) return 'unsafe-link-protocol';
  const allowedHosts = normalizeAllowedHosts(options);
  const safetyLevel = normalizeSafetyLevel(options.safetyLevel);
  const urls = String(text || '').match(URL_PATTERN) || [];
  for (const rawUrl of urls) {
    try {
      const parsed = new URL(/^www\./iu.test(rawUrl) ? `https://${rawUrl}` : rawUrl);
      const host = parsed.hostname.toLowerCase();
      const isIpAddress = /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(host) || host.startsWith('[');
      if (isIpAddress || host.startsWith('xn--') || SHORT_LINK_HOSTS.has(host)) {
        return 'dangerous-link';
      }
      if (!hostIsAllowed(host, allowedHosts) && safetyLevel !== 'relaxed') {
        return 'untrusted-link';
      }
    } catch {
      return 'malformed-link';
    }
  }
  const textWithoutParsedUrls = String(text || '').replace(URL_PATTERN, '');
  if (safetyLevel !== 'relaxed') {
    const obfuscatedLink = textWithoutParsedUrls.match(OBFUSCATED_LINK_PATTERN)?.[0] || '';
    if (obfuscatedLink) {
      const normalizedHost = obfuscatedLink
        .replace(/\s*(?:\[\s*\.\s*\]|[.。]|点)\s*/giu, '.')
        .toLowerCase();
      if (!hostIsAllowed(normalizedHost, allowedHosts)) return 'obfuscated-link';
    }
  }
  return '';
}

function hasAnyPattern(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function findHighRiskReasons(text, options = {}) {
  const reasons = [];
  if (PHONE_NUMBER_PATTERN.test(text)) reasons.push('phone-number');
  if (containsChineseIdCard(text)) reasons.push('identity-number');
  if (EMAIL_ADDRESS_PATTERN.test(text)) reasons.push('email-address');
  if (CONTACT_HANDLE_PATTERN.test(text)) reasons.push('contact-information');
  const linkRisk = findUrlRisk(text, options);
  if (linkRisk) reasons.push(linkRisk);
  if (hasAnyPattern(text, PROMPT_INJECTION_PATTERNS)) reasons.push('prompt-injection');
  if (hasAnyPattern(text, EXPLICIT_SEXUAL_PATTERNS)) reasons.push('explicit-sexual-content');
  if (hasAnyPattern(text, SEVERE_VIOLENCE_PATTERNS)) reasons.push('severe-violence');
  if (hasAnyPattern(text, HATE_PATTERNS)) reasons.push('hate-content');
  if (hasAnyPattern(text, SCAM_PATTERNS)) reasons.push('scam-or-redirect');
  return [...new Set(reasons)];
}

function applyMaskPatterns(text, patterns) {
  let changed = false;
  let output = text;
  patterns.forEach((pattern) => {
    output = output.replace(pattern, (match) => {
      changed = true;
      const prefix = match.match(/^[^\p{L}\p{N}]*/u)?.[0] || '';
      const suffix = match.match(/[^\p{L}\p{N}]*$/u)?.[0] || '';
      const core = match.slice(prefix.length, match.length - suffix.length || undefined);
      return `${prefix}${maskValue(core)}${suffix}`;
    });
  });
  return { changed, text: output };
}

function customEntryMatches(text, entry) {
  return new RegExp(escapeRegExp(entry.term), 'iu').test(text);
}

function applyCustomMasks(text, entries) {
  let changed = false;
  let output = text;
  entries.filter((entry) => entry.action === 'mask').forEach((entry) => {
    const pattern = new RegExp(escapeRegExp(entry.term), 'giu');
    output = output.replace(pattern, (match) => {
      changed = true;
      return maskValue(match);
    });
  });
  return { changed, text: output };
}

function resolveMessageField(message, names) {
  if (!message || typeof message !== 'object') return '';
  for (const name of names) {
    if (message[name] !== undefined && message[name] !== null) return message[name];
  }
  return '';
}

export function filterLive2DAudienceMessage(message = {}, options = {}) {
  const source = typeof message === 'string' ? { text: message } : (message || {});
  const safeTextInput = sanitizeLive2DAudienceText(
    resolveMessageField(source, ['text', 'content', 'message']),
    options
  );
  const safeUserNameInput = sanitizeLive2DAudienceUserName(
    resolveMessageField(source, ['userName', 'username', 'uname', 'name']),
    options
  );
  const safetyLevel = normalizeSafetyLevel(options.safetyLevel);

  if (options.safetyFilterEnabled === false) {
    return {
      action: 'allow',
      allowed: true,
      dropped: false,
      masked: false,
      safeText: safeTextInput,
      safeUserName: safeUserNameInput,
      reason: '',
      reasons: [],
      safetyLevel
    };
  }

  if (!safeTextInput) {
    return {
      action: 'drop',
      allowed: false,
      dropped: true,
      masked: false,
      safeText: '',
      safeUserName: safeUserNameInput,
      reason: 'empty-text',
      reasons: ['empty-text'],
      safetyLevel
    };
  }

  const customEntries = normalizeCustomEntries(options);
  const textReasons = findHighRiskReasons(safeTextInput, options);
  const customDropMatched = customEntries.some(
    (entry) => entry.action === 'drop' && customEntryMatches(safeTextInput, entry)
  );
  if (customDropMatched) textReasons.push('custom-blacklist');

  const userNameReasons = findHighRiskReasons(safeUserNameInput, options);
  const customUserNameMatched = customEntries.some((entry) => customEntryMatches(safeUserNameInput, entry));
  if (customUserNameMatched) userNameReasons.push('custom-blacklist');

  const reasons = [...new Set(textReasons)];
  if (userNameReasons.length) {
    reasons.push('unsafe-user-name');
    userNameReasons.forEach((reason) => reasons.push(`user-name:${reason}`));
  }

  if (textReasons.length) {
    return {
      action: 'drop',
      allowed: false,
      dropped: true,
      masked: false,
      safeText: '',
      safeUserName: userNameReasons.length ? DEFAULT_SAFE_USER_NAME : safeUserNameInput,
      reason: reasons[0],
      reasons: [...new Set(reasons)],
      safetyLevel
    };
  }

  let safeText = safeTextInput;
  let textWasMasked = false;
  const customMaskResult = applyCustomMasks(safeText, customEntries);
  safeText = customMaskResult.text;
  textWasMasked ||= customMaskResult.changed;

  if (options.maskMildLanguage !== false) {
    const mildMaskResult = applyMaskPatterns(safeText, MILD_LANGUAGE_PATTERNS);
    safeText = mildMaskResult.text;
    textWasMasked ||= mildMaskResult.changed;
    if (mildMaskResult.changed) reasons.push('mild-language');
  }
  if (customMaskResult.changed) reasons.push('custom-blacklist');

  const userNameWasMasked = userNameReasons.length > 0;
  const action = textWasMasked || userNameWasMasked ? 'mask' : 'allow';
  return {
    action,
    allowed: true,
    dropped: false,
    masked: action === 'mask',
    safeText,
    safeUserName: userNameWasMasked ? DEFAULT_SAFE_USER_NAME : safeUserNameInput,
    reason: reasons[0] || '',
    reasons: [...new Set(reasons)],
    safetyLevel
  };
}

export function createLive2DAudienceSafetyFilter(options = {}) {
  const configuredOptions = { ...options };
  return {
    filter(message, overrides = {}) {
      return filterLive2DAudienceMessage(message, {
        ...configuredOptions,
        ...overrides
      });
    },
    sanitizeText(value, overrides = {}) {
      return sanitizeLive2DAudienceText(value, {
        ...configuredOptions,
        ...overrides
      });
    },
    sanitizeUserName(value, overrides = {}) {
      return sanitizeLive2DAudienceUserName(value, {
        ...configuredOptions,
        ...overrides
      });
    }
  };
}
