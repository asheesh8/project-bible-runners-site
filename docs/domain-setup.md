# VillageServer domain launch checklist

Primary public URL: **https://villageserver.org**  
Second public URL: **https://villageserver.com** (same deployment and Supabase stream)

- [ ] Confirm both domain registrations and the account owner.
- [ ] Add `villageserver.org` and `www.villageserver.org` to the production project in Vercel.
- [ ] Add `villageserver.com` and `www.villageserver.com` to the same project.
- [ ] Apply the DNS records Vercel shows for the registrar in use.
- [ ] Keep `villageserver.org` as the canonical URL used in page metadata.
- [ ] Serve the same production deployment on `.com` and `.org`; do not redirect `.com` before the page tracker runs if domain-level visit attribution is required.
- [ ] Redirect only each `www` hostname to its matching root hostname.
- [ ] Wait for DNS and TLS verification, then test all four hosts on desktop and mobile.
- [ ] Update email, social profiles, analytics, search-console properties, and print materials.

The repository uses `villageserver.org` for canonical page URLs while both public hosts feed one combined Supabase analytics stream. Domain registration, DNS, and Vercel project access are external account actions and remain unchecked until completed by an authorized owner.
