# VillageServer domain launch checklist

Primary public URL: **https://villageserver.org**  
Redirect URL: **https://villageserver.com** → **https://villageserver.org**

- [ ] Confirm both domain registrations and the account owner.
- [ ] Add `villageserver.org` and `www.villageserver.org` to the production project in Vercel.
- [ ] Add `villageserver.com` and `www.villageserver.com` to the same project.
- [ ] Apply the DNS records Vercel shows for the registrar in use.
- [ ] Set `villageserver.org` as the primary production domain.
- [ ] Configure permanent redirects from `.com` and both `www` hosts to the matching `.org` path.
- [ ] Wait for DNS and TLS verification, then test all four hosts on desktop and mobile.
- [ ] Update email, social profiles, analytics, search-console properties, and print materials.

The repository now uses `villageserver.org` for canonical page URLs. Domain registration, DNS, and Vercel project access are external account actions and remain unchecked until completed by an authorized owner.
