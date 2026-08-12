# Welcome to LiveOakv3!

This guide will help you get started. It is written in plain, simple language so anyone can follow it — even if you are new to coding.

---

## 1. What Is This App?

LiveOakv3 helps a company track work that field workers do. Think of it like a digital paper form, but smarter.

- A field worker finishes a job (like installing something at an address).
- They open the app on their phone and fill out a short form: the address, how much work they did, and some photos.
- That form gets saved. Office staff then check it, fix mistakes, and use it to pay the field worker correctly.

There is a **phone app** (for field workers) and a **web app** (for office staff).

---

## 2. Who Uses the App?

The app has three kinds of users. One person can have more than one role.

| Role | What They Do |
|---|---|
| **Technician** | Goes out into the field and submits a **Job Record** using the phone app. Once they submit it, they cannot change it. They can only look at their own past submissions. |
| **Payroll Administrator** | Checks Job Records for mistakes (wrong address, wrong footage, etc.) and fixes them before payday. |
| **Application Administrator** | Manages who is allowed to use the app and what role they have. Can edit any Job Record, even ones a Payroll Administrator already touched. |

---

## 3. Words You Will See a Lot

The project uses specific words on purpose, so everyone means the same thing. Try to use these same words when you talk about the app.

- **Job Record** — One finished piece of field work. It has an address, a work code, footage, photos, and notes. (Don't call it a "job" or a "ticket.")
- **Job ID** — A note the Technician types in by hand, referring to an outside system. It doesn't have to be unique.
- **Record ID** — The real, unique ID the app creates for each Job Record. This is the one used to look things up.
- **Footage** — A whole number, measured in feet, that the Technician enters.
- **Discrepancy** — A flag that means "something looks wrong with this record." An admin sets it, along with a reason. It gets cleared once fixed.
- **Closed** — A flag that means payroll is done processing this record. A record can't be Closed while it still has an open Discrepancy.
- **Duplicate** — Two Job Records that look like the same job (same address, submitted within 6 months of each other). The app flags these automatically. One is marked as the "primary" (the one that gets paid); admins can change which one that is.

For the full list, see [`CONTEXT.md`](./CONTEXT.md) in the root of the project.

Here's what happens to a Job Record after it's submitted:

```mermaid
stateDiagram-v2
    [*] --> Submitted: Technician submits from the phone app

    Submitted --> Discrepancy: Payroll/Admin flags an issue
    Discrepancy --> Submitted: Payroll/Admin clears the flag

    Submitted --> Closed: Payroll/Admin closes it
    Closed --> [*]

    note right of Closed
        Can't Close a record while
        Discrepancy is active. Once Closed,
        a Payroll Administrator can't edit
        it anymore — an Application
        Administrator still can.
    end note
```

A Technician can only ever see this happen from the outside — once they submit, the record belongs to Payroll and Application Administrators. (Separately, a **Duplicate** flag can attach to a record at any point along this path — it's detected automatically, not part of this status flow.)

---

## 4. How the Code Is Organized

This project is a **monorepo** — that means several related pieces of software live together in one place. Here's a map:

```
LiveOakv3/
├── apps/
│   ├── web/        ← The website office staff use (built with React)
│   └── mobile/     ← The phone app field workers use (built with Expo/React Native)
├── packages/
│   └── shared/     ← Code and rules shared by everything above (e.g. what a "role" is)
├── functions/      ← The backend — runs in the cloud, handles data and nightly jobs
├── docs/
│   ├── adr/        ← Short write-ups explaining big decisions and why we made them
│   └── agents/     ← Notes for AI coding assistants working in this repo
├── CONTEXT.md      ← The glossary of words this project uses (see section 3)
└── firebase.json   ← Settings for Firebase, the cloud service this app runs on
```

**A simple way to think about it:** the phone app and website are the two "front doors." The `functions` folder is the "back office" that both front doors talk to. The `shared` package is a toolbox both front doors and the back office use, so they don't repeat themselves.

```mermaid
flowchart TD
    Mobile["apps/mobile\nPhone app — Technician"]
    Web["apps/web\nWebsite — Payroll & Application Administrator"]
    Shared["packages/shared\nShared types & rules"]
    Functions["functions\nBackend (Cloud Functions)"]
    Auth["Firebase Auth\nsign-in"]
    DB["Firestore\ndatabase"]
    Nightly["Nightly scheduled jobs\nstate export + discrepancy email"]

    Mobile -- "submit Job Records" --> Functions
    Web -- "review / edit Job Records" --> Functions
    Functions --> Auth
    Functions --> DB
    Functions --> Nightly

    Shared -. used by .-> Mobile
    Shared -. used by .-> Web
    Shared -. used by .-> Functions
```

The phone app and website never talk to the database directly — everything goes through `functions`, which checks who you are and what role you have before touching any data.

---

## 5. What This App Is Built On

You don't need to be an expert in these to get started, but here's what's involved:

- **TypeScript** — the programming language used everywhere in this project. It's JavaScript with extra safety checks.
- **React** — powers the web app.
- **Expo / React Native** — powers the phone app.
- **Firebase** — the cloud platform this app runs on. It handles:
  - **Auth** — signing people in with a company Google account
  - **Firestore** — the database that stores Job Records and users
  - **Cloud Functions** — backend code, plus jobs that run automatically every night
- **Vite** — the tool that runs and builds the web app.
- **Vitest** — the tool that runs automated tests.

If you want to know *why* we picked these tools, read the short files in `docs/adr/`. Each one explains a decision in a few sentences.

---

## 6. Setting Up Your Computer

### What you need first

1. **Node.js, version 20** — this is the engine that runs JavaScript/TypeScript outside a browser. Download it from [nodejs.org](https://nodejs.org) if you don't have it.
2. **Git** — to download (clone) the project and save your changes.
3. **Java** — only needed if you want to run the app fully offline using Firebase's emulator (a fake, local version of the cloud). Most people will want this.
4. **The Expo Go app** on your phone, or a phone simulator on your computer — only needed if you want to test the mobile app.

### Steps

1. Download the project:
   ```bash
   git clone https://github.com/fluffygeek/LiveOakv3.git
   cd LiveOakv3
   ```
2. Install all the code packages the project depends on:
   ```bash
   npm install
   ```
   This one command installs everything for the web app, the mobile app, the backend, and the shared package all at once — that's what "workspaces" means in `package.json`.

---

## 7. Running the App on Your Computer

To try out the full app without touching any real, live data, use Firebase's **emulator** — a safe, local stand-in for the real cloud.

Open a few terminal windows and run these, in order:

```bash
# Terminal 1: build the shared toolbox and the backend
npm run build --workspace=packages/shared
npm run build --workspace=functions

# Terminal 2: start the fake local cloud (auth, database, backend functions)
npx firebase-tools emulators:start --only auth,firestore,functions

# Terminal 3: start the website
npm run dev --workspace=apps/web
```

Then open **http://localhost:5173** in your browser to see the web app.

To run the phone app instead:
```bash
npm run start --workspace=apps/mobile
```
Then scan the QR code with the Expo Go app on your phone.

**Good to know:** the very first time, no one is an "Application Administrator" yet, so no one can invite anyone else. The full steps to create that first admin account by hand are in [`docs/deploy-demo.md`](./docs/deploy-demo.md) — look for "Bootstrapping the first admin."

---

## 8. Running Tests and Checks

Before you consider your work finished, run these from the project root:

```bash
npm run typecheck   # checks that your code's types make sense
npm run test        # runs all the automated tests
npm run build        # makes sure everything actually compiles
```

Each of these runs across every part of the project at once (web, mobile, backend, shared).

---

## 9. Things That Are Not Finished Yet

This project is still being built. A few pieces are stubbed out on purpose — they don't crash, they just don't do the real thing yet:

- **Photos aren't uploaded anywhere.** They stay on the phone that took them. Office staff can't view them yet.
- **Address checking always says "not verified."** The real address-checking service isn't hooked up yet.
- **The nightly "something's wrong" email doesn't actually send.** The code that would send it runs, but nothing goes out.

Knowing this will save you time — if you see one of these while testing, it's expected, not a bug.

---

## 10. How Work Gets Tracked

- Work items live in **GitHub Issues** on this repo (`fluffygeek/LiveOakv3`).
- Issues get labeled to show their status, for example: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`.
- More detail is in [`docs/agents/issue-tracker.md`](./docs/agents/issue-tracker.md) and [`docs/agents/triage-labels.md`](./docs/agents/triage-labels.md).

---

## 11. Where to Look Next

| I want to... | Look here |
|---|---|
| Understand a word used in the app | [`CONTEXT.md`](./CONTEXT.md) |
| Understand *why* a big decision was made | [`docs/adr/`](./docs/adr/) |
| Run a full demo, including on a real (not fake) server | [`docs/deploy-demo.md`](./docs/deploy-demo.md) |
| See how work items are tracked | [`docs/agents/issue-tracker.md`](./docs/agents/issue-tracker.md) |
| See the phone app's code | [`apps/mobile/src/`](./apps/mobile/src/) |
| See the website's code | [`apps/web/src/`](./apps/web/src/) |
| See the backend code | [`functions/src/`](./functions/src/) |
| See code shared everywhere | [`packages/shared/src/`](./packages/shared/src/) |

Welcome aboard — if something in this guide is confusing or out of date, that's worth fixing. Open an issue or update this file.
