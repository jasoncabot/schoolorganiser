# Open questions

Put these to the owner before building the parts they affect.

1. **Auto-forwarding rules:** do we support mail-client filters (e.g. Gmail auto-forward) as well as manual forwards? Auto-forwarding keeps the school as the `From` header, and Gmail sends a confirmation code to the destination address that we would need to pass back to the parent.
2. **Address lookup:** is a Durable Object per email address acceptable, or would you prefer D1 or KV for the email → household index?
3. **Stopping digests:** how does a parent stop the digest or unsubscribe (a link in every email, the web page, or both)?
4. **Privacy notice:** the service holds children's names and school mail, so it needs a UK GDPR privacy notice and a lawful basis. Who writes it, and where does it live?
5. **Digest format:** exact layout, maximum length, and whether an empty week still sends a "nothing on" email.
6. **Extraction model:** which Workers AI model? Decide once we've tested it on real letters.
7. **Replies:** what happens when a parent replies to a digest? Ignore it, or treat it as a new forward?
