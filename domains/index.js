"use strict";

/**
 * domains/index.js — every intent domain this service can serve.
 *
 * Today: safety. A new domain (manpower, QA report …) is a folder with a spec.js
 * exporting the same shape, added to this list. Domains are independent: none may
 * reference another's intents.
 */

const { SAFETY_DOMAIN } = require("./safety/spec");

const DOMAINS = Object.freeze({ [SAFETY_DOMAIN.domain]: SAFETY_DOMAIN });

module.exports = { DOMAINS };
