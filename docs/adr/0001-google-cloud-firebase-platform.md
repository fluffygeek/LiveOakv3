---
status: accepted
---

# Google Cloud / Firebase as the platform

LiveOakv3 requires sign-in restricted to a Google Workspace domain, which Firebase Auth supports natively. We chose Google Cloud/Firebase (Firebase Auth, Cloud Storage for photos, Cloud Functions for nightly jobs) over AWS or Azure specifically because the auth requirement pairs directly with the platform, rather than needing a separate Workspace-to-provider identity bridge. This is a full-stack commitment — swapping cloud providers later would mean re-implementing auth, storage, and the scheduled jobs.
