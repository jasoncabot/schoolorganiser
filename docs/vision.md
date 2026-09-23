# Vision (v1)

## For whom

The owner first (two children at two schools), then other UK school parents.

## Experience

1. **Onboarding is one step:** forward a school email to `hello@school.jasoncabot.com`.
2. If the forward is genuine (it passes SPF/DKIM/DMARC) and the address is new, we reply with a verification link. Mail sent before verification is held for 7 days.
3. Once verified, every forwarded email and its attachments is read and the useful facts are extracted.
4. **Every Sunday evening (UK time)** the household gets one short email covering the week ahead: dates, costs, locations, early starts and kit.
5. A **minimal web page** (magic-link sign-in) lets a parent:
   - add their children and which school each attends
   - add another parent's email to the household
   - see upcoming items
   - delete their data

## Households

A household can have several verified email addresses. Mail forwarded by any member feeds one shared digest, and the digest goes to every member.

## Not in v1

Anything not listed above. New ideas go in `open-questions.md` for discussion first.
