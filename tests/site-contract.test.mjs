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
}
