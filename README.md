# VillageServer Initiative

An informational field guide for a portable, offline digital library that brings Bible tools, gospel media, training resources, and practical connectivity to communities where internet and electricity are limited.

## Site experience

- Guides visitors through the initiative, honest kit availability, component setup, and the system flow.
- Moves initiative/rollout and access/share material onto focused resource pages.
- Walks through Wi-Fi, Android microSD, iPhone/iPad card reader, and computer/USB access.
- Uses an interactive component widget that opens focused setup guides.
- Localizes the complete homepage and live widgets into English, French, Swahili, Spanish, Hindi, Nepali, and Bengali.
- Opens focused component guides for Wi-Fi, Raspberry Pi, microSD, USB, solar, projection, phone charging, and satellite setup.
- Covers the satellite workflow, language library, pilots, and four-phase rollout.
- Keeps financial support secondary and transparent while the giving path is established.

## Run locally

```bash
cd landing
python3 -m http.server 5577
```

Open `http://localhost:5577/index.html`.

## Verify

```bash
node --test tests/site-contract.test.mjs
```

The site is dependency-free static HTML, CSS, and JavaScript. Vercel publishes the `landing/` directory.
