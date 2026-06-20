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
  assert.match(css, /--journey-height:/);
});

for (const page of pages) {
  test(`${page} uses a semantic, high-priority hero image`, () => {
    const html = read(page);
    assert.match(html, /<img[^>]+class="hero-media"[^>]+src="\.\/img\/hero-field\.webp"/s);
    assert.match(html, /<img[^>]+class="hero-media"[^>]+fetchpriority="high"/s);
    assert.match(html, /<img[^>]+class="hero-media"[^>]+width="1300"[^>]+height="1733"/s);
    assert.doesNotMatch(html, /new Image\(\)/);
  });

  test(`${page} uses portable local asset URLs and every asset exists`, () => {
    const html = read(page);
    const assetMatches = [...html.matchAll(/(?:src|href)="(\.\/(?:img|css)\/[^"?#]+)"/g)];
    assert.ok(assetMatches.length >= 10, 'expected local image and stylesheet references');
    assert.doesNotMatch(html, /(?:src|href)="(?:img|css)\//);

    for (const [, assetPath] of assetMatches) {
      const diskPath = join(root, dirname(page), assetPath);
      assert.ok(existsSync(diskPath), `${page} references missing asset ${assetPath}`);
    }
  });

  test(`${page} includes the accessible SVG caravan progress strip`, () => {
    const html = read(page);
    assert.match(html, /id="journeyProgress"[^>]+role="progressbar"[^>]+aria-valuemin="0"[^>]+aria-valuemax="100"[^>]+aria-valuenow="0"/s);
    assert.match(html, /class="journey-dunes"/);
    assert.match(html, /class="caravan"/);
    assert.match(html, /function updateJourneyProgress\(\)/);
    assert.match(html, /style\.setProperty\('--journey-progress'/);
    assert.match(html, /setAttribute\('aria-valuenow'/);
    assert.match(html, /requestAnimationFrame\(updateJourneyProgress\)/);
  });

  test(`${page} keeps presentation in stylesheets instead of inline rules`, () => {
    const html = read(page);
    assert.doesNotMatch(html, /\sstyle="/);
  });

  test(`${page} contains valid inline JavaScript`, () => {
    const html = read(page);
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    assert.ok(scripts.length > 0, 'expected an inline behavior script');
    for (const [, source] of scripts) new Function(source);
  });
}

test('both page variants keep identical journey markup', () => {
  const snippets = pages.map((page) => {
    const html = read(page);
    const match = html.match(/<!-- JOURNEY PROGRESS -->([\s\S]+?)<!-- HERO -->/);
    assert.ok(match, `${page} is missing the journey progress block`);
    return match[1].trim();
  });

  assert.equal(snippets[0], snippets[1]);
});
