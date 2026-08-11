---
status: accepted
---

# Address verification via a third-party vendor, not the raw USPS API

Job Record addresses must be verified against USPS records (except self-declared new builds). Rather than integrating directly against USPS's own APIs (legacy Web Tools or the newer OAuth-based API), we chose a third-party address-verification vendor (e.g. Smarty, Lob, or Melissa) that verifies against USPS data under the hood. This trades direct control and USPS's free tier for a simpler integration surface and more forgiving API ergonomics. Revisiting this means re-integrating the verification call site and re-normalizing the response shape, which the normalized-address duplicate check also depends on.
