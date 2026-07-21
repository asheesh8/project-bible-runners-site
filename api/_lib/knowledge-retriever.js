import { KNOWLEDGE_BASE } from './knowledge-base.js';

const SECTION_SEPARATOR = '\n\n---\n\n';
const sections = KNOWLEDGE_BASE.split(SECTION_SEPARATOR).map((text) => {
  const heading = (text.split('\n')[0] || '').replace(/^# (?:Page|Source):\s*/, '');
  return { heading, text, search: `${heading} ${text}`.toLowerCase() };
});

// This stable prefix remains identical across requests and large enough for
// Haiku prompt caching. It covers identity, the overall model, and every PDF.
const CORE_HEADINGS = [
  "VillageServer Initiative — Sharing the Gospel with Today's Technology (index.html)",
  'Full Initiative Overview (initiative.html)',
  'downloads.md',
];
const coreSet = new Set(CORE_HEADINGS);
export const CORE_KNOWLEDGE = sections.filter((s) => coreSet.has(s.heading)).map((s) => s.text).join(SECTION_SEPARATOR);

const STOP_WORDS = new Set('a an and are as at be but by can could do does for from give have help how i in into is it link me my need of on or our please tell that the their they this to want what when where which who why will with you your'.split(' '));
const EXPANSIONS = {
  dish: ['satellite'], lnb: ['satellite'], receiver: ['satellite'], broadcast: ['satellite'],
  solar: ['power'], battery: ['power'], electricity: ['power'], charger: ['power'],
  pi: ['raspberry'], wifi: ['raspberry'], server: ['raspberry'], hotspot: ['raspberry'],
  android: ['phone', 'transfer'], iphone: ['phone', 'transfer'], airdrop: ['phone', 'transfer'],
  quickshare: ['phone', 'transfer'], localsend: ['phone', 'transfer'], copy: ['transfer'],
  bible: ['scripture', 'content', 'library'], bibles: ['scripture', 'content', 'library'],
  language: ['content', 'library'], audio: ['content', 'library'], film: ['content', 'library'],
  apply: ['application', 'equipment', 'funding'], applying: ['application', 'equipment', 'funding'],
  grant: ['application', 'funding'], cost: ['kit', 'tier'], price: ['kit', 'tier'],
  pdf: ['printable', 'download'], pamphlet: ['printable', 'download'],
};

const ROUTES = [
  { match: /satellite|\bdish\b|\blnb\b|receiver|broadcast/, heading: /Satellite Systems/ },
  { match: /solar|battery|electricity|charger|\bpower\b/, heading: /Power Systems/ },
  { match: /raspberry|\bpi\b|wi-?fi|hotspot|offline server/, heading: /Raspberry Pi VillageServer/ },
  { match: /android|iphone|airdrop|quick\s*share|localsend|transfer|copy .*phone/, heading: /Transfer Resources/ },
  { match: /bible|scripture|language|audio|gospel film|content librar/, heading: /Content Libraries/ },
  { match: /apply|application|funding|grant|need equipment/, heading: /Field Configurations|Programs and Services/ },
  { match: /projector|speaker|screening|audio system/, heading: /Projector Systems/ },
  { match: /share|distribution|micro\s*sd|usb/, heading: /Get and Share|Phone-Based|Sharing the Library/ },
];

function queryTerms(query) {
  const base = String(query || '').toLowerCase().match(/[a-z0-9]+/g) || [];
  const terms = new Set(base.filter((word) => word.length > 1 && !STOP_WORDS.has(word)));
  for (const word of [...terms]) for (const extra of EXPANSIONS[word] || []) terms.add(extra);
  return [...terms];
}

function occurrences(text, term) {
  let count = 0;
  let from = 0;
  while (count < 6) {
    const at = text.indexOf(term, from);
    if (at === -1) break;
    count += 1;
    from = at + term.length;
  }
  return count;
}

export function retrieveKnowledge(query, maxSections = 2) {
  const normalizedQuery = String(query || '').toLowerCase();
  const terms = queryTerms(query);
  if (!terms.length) return '';
  const ranked = sections.filter((s) => !coreSet.has(s.heading) && s.text.length > 300).map((section) => {
    const title = section.heading.toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (title.includes(term)) score += 12;
      score += Math.min(occurrences(section.search, term), 5);
    }
    for (const route of ROUTES) if (route.match.test(normalizedQuery) && route.heading.test(section.heading)) score += 50;
    return { ...section, score };
  }).filter((s) => s.score > 0).sort((a, b) => b.score - a.score || a.text.length - b.text.length);

  if (!ranked.length || ranked[0].score < 3) return '';
  const chosen = [ranked[0]];
  if (maxSections > 1 && ranked[1] && ranked[1].score >= Math.max(5, ranked[0].score * 0.65)) chosen.push(ranked[1]);
  return chosen.slice(0, maxSections).map((s) => s.text).join(SECTION_SEPARATOR);
}
