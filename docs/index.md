---
title: Home
permalink: /
---

<div class="hero">
  <div class="hero-eyebrow">
    <span class="stripe-dot" aria-hidden="true"></span>
    The Zebra Collective: Decoding complex health, together.
  </div>
  <h1>The Complex Patient</h1>
  <p class="lead">
    An offline-first, zero-knowledge health platform for people living with rare,
    overlapping, and hard-to-pin-down conditions. Your data stays encrypted on your
    device — the server never sees plaintext.
  </p>
  <div class="hero-actions">
    <a class="button button-primary" href="{{ '/architecture/' | relative_url }}">Read the architecture</a>
    <a class="button button-secondary" href="https://thecomplexpatient.com/secure">Open the web app</a>
    <a class="button button-secondary" href="https://github.com/Digital-Defiance/the-complex-patient">View on GitHub</a>
  </div>
</div>

<span class="section-label">Why zebras</span>

## Built for patients who don't fit the textbook

In medicine, trainees are taught: *when you hear hoofbeats, think horses, not zebras.* But for millions of people with rare, multisystem, or misdiagnosed conditions, **they are the zebra** — complex, unique, and poorly served by one-size-fits-all tools.

The Complex Patient is privacy-first infrastructure for that reality: track medications, symptoms, conditions, flares, and how they connect — with end-to-end encryption and offline access, so your story stays yours.

<div class="callout">
  <p><strong>Zero-knowledge by design.</strong> Plaintext health data never leaves your device. The server stores only opaque encrypted blobs — even a full breach cannot reveal your PHI, passphrase, or keys.</p>
</div>

**Production:** [Web app](https://thecomplexpatient.com/secure) · [WordPress site](https://thecomplexpatient.com/) · [Architecture docs](https://source.thecomplexpatient.com/architecture/)

## Start here

<div class="card-grid">
  <div class="card">
    <h3><a href="{{ '/architecture/' | relative_url }}">Architecture</a></h3>
    <p>How encryption, local storage, sync, and the blind WordPress backend fit together.</p>
  </div>
  <div class="card">
    <h3><a href="https://thecomplexpatient.com/secure">Web app</a></h3>
    <p>The encrypted client at <code>/secure</code> on thecomplexpatient.com.</p>
  </div>
  <div class="card">
    <h3><a href="https://github.com/Digital-Defiance/the-complex-patient/blob/main/dev.md">Developer setup</a></h3>
    <p>Run the WordPress sync plugin locally and connect the Expo client.</p>
  </div>
  <div class="card">
    <h3><a href="https://github.com/Digital-Defiance/the-complex-patient/tree/main/expo">Expo monorepo</a></h3>
    <p>Apps, shared packages, crypto engine, sync worker, and UI.</p>
  </div>
</div>

## Core guarantee

Plaintext health data never leaves your device. Two separate credentials protect different things:

| Credential | Purpose |
|------------|---------|
| **WordPress login** | Authenticates sync to the backend |
| **Master passphrase** | Encrypts and decrypts your vault — never sent to the server |

Signing in does not unlock your vault. Unlock requires your passphrase (or biometrics on native devices).
