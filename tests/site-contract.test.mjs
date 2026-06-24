import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pages = ['landing/index.html', 'landing/index-b.html'];

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8');
}

test('Vercel publishes the landing directory as the static site root', () => {
  const configPath = join(root, 'vercel.json');
  assert.ok(existsSync(configPath), 'vercel.json must exist at the repository root');

  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.equal(config.outputDirectory, 'landing');
  assert.equal(config.cleanUrls, true);
});

test('the shared stylesheet exposes the spacing and typography system', () => {
  const css = read('landing/css/base.css');
  assert.match(css, /--space-section:/);
  assert.match(css, /--measure-copy:/);
  assert.match(css, /--text-body:/);
  assert.match(css, /--nav-height:/);
  assert.match(css, /--leaf:/);
  assert.match(css, /--ochre:/);
  assert.match(css, /--radius-ui:/);
  assert.doesNotMatch(css, /JOURNEY PROGRESS|\.journey|\.caravan|--journey-/);
  assert.match(css, /\.site-header\{position:relative;top:auto\}/);
});

test('the access resource teaches every supported access path', () => {
  const html = read('landing/access.html');
  assert.match(html, /VillageServer Wi-Fi/);
  assert.match(html, /microSD card/);
  assert.match(html, /USB drive/);
  assert.match(html, /Android/);
  assert.match(html, /iPhone or iPad/);
  assert.match(html, /Quick Share/);
  assert.match(html, /AirDrop/);
  assert.match(html, /airplane mode/i);
  assert.match(html, /transfer\.html#ios-android/);
  for (const id of ['choose-path', 'phone-storage', 'share-nearby']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /aria-label="Access steps"/);
});

test('the transfer center covers every device-to-device route', () => {
  const html = read('landing/transfer.html');
  for (const id of ['phone-phone', 'ios-android', 'computer-phone', 'card-phone']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const method of ['LocalSend', 'Quick Share', 'AirDrop', 'Apple Devices', 'Finder', 'USB', 'microSD']) {
    assert.match(html, new RegExp(method));
  }
  assert.match(html, /Android → Android/);
  assert.match(html, /iPhone → iPhone/);
  assert.match(html, /iPhone ↔ Android/);
  assert.match(html, /Windows → Android/);
  assert.match(html, /Mac → iPhone/);
  assert.match(html, /\.\/js\/site-language\.js/);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  for (const [, source] of scripts) new Function(source);
});

test('the missionary pamphlet library exposes every printable field route', () => {
  const html = read('landing/pamphlets.html');
  const files = [
    'villageserver-initiative-overview.pdf',
    'villageserver-transfer-iphone-to-iphone.pdf',
    'villageserver-transfer-android-to-android.pdf',
    'villageserver-transfer-iphone-to-android.pdf',
    'villageserver-transfer-android-to-iphone.pdf',
    'villageserver-transfer-computer-to-phone.pdf',
    'villageserver-transfer-microsd-to-phone.pdf',
  ];
  for (const file of files) {
    assert.match(html, new RegExp(`\\./downloads/${file.replaceAll('.', '\\.')}"`));
    assert.ok(existsSync(join(root, 'landing/downloads', file)), `${file} should be deployed`);
    assert.ok(existsSync(join(root, 'output/pdf', file)), `${file} should be retained as a final PDF`);
  }
  assert.match(html, /Missionary field FAQ/);
  assert.match(html, /LocalSend/);
  assert.match(html, /Quick Share/);
  assert.match(html, /AirDrop/);
  assert.match(html, /field-faq details/);
  assert.match(read('landing/index.html'), /\.\/pamphlets\.html/);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  for (const [, source] of scripts) new Function(source);
});

test('the homepage follows a simpler mission-first consumer journey', () => {
  const html = read('landing/index.html');
  for (const id of ['initiative', 'availability', 'setup', 'system']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.ok(html.indexOf('id="initiative"') < html.indexOf('id="availability"'));
  assert.ok(html.indexOf('id="availability"') < html.indexOf('id="setup"'));
  assert.ok(html.indexOf('id="setup"') < html.indexOf('id="system"'));
  assert.match(html, /Spreading the gospel where internet cannot reach/);
  assert.match(html, /id="mission"/);
  assert.match(html, /Mission statement/);
  assert.match(html, /simple-journey/);
  assert.match(html, /Power in\. Gospel library out\./);
  assert.match(html, /class="pi-model"/);
  assert.doesNotMatch(html, /I already have a kit/);
  assert.match(html, /Can I order a kit near me\?/);
  assert.match(html, /not yet available through public online checkout/i);
});

test('stacked homepage sections keep links and gift amounts inside their backgrounds', () => {
  const css = read('landing/css/home.css');
  assert.match(css, /\.split-story,\.availability-grid,\.step-heading\{gap:40px\}/);
  assert.match(css, /\.support-card\{gap:30px;padding:34px 26px\}/);
  assert.match(css, /\.support-list span\{min-width:0;overflow-wrap:anywhere/);
});

test('the homepage can fully localize into major field languages', () => {
  const html = read('landing/index.html');
  const i18n = read('landing/js/i18n.js');
  assert.match(html, /id="language-select"/);
  for (const language of ['en', 'fr', 'sw', 'es', 'hi', 'ne', 'bn']) {
    assert.match(html, new RegExp(`<option value="${language}">`));
    assert.match(i18n, new RegExp(`(?:const ${language}=|${language}:\\{)`));
  }
  for (const translatedLanguage of ['ur', 'sd']) assert.match(html, new RegExp(`<option value="${translatedLanguage}">`));
  assert.match(i18n, /localStorage\.setItem\('vsi-language'/);
  assert.match(i18n, /vsi:languagechange/);
  assert.match(i18n, /setupLocal/);
  assert.match(i18n, /availability\(region\)/);
  new Function(i18n);
});

test('language choice persists across every public page and dynamic UI', () => {
  const languageScript = read('landing/js/site-language.js');
  for (const page of ['landing/index.html', 'landing/index-b.html', 'landing/initiative.html', 'landing/access.html', 'landing/guide.html', 'landing/donate.html', 'landing/transfer.html', 'landing/pamphlets.html']) {
    assert.match(read(page), /\.\/js\/site-language\.js/);
  }
  for (const language of ['en', 'fr', 'sw', 'es', 'hi', 'ur', 'sd', 'ne', 'bn']) {
    assert.match(languageScript, new RegExp("\\['" + language + "',"));
  }
  assert.match(languageScript, /localStorage\.setItem\('vsi-language'/);
  assert.match(languageScript, /googtrans/);
  assert.match(languageScript, /window\.location\.reload/);
  assert.match(languageScript, /Mutation|later popup|newly opened|every later popup/i);
  new Function(languageScript);
});

test('every public page records a fresh visit for live admin analytics', () => {
  const trackedPages = ['landing/index.html', 'landing/index-b.html', 'landing/initiative.html', 'landing/access.html', 'landing/guide.html', 'landing/donate.html', 'landing/transfer.html', 'landing/pamphlets.html'];
  for (const page of trackedPages) assert.match(read(page), /\.\/js\/site-tracking\.js/);
  const tracker = read('landing/js/site-tracking.js');
  assert.match(tracker, /type=visit/);
  assert.match(tracker, /cache: 'no-store'/);
  assert.match(tracker, /keepalive: true/);
  assert.match(tracker, /location\.pathname/);
  assert.match(tracker, /site_host/);
  assert.match(tracker, /location\.hostname/);
  assert.match(tracker, /data-visit-tracked/);
  new Function(tracker);
  assert.doesNotMatch(read('landing/index.html'), /Home-page visit logging/);
  assert.doesNotMatch(read('landing/donate.html'), /Object\.assign\(\{path:'\/donate'/);
  assert.match(read('api/content.js'), /Cache-Control', 'no-store/);
  assert.match(read('api/track.js'), /Cache-Control', 'no-store/);
});

test('the setup widget launches a focused guide for every component', () => {
  const html = read('landing/index.html');
  assert.ok(existsSync(join(root, 'landing/guide.html')));
  for (const part of ['wifi', 'pi', 'microsd', 'usb', 'solar', 'projector', 'charging', 'satellite']) {
    assert.match(html, new RegExp(`data-setup="${part}"`));
    assert.match(html, new RegExp(`${part}:\\{`));
  }
  assert.match(html, /id="setup-preview"|class="setup-preview"/);
});

test('the setup guide contains complete data and valid behavior for every path', () => {
  const html = read('landing/guide.html');
  for (const part of ['wifi', 'pi', 'microsd', 'usb', 'solar', 'projector', 'charging', 'satellite']) {
    assert.match(html, new RegExp(`\\n\\s+${part}: \\{`));
    assert.match(html, new RegExp(`data-guide-link="${part}"`));
  }
  assert.match(html, /Bring these items/);
  assert.match(html, /How you know it worked/);
  assert.match(html, /Try these first/);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  for (const [, source] of scripts) new Function(source);
});

test('deep content is split into resource pages and old campaign branding is gone', () => {
  const html = read('landing/index.html');
  assert.doesNotMatch(html, /Give a Bible|\$7 answers|Spring Uganda/i);
  for (const page of ['landing/initiative.html', 'landing/access.html', 'landing/guide.html']) {
    assert.ok(existsSync(join(root, page)), `${page} should exist`);
  }
  assert.match(html, /Shorter pages\. Clearer jobs\./);
});

test('kit requests preserve itemized equipment choices end to end', () => {
  const html = read('landing/index.html');
  const api = read('api/track.js');
  const schema = read('supabase/schema.sql');
  const admin = read('landing/admin.html');
  for (const item of ['VillageServer core', 'Language microSD', 'USB library', 'Projector', 'Solar power', 'Satellite kit', 'Phone charging']) assert.match(html, new RegExp(item));
  for (const partner of ['store.dbs.org', 'projectbiblerunners.com', 'techsoup.org']) assert.match(html, new RegExp(partner.replaceAll('.', '\\.')));
  assert.match(html, /requested_items:items/);
  assert.match(api, /requested_items: cleanItems/);
  assert.match(schema, /requested_items jsonb/);
  assert.match(admin, /Requested kit/);
});

test('initiative checklist content is present and honest about launch status', () => {
  const initiative = read('landing/initiative.html');
  const donate = read('landing/donate.html');
  const api = read('api/content.js');
  assert.match(initiative, /VillageServer Initiative is a portable technology project designed/);
  assert.match(initiative, /href="#mission">Read the mission statement/);
  assert.match(initiative, /id="mission"/);
  assert.match(initiative, /Four simple steps people can understand fast/);
  assert.match(initiative, /Raspberry Pi 5 · 4GB/);
  assert.match(initiative, /Proof of concept/);
  assert.match(initiative, /Project Bible Runners/);
  assert.match(initiative, /Digital Bible Society/);
  assert.match(initiative, /new Set/);
  assert.match(initiative, /Formation is being prepared—not claimed/);
  assert.match(donate, /data-val="Kenya"/);
  assert.match(donate, /data-val="VillageServer Initiative"/);
  assert.match(donate, /data-val="Project Bible Runners"/);
  assert.match(donate, /data-val="Digital Bible Society"/);
  assert.match(donate, /data-val="Language microSD"/);
  assert.match(api, /affiliates: true/);
  assert.ok(existsSync(join(root, 'landing/img/villageserver-initiative-logo.webp')));
  assert.ok(existsSync(join(root, 'docs/vermont-nonprofit-readiness.md')));
  assert.ok(existsSync(join(root, 'docs/domain-setup.md')));
});

test('admin includes an accurate traffic-attribution FAQ', () => {
  const admin = read('landing/admin.html');
  const trackApi = read('api/track.js');
  const schema = read('supabase/schema.sql');
  assert.match(admin, /id="tab-overview"/);
  assert.match(admin, /Local preview mode/);
  assert.match(admin, /IS_LOCAL_PREVIEW/);
  assert.match(admin, /PREVIEW_STORE/);
  assert.match(admin, /Everything the initiative needs in one place/);
  assert.match(admin, /Open copy-paste schema/);
  assert.match(admin, /POLL_INTERVAL_MS = 4000/);
  assert.match(admin, /setInterval\(pollActiveTab, POLL_INTERVAL_MS\)/);
  assert.match(admin, /project-bible-runners-site\.vercel\.app/);
  assert.match(admin, /villageserver\.com \+ villageserver\.org/);
  assert.match(admin, /function setLiveHtml/);
  assert.match(admin, /COM \+ ORG/);
  assert.match(trackApi, /site_host/);
  assert.match(schema, /site_host text/);
  assert.match(admin, /&_ts=' \+ Date\.now\(\)/);
  assert.match(admin, /cache:'no-store'/);
  assert.match(admin, /visibilitychange/);
  assert.match(admin, /form-panel\.open/);
  assert.match(admin, /does not inspect packets/);
  assert.match(admin, /data-tab="analyticsfaq"/);
  assert.match(admin, /id="tab-analyticsfaq"/);
  assert.match(admin, /this is not packet scraping/i);
  assert.match(admin, /utm_source/);
  assert.match(admin, /fbclid/);
  assert.match(admin, /ttclid/);
  assert.match(admin, /document\.referrer/);
  assert.match(admin, /Network packet payloads/);
  assert.match(admin, /Direct \/ Unknown/);
  const scripts = [...admin.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  for (const [, source] of scripts) new Function(source);
});

for (const page of pages) {
  test(`${page} uses the logo as the high-priority hero visual`, () => {
    const html = read(page);
    assert.match(html, /<img[^>]+class="hero-logo-art"[^>]+src="\.\/img\/villageserver-initiative-logo\.webp"/s);
    assert.match(html, /<img[^>]+class="hero-logo-art"[^>]+fetchpriority="high"/s);
    assert.match(html, /<img[^>]+class="hero-logo-art"[^>]+width="1254"[^>]+height="1254"/s);
    assert.doesNotMatch(html, /class="hero-media"[^>]+hero-field\.webp/s);
    assert.doesNotMatch(html, /new Image\(\)/);
    assert.doesNotMatch(html, /data:image|var lqip=/);
    assert.match(html, /<svg[^>]+class="hero-wave"[^>]+aria-hidden="true"/s);
  });

  test(`${page} uses portable local asset URLs and every asset exists`, () => {
    const html = read(page);
    const assetMatches = [...html.matchAll(/(?:src|href)="(\.\/(?:img|css)\/[^"?#]+)"/g)];
    assert.ok(assetMatches.length >= 6, 'expected local image and stylesheet references');
    assert.doesNotMatch(html, /(?:src|href)="(?:img|css)\//);

    for (const [, assetPath] of assetMatches) {
      const diskPath = join(root, dirname(page), assetPath);
      assert.ok(existsSync(diskPath), `${page} references missing asset ${assetPath}`);
    }
  });

  test(`${page} removes the temporary caravan journey concept`, () => {
    const html = read(page);
    assert.doesNotMatch(html, /JOURNEY PROGRESS|journeyProgress|journey-dunes|class="caravan"|updateJourneyProgress|--journey-progress/);
  });

  test(`${page} keeps presentation in stylesheets instead of inline rules`, () => {
    const html = read(page);
    assert.doesNotMatch(html, /\sstyle="/);
    assert.doesNotMatch(html, /^\s*\+/m, 'patch markers must never leak into rendered text or scripts');
  });

  test(`${page} contains valid inline JavaScript`, () => {
    const html = read(page);
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    assert.ok(scripts.length > 0, 'expected an inline behavior script');
    for (const [, source] of scripts) new Function(source);
  });
}
