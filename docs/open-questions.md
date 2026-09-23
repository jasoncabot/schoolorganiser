# Open questions

Put these to the owner before building the parts they affect. Move each one to `decisions.md` once it's answered.

1. **Senders with no DMARC result:** in the first live test, Cloudflare reported `spf=pass`, `dkim=pass`, `dmarc=none`, so the mail was dropped. This happens when the From domain publishes no DMARC policy. Should we also accept mail where SPF or DKIM passes _and aligns_ with the From domain, even with no DMARC record? That's what DMARC would check anyway. Otherwise parents whose email provider has no DMARC record can't use the service.
