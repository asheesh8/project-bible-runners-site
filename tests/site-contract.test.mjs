import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pages = ['landing/index.html', 'landing/index-b.html'];
const topicPages = [
  'landing/mission.html',
  'landing/about.html',
  'landing/programs.html',
  'landing/visuals.html',
  'landing/testimonials.html',
  'landing/phone-distribution.html',
  'landing/raspberry-pi.html',
  'landing/power.html',
  'landing/satellite.html',
  'landing/sharing-library.html',
  'landing/projector-media.html',
  'landing/kit-levels.html',
  'landing/rollout.html',
  'landing/custom-libraries.html',
  'landing/affiliates.html',
  'landing/field-faq.html',
];
const homepageResourcePages = [
  'mission.html',
  'about.html',
  'programs.html',
  'visuals.html',
  'testimonials.html',
  'phone-distribution.html',
  'raspberry-pi.html',
  'power.html',
  'projector-media.html',
  'satellite.html',
  'custom-libraries.html',
  'affiliates.html',
];

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
  assert.match(html, /phone-transfer-visual\.svg/);
  assert.match(html, /class="method-grid"/);
  assert.match(html, /iPhone ↔ Android/);
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
  assert.match(html, /phone-transfer-visual\.svg/);
  assert.match(html, /transfer-method-pills/);
  assert.match(html, /method-priority/);
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

test('the homepage is a clean blue, mission-first resource directory', () => {
  const html = read('landing/index.html');
  assert.match(html, /id="top"/);
  assert.match(html, /id="resources"/);
  assert.match(html, /VillageServer Initiative/);
  assert.match(html, /Using technology to help place God's Word/);
  assert.match(html, /Mission Statement/);
  assert.match(html, /Raspberry Pi VillageServer System/);
  assert.match(html, /Ministry Resource Partners/);
  assert.match(html, /class="vs-hero"/);
  assert.match(html, /class="vs-link-band"/);
  assert.match(html, /class="vs-tech-strip"/);
  assert.match(html, /class="vs-hero-logo"/);
  assert.match(html, /class="vs-hero-tools"/);
  assert.match(html, /class="vs-logo-button"/);
  assert.match(html, /id="logo-modal"/);
  assert.match(html, /id="language-select"/);
  assert.doesNotMatch(html, /class="vs-top"|class="site-header"|class="site-nav"|class="menu-button"|class="language-bar"/);
  assert.doesNotMatch(html, /I already have a kit/);
  assert.doesNotMatch(html, /id="availability"|id="setup"|setup-widget|kit-modal|open-kit-form|model-hotspot|setup-model-object|kit-3d-stage|hero-proof-panel|tech-card-grid/);
  assert.match(html, /\.\/kit-levels\.html/);
});

test('homepage blue layout stays compact and grouped', () => {
  const html = read('landing/index.html');
  assert.match(html, /--vs-blue:#1e4f8c/);
  assert.match(html, /--vs-blue-d:#163e70/);
  assert.match(html, /\.vs-sections\{background:#f7fbff/);
  assert.match(html, /\.vs-link-band\{max-width:1180px;margin:0 auto;display:flex;flex-wrap:wrap;justify-content:center/);
  assert.match(html, /@media\(max-width:560px\)\{\.vs-link-band\{gap:2px\}/);
  assert.doesNotMatch(html, /<header[\s\S]*?<\/header>/);
});

test('homepage resource directory links to the focused topic pages without visual clutter', () => {
  const html = read('landing/index.html');
  assert.match(html, /class="vs-link-band"/);
  assert.ok(existsSync(join(root, 'landing/img/villageserver-initiative-logo.webp')));
  assert.match(html, /class="vs-tech-strip"/);
  assert.ok(html.indexOf('class="vs-sections"') < html.indexOf('class="vs-tech-strip"'), 'picture cards should sit below the white link band');
  for (const asset of ['kit-pi.webp', 'dish.webp', 'projector.webp', 'solar-field.webp']) {
    assert.match(html, new RegExp(`\\./img/${asset}`));
    assert.ok(existsSync(join(root, 'landing/img', asset)), `${asset} should exist for homepage tech photos`);
  }
  const directory = html.match(/<section class="vs-sections"[\s\S]*?<\/section>/)?.[0] || '';
  assert.equal([...directory.matchAll(/<a href="\.\/[a-z0-9-]+\.html"/g)].length, homepageResourcePages.length);
  for (const page of homepageResourcePages) {
    const href = `./${page}`;
    assert.match(html, new RegExp(`href="${href.replace('.', '\\.')}"`));
    assert.ok(existsSync(join(root, 'landing', page)), `${page} should exist`);
  }
  assert.match(read('landing/satellite.html'), /Satellite adds a live link/);
  assert.match(read('landing/mission.html'), /Carry the gospel where access is limited/);
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
  for (const page of ['landing/index.html', 'landing/index-b.html', 'landing/initiative.html', 'landing/access.html', 'landing/guide.html', 'landing/transfer.html', 'landing/pamphlets.html', ...topicPages]) {
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
  const trackedPages = ['landing/index.html', 'landing/index-b.html', 'landing/initiative.html', 'landing/access.html', 'landing/guide.html', 'landing/transfer.html', 'landing/pamphlets.html', ...topicPages];
  for (const page of trackedPages) assert.match(read(page), /\.\/js\/site-tracking\.js/);
  const tracker = read('landing/js/site-tracking.js');
  assert.match(tracker, /type=visit/);
  assert.match(tracker, /cache: 'no-store'/);
  assert.match(tracker, /keepalive: true/);
  assert.match(tracker, /vsi-visitor-id/);
  assert.match(tracker, /visitor_id: getVisitorId\(\)/);
  assert.match(tracker, /location\.pathname/);
  assert.match(tracker, /site_host/);
  assert.match(tracker, /location\.hostname/);
  assert.match(tracker, /data-visit-tracked/);
  new Function(tracker);
  assert.doesNotMatch(read('landing/index.html'), /Home-page visit logging/);
  assert.match(read('api/content.js'), /Cache-Control', 'no-store/);
  assert.match(read('api/track.js'), /Cache-Control', 'no-store/);
  assert.match(read('api/track.js'), /visitor_id/);
  assert.match(read('supabase/schema.sql'), /visitor_id text/);
  assert.match(read('supabase/schema.sql'), /page_visits_visitor_id_idx/);
});

test('the homepage links out instead of embedding the setup widget', () => {
  const html = read('landing/index.html');
  assert.ok(existsSync(join(root, 'landing/guide.html')));
  assert.match(html, /\.\/guide\.html\?part=wifi/);
  for (const page of ['mission.html', 'phone-distribution.html', 'raspberry-pi.html', 'power.html', 'projector-media.html', 'satellite.html', 'kit-levels.html']) {
    assert.match(html, new RegExp(`\\./${page}`));
  }
  assert.doesNotMatch(html, /data-setup=|id="setup-model"|function paintSetupModel|const setupData/);
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

test('public links do not point to removed homepage sections', () => {
  const publicPages = ['landing/index.html', 'landing/index-b.html', 'landing/initiative.html', 'landing/access.html', 'landing/guide.html', 'landing/transfer.html', 'landing/pamphlets.html', ...topicPages];
  for (const page of publicPages) {
    const html = read(page);
    assert.doesNotMatch(html, /index\.html#(?:setup|availability|choose)/, `${page} should link to focused guide/resource pages instead of removed homepage sections`);
    assert.doesNotMatch(html, /main setup widget|Open setup widget|Choose another setup/i, `${page} should not mention the removed homepage setup widget`);
  }
});

test('deep content is split into resource pages and old campaign branding is gone', () => {
  const html = read('landing/index.html');
  assert.doesNotMatch(html, /Give a Bible|\$7 answers|Spring Uganda/i);
  assert.doesNotMatch(html, /donate\.html|Fund the mission|Give now|Support the work/i);
  for (const page of ['landing/initiative.html', 'landing/access.html', 'landing/guide.html']) {
    assert.ok(existsSync(join(root, page)), `${page} should exist`);
  }
  assert.equal(existsSync(join(root, 'landing/donate.html')), false, 'donation page should be out of the public bundle');
  assert.match(html, /VillageServer Initiative/);
  assert.match(html, /Mission Statement/);
  assert.match(html, /Phone-Based Gospel Distribution/);
  assert.match(html, /Ministry Resource Partners/);
  assert.doesNotMatch(html, /Where will the kit be used\?|Choose one item\. The widget/);
});

test('kit planning is linked out while the backend still supports itemized requests', () => {
  const html = read('landing/index.html');
  const api = read('api/track.js');
  const schema = read('supabase/schema.sql');
  const admin = read('landing/admin.html');
  const kitLevels = read('landing/kit-levels.html');
  assert.match(html, /\.\/kit-levels\.html/);
  for (const item of ['Basic Kit', 'Media Kit', 'Power Kit', 'Community Access Kit', 'Satellite-Enabled Kit']) assert.match(kitLevels, new RegExp(item));
  assert.doesNotMatch(html, /kit-modal|kit-product|requested_items:items/);
  assert.match(api, /requested_items: cleanItems/);
  assert.match(schema, /requested_items jsonb/);
  assert.match(admin, /Requested kit/);
});

test('initiative checklist content is present and honest about launch status', () => {
  const initiative = read('landing/initiative.html');
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
  assert.match(initiative, /Open the field setup guides/);
  assert.doesNotMatch(initiative, /donate\.html/);
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
  assert.match(admin, /Individual People/);
  assert.match(admin, /Total Page Visits/);
  assert.match(admin, /uniqueVisitorCount/);
  assert.match(admin, /visitorBreakdown/);
  assert.match(admin, /visitor_id/);
  assert.match(admin, /'Person ' \+ \(next\+\+\)/);
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
    assert.match(html, /<img[^>]+class="vs-hero-logo"[^>]+src="\.\/img\/villageserver-initiative-logo\.webp"/s);
    assert.match(html, /<img[^>]+class="vs-hero-logo"[^>]+fetchpriority="high"/s);
    assert.match(html, /<img[^>]+class="vs-hero-logo"[^>]+width="1254"[^>]+height="1254"/s);
    assert.doesNotMatch(html, /class="hero-media"[^>]+hero-field\.webp/s);
    assert.doesNotMatch(html, /new Image\(\)/);
    assert.doesNotMatch(html, /data:image|var lqip=/);
    assert.doesNotMatch(html, /<svg[^>]+class="hero-wave"/s);
  });

  test(`${page} uses portable local asset URLs and every asset exists`, () => {
    const html = read(page);
    const assetMatches = [...html.matchAll(/(?:src|href)="(\.\/(?:img|css)\/[^"?#]+)(?:\?[^"]*)?"/g)];
    assert.ok(assetMatches.length >= 3, 'expected local image and stylesheet references');
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
