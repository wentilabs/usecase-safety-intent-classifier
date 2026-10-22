# Rules for this repo

**The one intention, which every change must serve:**

> With the message just sent, the two text messages before it, and whatever it is
> replying to, a model can tell exactly what the sender intends — without hard rules.

If a change adds a rule a model could have learned from an example, it is the wrong change.


1. **Classification only.** No writes, no replies, no actions. The only read is the chat archive
   (`whatsapp_listener`) to fill in context the caller did not send — the two earlier text
   messages, the quoted message, an edit's or deletion's original. What the caller sends wins.
2. **Specs are data.** `domains/<name>/spec.js` must stay plain JSON — it is served as-is.
3. **Fix readings with examples, not rules.** Add a worked example to the domain spec;
   do not add special-case code. A rule must stay consistent with every other rule; an
   example only has to be true.
4. **The only hard check is consistency with supplied facts.** lib/validate.js refuses an intent
   that contradicts a fact the caller supplied (a deletion intent on a message that was not
   deleted). It never judges meaning, and an unsupplied fact never refutes anything.
5. **No dependencies.** Node built-ins only (the model call uses `fetch`).
6. **Answers in the evaluation set are human labels.** Never derive or overwrite them from code.
7. One change per commit, tests between, the reason in the message.
