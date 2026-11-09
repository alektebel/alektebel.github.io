---
title: How to reconcile transparency with Article 17 of the GDPR
date: 2026-11-09
tags: GDPR, SOC 2, compliance, privacy
excerpt: Retention laws force banks to keep the records behind their decisions; Article 17 gives clients the right to erasure. Envelope encryption and crypto-shredding reconcile the two.
---

Several laws require a bank to retain the data used to make decisions. Examples of these laws are:

* Spanish Law 10/2010 (anti-money laundering), art. 25 — keep documentation for 10 years
* GDPR Article 5.2 — accountability: being able to demonstrate that you comply
* EU AI Act, art. 12 — automatic logging in high-risk systems (e.g. ones using LLMs)
* SOC 2 Type II — requires showing that the controls worked over the period

This clashes somewhat with Article 17 of the GDPR, which guarantees our clients the right to erasure. This right lets a client demand that all their data be deleted from our files, with up to one month for the deletion to take place. How can we guarantee this transparency and at the same time be able to delete that data at any moment? We need some way to "join" all this data into a data structure that makes it robust to traverse everything associated with one specific person.

There is another layer of complexity: suppose we are a consultancy A providing services to company B. If we work with the clients of company B, erasure requests have to take effect recursively — the data must be deleted both on the client side and in our files. For this, AWS gives us the "envelope encryption" abstraction. We keep the necessary files encrypted, and when we need to read them we decrypt them on the spot with the key, never storing them in plaintext. We use the client's encryption to encrypt our own per-user/per-account-holder keys.

For example, what happens if María wants her data deleted from entity B? Entity B sends us an erasure request through an agreed channel, which we process recursively over the documents we hold. First we delete the corresponding user's key via crypto-shredding: the key we used to encrypt all her files is deleted for good. With that, we have already removed read access to the data: the ciphertext that remains is inert — effectively erased, yet still kept for the retention periods the law demands.
