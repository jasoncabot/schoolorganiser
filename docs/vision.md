# Vision (v1)

## For whom

The owner first (two children at two schools), then other UK school parents.

## Experience

1. **Onboarding is one step:** forward a school email to `hello@school.jasoncabot.com`. v1 supports manual forwards; automatic forwarding rules come next.
2. If the forward is genuine (it passes SPF/DKIM/DMARC) and the address is new, we reply with a verification link. Mail sent before verification is held for 7 days.
3. Once verified, every forwarded email and its attachments is read and the useful facts are extracted.
4. **Every Sunday evening (UK time)** the household gets one short email, readable in about 30 seconds:
   - the week ahead, grouped by day, with the child's name on each line (dates, costs, locations, early starts and kit)
   - a short "Coming up" section for deadlines and payments in the next ~3 weeks
   - a single line, "Nothing on this week.", if there's nothing
   - a one-click stop link
5. A **minimal web page** (magic-link sign-in) lets a parent:
   - add their children and which school each attends
   - add another parent's email to the household
   - see upcoming items
   - pause or restart the digest
   - delete their data

We send from a no-reply address, and replies are ignored.

## Households

A household can have several verified email addresses. Mail forwarded by any member feeds one shared digest, and the digest goes to every member.

## Not in v1

Anything not listed above. New ideas go in `open-questions.md` for discussion first.
