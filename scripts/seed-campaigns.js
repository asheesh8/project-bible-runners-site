#!/usr/bin/env node
/**
 * Seed 2 sample campaigns into Supabase.
 *
 * Usage (run from the project root):
 *   SUPABASE_URL=https://xxxx.supabase.co \
 *   SUPABASE_SERVICE_KEY=eyJhbGci... \
 *   node scripts/seed-campaigns.js
 *
 * Or set the vars in a local .env and use:
 *   node -r dotenv/config scripts/seed-campaigns.js
 *
 * Both campaigns are created as drafts (active: false).
 * To make one live, open the admin panel → Applications & Campaigns →
 * find the campaign in "All campaigns" → Edit → check "Mark as active campaign".
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌  Set SUPABASE_URL and SUPABASE_SERVICE_KEY before running.');
  process.exit(1);
}

const headers = {
  'Content-Type': 'application/json',
  apikey: SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  Prefer: 'return=representation',
};

const campaigns = [
  {
    name: 'Spring Uganda Run 2026',
    slug: 'spring-uganda-2026',
    description: 'Run with us to place 500 Bibles and offline Scripture libraries across northern Uganda this spring.',
    story: `Every year, a team of runners laces up their shoes and covers miles so that communities across northern Uganda can access Scripture in their own language.

This year's campaign targets 500 Bibles and 20 VillageServer kits — each kit capable of serving an entire village with offline audio Scripture, gospel films, and children's resources without any internet connection.

The funds raised here cover the Bibles, the Raspberry Pi kits, solar panels, the content library pre-loaded onto each device, and the training required to hand them off to local leaders who will keep the system running long after the team comes home.

Every dollar goes directly to materials and training. No platform fees. 100% to the field.`,
    goal_amount: 18000,
    raised_amount: 0,
    bibles_funded: 0,
    bibles_needed: 500,
    end_date: '2026-05-31',
    zeffy_url: null,
    image_url: null,
    active: false,
  },
  {
    name: 'East Africa Scripture Drive',
    slug: 'east-africa-scripture-drive',
    description: 'Direct Scripture placement — Bibles and audio devices — across three countries in East Africa.',
    story: `This campaign funds a coordinated Scripture distribution across Kenya, Uganda, and Tanzania — reaching rural and semi-urban communities where Bible access is limited by language, literacy, and geography.

Each Bible placed is paired, where possible, with a phone pre-loaded with the YouVersion Bible app, the Jesus Film in a local language, and a children's audio Bible. In communities without reliable phone infrastructure, a VillageServer kit is left behind to serve the whole neighborhood from one device.

Local partner organizations handle the final mile — identifying households, delivering materials, and training community leaders. VillageServer provides the technology and content; the local body provides the relationships.`,
    goal_amount: 12000,
    raised_amount: 0,
    bibles_funded: 0,
    bibles_needed: 320,
    end_date: '2026-09-30',
    zeffy_url: null,
    image_url: null,
    active: false,
  },
];

async function seed() {
  for (const campaign of campaigns) {
    // Check if slug already exists
    const checkUrl = `${SUPABASE_URL}/rest/v1/campaigns?slug=eq.${campaign.slug}&select=id`;
    const checkRes = await fetch(checkUrl, { headers });
    const existing = await checkRes.json();

    if (Array.isArray(existing) && existing.length > 0) {
      console.log(`⏭  Skipping "${campaign.name}" — slug already exists.`);
      continue;
    }

    const res = await fetch(`${SUPABASE_URL}/rest/v1/campaigns`, {
      method: 'POST',
      headers,
      body: JSON.stringify(campaign),
    });

    if (res.ok) {
      const [row] = await res.json();
      console.log(`✅  Created: "${campaign.name}" (id: ${row?.id ?? 'unknown'})`);
    } else {
      const err = await res.text();
      console.error(`❌  Failed to create "${campaign.name}": ${err}`);
    }
  }

  console.log('\nDone. Open the admin panel → Applications & Campaigns to manage these campaigns.');
  console.log('Set a Zeffy URL and image URL for each campaign before marking it active.');
}

seed().catch(console.error);
