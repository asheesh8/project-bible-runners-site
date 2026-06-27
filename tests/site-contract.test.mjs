import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const homePages = ['landing/index.html', 'landing/index-b.html'];
const boardPages = [
  'landing/mission.html',
  'landing/initiative.html',
  'landing/about.html',
  'landing/programs.html',
  'landing/visuals.html',
  'landing/testimonials.html',
  'landing/phone-distribution.html',
  'landing/raspberry-pi.html',
  'landing/power.html',
  'landing/projector-media.html',
  'landing/custom-libraries.html',
  'landing/satellite.html',
  'landing/affiliates.html',
  'landing/access.html',
  'landing/transfer.html',
  'landing/sharing-library.html',
  'landing/guide.html',
  'landing/pamphlets.html',
  'landing/kit-levels.html',
  'landing/rollout.html',
  'landing/field-faq.html',
];
const publicPages = [...homePages, ...boardPages];

const directoryPages = [
  'mission.html',
  'initiative.html',
  'about.html',
  'programs.html',
  'visuals.html',
  'testimonials.html',
  'phone-distribution.html',
  'raspberry-pi.html',
  'power.html',
  'projector-media.html',
  'custom-libraries.html',
  'satellite.html',
  'affiliates.html',
  'access.html',
  'transfer.html',
  'sharing-library.html',
  'guide.html',
  'pamphlets.html',
  'kit-levels.html',
  'rollout.html',
  'field-faq.html',
];

const topicPdfs = [
  'villageserver-mission-statement.pdf',
  'villageserver-initiative-overview.pdf',
  'villageserver-about-us.pdf',
  'villageserver-programs-and-services.pdf',
  'villageserver-photos-and-visuals.pdf',
  'villageserver-testimonials.pdf',
  'villageserver-phone-based-gospel-distribution.pdf',
  'villageserver-raspberry-pi-system.pdf',
  'villageserver-power-and-solar.pdf',
  'villageserver-projector-and-audio.pdf',
  'villageserver-custom-libraries.pdf',
  'villageserver-satellite-systems.pdf',
  'villageserver-ministry-partners.pdf',
  'villageserver-get-and-share-resources.pdf',
  'villageserver-transfer-resources-between-devices.pdf',
  'villageserver-sharing-the-library.pdf',
  'villageserver-setup-guide.pdf',
  'villageserver-printable-pamphlets-and-field-faq.pdf',
  'villageserver-kit-levels-and-costs.pdf',
  'villageserver-rollout-and-reach.pdf',
  'villageserver-field-faq.pdf',
];

const routePdfs = [
  'villageserver-transfer-iphone-to-iphone.pdf',
  'villageserver-transfer-android-to-android.pdf',
  'villageserver-transfer-iphone-to-android.pdf',
  'villageserver-transfer-android-to-iphone.pdf',
  'villageserver-transfer-computer-to-phone.pdf',
  'villageserver-transfer-microsd-to-phone.pdf',
];
const allPdfs = [...topicPdfs, ...routePdfs];

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function inlineScripts(html) {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
}

test('Vercel publishes the landing directory as the static site root', () => {
  const configPath = join(root, 'vercel.json');
  assert.ok(existsSync(configPath), 'vercel.json must exist at the repository root');

  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.equal(config.outputDirectory, 'landing');
  assert.equal(config.cleanUrls, true);
});

test('the board stylesheet protects the older-reader design system', () => {
  const css = read('landing/css/board.css');
  assert.match(css, /--blue:#1f5795/);
  assert.match(css, /body\{[^}]*font-size:18px/);
  assert.match(css, /\.visually-hidden/);
  assert.match(css, /\.home-hero/);
  assert.match(css, /\.white-band/);
  assert.match(css, /\.link-band/);
  assert.match(css, /\.photo-row/);
  assert.match(css, /logoSweep/);
  assert.doesNotMatch(css, /logoAura/);
  assert.match(css, /width:clamp\(160px,15vw,230px\)/);
  assert.match(css, /\.test-run-section/);
  assert.match(css, /\.test-run-media/);
  assert.match(css, /\.board-hero/);
  assert.match(css, /\.pdf-button/);
  assert.match(css, /\.side-card/);
  assert.match(css, /\.article-body/);
  assert.match(css, /\.article-lead/);
  assert.match(css, /\.article-steps/);
  assert.match(css, /\.article-bullets/);
  assert.match(css, /\.fig-full/);
  assert.match(css, /\.side-list/);
  assert.match(css, /@media\(max-width:560px\)/);
  assert.doesNotMatch(css, /JOURNEY PROGRESS|\.journey|\.caravan|--journey-|model-hotspot|setup-widget/);
});

test('the homepage is a simple blue and white directory with photos below the links', () => {
  for (const page of homePages) {
    const html = read(page);
    assert.match(html, /class="home-hero"/);
    assert.match(html, /class="white-band"/);
    assert.match(html, /class="[^"]*\blink-band\b[^"]*"/);
    assert.match(html, /class="photo-row"/);
    assert.match(html, /class="[^"]*\bphoto-grid\b[^"]*"/);
    assert.match(html, /class="logo-modal"/);
    assert.match(html, /id="language-select"/);
    assert.match(html, /VillageServer Initiative/);
    assert.match(html, /<h1 class="visually-hidden">VillageServer Initiative<\/h1>/);
    assert.match(html, /aria-label="Open enlarged VillageServer Initiative logo"/);
    assert.doesNotMatch(html, /logo-hint|Click logo to enlarge/i);
    assert.match(html, /Using technology to help place God's Word/);
    assert.doesNotMatch(html, /class="home-actions"/);
    assert.match(html, /class="test-run-section"/);
    assert.match(html, /test-run-setup\.mp4/);
    assert.match(html, /The team setting up the kit/);
    assert.ok(html.indexOf('class="white-band"') < html.indexOf('class="photo-row"'), `${page} should put pictures below the white link band`);
    assert.doesNotMatch(html, /<header[\s\S]*?<\/header>/);
    assert.doesNotMatch(html, /class="site-header"|class="site-nav"|class="menu-button"|class="vs-top"|I already have a kit/);
    assert.doesNotMatch(html, /id="setup"|id="availability"|setup-widget|kit-modal|model-hotspot|tech-card-grid|hero-proof-panel/);
    assert.doesNotMatch(html, /donate\.html|Fund the mission|Give now|Support the work|Give a Bible|Spring Uganda/i);
  }
});

test('the homepage directory exposes every public informational page', () => {
  const html = read('landing/index.html');
  const directory = html.match(/<section class="white-band"[\s\S]*?<\/section>/)?.[0] || '';
  assert.equal([...directory.matchAll(/<a href="\.\/[a-z0-9-]+\.html"/g)].length, directoryPages.length);

  for (const page of directoryPages) {
    assert.match(directory, new RegExp(`href="\\./${escapeRegExp(page)}"`));
    assert.ok(existsSync(join(root, 'landing', page)), `${page} should exist`);
  }

  for (const asset of ['villageserver-case-usb-readers.jpeg', 'satellite-lnb-retrofit.jpeg', 'projector.webp', 'solar-field.webp']) {
    assert.match(html, new RegExp(`\\./img/${asset}`));
    assert.ok(existsSync(join(root, 'landing/img', asset)), `${asset} should exist for homepage technology photos`);
  }

  for (const asset of ['test-run-video-poster.jpeg', 'test-run-table.jpeg', 'test-run-solar.jpeg', 'test-run-workshop.jpeg', 'test-run-satellite.jpeg']) {
    assert.match(html, new RegExp(`\\./img/${asset}`));
    assert.ok(existsSync(join(root, 'landing/img', asset)), `${asset} should exist for the field test run section`);
  }
  assert.match(html, /\.\/media\/test-run-setup\.mp4/);
  assert.ok(existsSync(join(root, 'landing/media/test-run-setup.mp4')), 'test run video should be deployed');
});

test('every informational page follows the same short blog-style board template', () => {
  const removedPatterns = /page-jumps|tabset|data-tab=|setup-widget|kit-modal|model-hotspot|tech-card-grid|journey|caravan|donate\.html|Fund the mission|Give now|Support the work|Give a Bible|Spring Uganda|I already have a kit/i;

  for (const page of boardPages) {
    const html = read(page);
    assert.match(html, /<link rel="stylesheet" href="\.\/css\/board\.css\?v=2">/, `${page} should use the board article stylesheet`);
    assert.match(html, /class="board-top"/, `${page} should have a simple top bar`);
    assert.match(html, /class="board-hero"/, `${page} should have a short page hero`);
    assert.match(html, /class="article-body"/, `${page} should use the blog-style article layout`);
    assert.match(html, /class="article-lead"/, `${page} should open with a readable lead`);
    assert.match(html, /class="article-steps"/, `${page} should include field steps`);
    assert.ok([...html.matchAll(/<li><div><strong>/g)].length >= 4, `${page} should include at least four field steps`);
    assert.match(html, /class="fig-full"/, `${page} should include a main supporting image`);
    assert.match(html, /class="side-card"/, `${page} should have a visual summary card`);
    assert.match(html, /class="side-list"/, `${page} should summarize key points`);
    const pdfMatch = html.match(/<a class="pdf-button" href="\.\/downloads\/([^"]+\.pdf)" download>[^<]*PDF<\/a>/);
    assert.ok(pdfMatch, `${page} should have a primary PDF download`);
    assert.ok(existsSync(join(root, 'landing/downloads', pdfMatch[1])), `${page} should reference a deployed PDF`);
    assert.ok(existsSync(join(root, 'output/pdf', pdfMatch[1])), `${page} should retain the source PDF`);
    assert.match(html, /class="related"/, `${page} should link to related pages`);
    assert.doesNotMatch(html, /Read this page when|Download and use|<strong>Read this page when/i, `${page} should not expose internal template phrasing`);
    assert.match(html, /\.\/js\/site-language\.js/, `${page} should keep translation controls`);
    assert.match(html, /\.\/js\/site-tracking\.js/, `${page} should keep analytics tracking`);
    assert.doesNotMatch(html, removedPatterns, `${page} should not contain the removed long-scroll/campaign system`);
    assert.doesNotMatch(html, /\sstyle="/, `${page} should not use inline styles`);
  }
});

test('core page copy is plain, ministry-focused, and non-technical', () => {
  assert.match(read('landing/mission.html'), /carry Scripture, gospel media, and practical ministry resources/i);
  assert.match(read('landing/initiative.html'), /offline library, local Wi-Fi, phone sharing/i);
  assert.match(read('landing/phone-distribution.html'), /Once one phone has a resource/i);
  assert.match(read('landing/raspberry-pi.html'), /A library that fits in your hand/i);
  assert.match(read('landing/raspberry-pi.html'), /village123/);
  assert.match(read('landing/raspberry-pi.html'), /10\.43\.0\.1/);
  assert.match(read('landing/raspberry-pi.html'), /microSD cards/);
  assert.match(read('landing/power.html'), /Power is the first field question/i);
  assert.match(read('landing/projector-media.html'), /Gospel film nights/i);
  assert.match(read('landing/satellite.html'), /receive-and-replay broadcast path/i);
  assert.match(read('landing/satellite.html'), /Free-to-Air Christian/i);
  assert.match(read('landing/satellite.html'), /Repurposed satellite dish retrofitted with a generic LNB/i);
  assert.doesNotMatch(read('landing/satellite.html'), /optional uplink|updates and remote coordination|Remote content updates/i);
  assert.match(read('landing/field-faq.html'), /Satellite broadcasts are handled separately/i);
  assert.match(read('landing/affiliates.html'), /VillageServer Initiative/);
  assert.match(read('landing/affiliates.html'), /Digital Bible Society/);
  assert.match(read('landing/affiliates.html'), /TechSoup/);
  assert.doesNotMatch(read('landing/admin.html'), /Project Bible Runners|project-bible-runners-site|projectbiblerunners/i);
  assert.doesNotMatch(read('supabase/schema.sql'), /Project Bible Runners|projectbiblerunners/i);
});

test('pamphlets page exposes the printable field handouts and files exist', () => {
  const html = read('landing/pamphlets.html');
  assert.match(html, /class="[^"]*\bdownload-list\b[^"]*"/);
  assert.match(html, /download-list download-list-compact/);
  for (const file of allPdfs) {
    assert.match(html, new RegExp(`\\./downloads/${escapeRegExp(file)}`));
    assert.ok(existsSync(join(root, 'landing/downloads', file)), `${file} should be deployed`);
    assert.ok(existsSync(join(root, 'output/pdf', file)), `${file} should be retained in output/pdf`);
  }
  assert.equal([...html.matchAll(/class="download-link"/g)].length, allPdfs.length);
});

test('language controls cover major field languages and every public page can translate', () => {
  const homepage = read('landing/index.html');
  const languageScript = read('landing/js/site-language.js');
  const expectedLanguages = ['en', 'es', 'zh-CN', 'hi', 'ar', 'fr', 'pt', 'ru', 'bn', 'id', 'ur', 'sw', 'vi', 'tl', 'ne', 'sd'];

  for (const language of expectedLanguages) {
    assert.match(homepage, new RegExp(`<option value="${escapeRegExp(language)}">`));
    assert.match(languageScript, new RegExp(`\\['${escapeRegExp(language)}',`));
  }

  for (const page of publicPages) assert.match(read(page), /\.\/js\/site-language\.js/);
  assert.match(languageScript, /localStorage\.setItem\('vsi-language'/);
  assert.match(languageScript, /googtrans/);
  assert.match(languageScript, /window\.location\.reload/);
  assert.match(languageScript, /every later popup/i);
  new Function(languageScript);
  new Function(read('landing/js/i18n.js'));
});

test('every public page records visits for individual people and total visits', () => {
  for (const page of publicPages) assert.match(read(page), /\.\/js\/site-tracking\.js/);

  const tracker = read('landing/js/site-tracking.js');
  assert.match(tracker, /sendTracking\('visit'/);
  assert.match(tracker, /type=' \+ encodeURIComponent\(type\)/);
  assert.match(tracker, /sendTracking\('click'/);
  assert.match(tracker, /sendBeacon/);
  assert.match(tracker, /cache: 'no-store'/);
  assert.match(tracker, /keepalive: true/);
  assert.match(tracker, /vsi-visitor-id/);
  assert.match(tracker, /visitor_id: getVisitorId\(\)/);
  assert.match(tracker, /site_host/);
  assert.match(tracker, /link_url/);
  assert.match(tracker, /link_text/);
  assert.match(tracker, /link_type/);
  assert.match(tracker, /window\.VSITracking/);
  assert.match(tracker, /enrich: function/);
  assert.match(tracker, /data-visit-tracked/);
  new Function(tracker);

  const api = read('api/track.js');
  const schema = read('supabase/schema.sql');
  assert.match(api, /visitor_id/);
  assert.match(api, /site_host/);
  assert.match(api, /detectRobotRequest/);
  assert.match(api, /ROBOT_USER_AGENT_RE/);
  assert.match(api, /ignored: true/);
  assert.match(api, /is_robot: false/);
  assert.match(api, /total_page_visits/);
  assert.match(api, /individual_people/);
  assert.match(api, /visits_today/);
  assert.match(api, /link_clicks/);
  assert.match(api, /total_link_clicks/);
  assert.match(api, /donation_interests\?select=visitor_id,site_host,country/);
  assert.match(api, /availability_requests\?select=visitor_id,site_host,country,region/);
  assert.match(api, /Cache-Control', 'no-store/);
  assert.match(schema, /visitor_id text/);
  assert.match(schema, /site_host text/);
  assert.match(schema, /create table if not exists public\.link_clicks/);
  assert.match(schema, /link_url text not null/);
  assert.match(schema, /link_text text/);
  assert.match(schema, /link_type text not null default 'link'/);
  assert.match(schema, /user_agent text/);
  assert.match(schema, /is_robot boolean not null default false/);
  assert.match(schema, /robot_reason text/);
  assert.match(schema, /page_visits_visitor_id_idx/);
  assert.match(schema, /page_visits_site_host_idx/);
  assert.match(schema, /page_visits_is_robot_idx/);
  assert.match(schema, /link_clicks_visitor_id_idx/);
  assert.match(schema, /link_clicks_is_robot_idx/);
  assert.match(schema, /donation_interests_visitor_id_idx/);
  assert.match(schema, /availability_requests_visitor_id_idx/);
});

test('admin still polls smoothly and separates individual people from total visits', () => {
  const admin = read('landing/admin.html');
  assert.match(admin, /_trafficPoll/);
  assert.match(admin, /setInterval\(function\(\)/);
  assert.match(admin, /}, 4000\)/);
  assert.match(admin, /traffic-countdown-bar/);
  assert.match(admin, /cache:'no-store'/);
  assert.match(admin, /&_ts=' \+ Date\.now\(\)/);
  assert.match(admin, /Individual People/);
  assert.match(admin, /Total Page Visits/);
  assert.match(admin, /Link clicks/);
  assert.match(admin, /Clicked links/);
  assert.match(admin, /people-list/);
  assert.match(admin, /clicks-list/);
  assert.match(admin, /Potentially from/);
  assert.match(admin, /activity: \[/);
  assert.match(admin, /inferLocationFromText/);
  assert.match(admin, /formattedLocation/);
  assert.match(admin, /Kitibus, Kenya/);
  assert.match(admin, /data\.clicks/);
  assert.match(admin, /totals\.total_page_visits/);
  assert.match(admin, /totals\.individual_people/);
  assert.match(admin, /totals\.visits_today/);
  assert.match(admin, /totals\.total_link_clicks/);
  assert.match(admin, /visitor_id/);
  assert.match(admin, /link_url/);
  assert.match(admin, /utm_source/);
  for (const source of inlineScripts(admin)) new Function(source);
});

test('local assets referenced by public pages exist and scripts parse', () => {
  const pagesWithInlineScripts = [...homePages, 'landing/admin.html'];
  for (const page of publicPages) {
    const html = read(page);
    const assetMatches = [...html.matchAll(/(?:src|href)="(\.\/(?:img|css)\/[^"?#]+)(?:\?[^"]*)?"/g)];
    assert.ok(assetMatches.length >= 2, `${page} should reference local image/css assets`);
    assert.doesNotMatch(html, /(?:src|href)="(?:img|css)\//, `${page} should use portable ./ asset URLs`);

    for (const [, assetPath] of assetMatches) {
      const diskPath = join(root, dirname(page), assetPath);
      assert.ok(existsSync(diskPath), `${page} references missing asset ${assetPath}`);
    }
  }

  for (const page of pagesWithInlineScripts) {
    for (const source of inlineScripts(read(page))) new Function(source);
  }
});

test('old campaign page redirects back into the new directory instead of staying public', () => {
  const html = read('landing/spring-uganda-run.html');
  assert.match(html, /http-equiv="refresh"/);
  assert.match(html, /content="0;\s*url=\.\/index\.html"/);
  assert.match(html, /This campaign page has moved/);
  assert.doesNotMatch(html, /Give a Bible|donate\.html|Fund the mission|Spring Uganda/i);
});
