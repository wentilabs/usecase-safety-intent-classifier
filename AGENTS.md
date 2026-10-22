# Rules for this repo

1. **Classification only.** No fetching, no writes, no replies. Context comes in the request.
2. **Specs are data.** `domains/<name>/spec.js` must stay plain JSON — it is served as-is.
3. **Fix readings with examples, not rules.** Add a worked example to the domain spec;
   do not add special-case code. A rule must stay consistent with every other rule; an
   example only has to be true.
4. **Unknown facts never refute.** The validator only holds the model to what it was told.
5. **No dependencies.** Node built-ins only (the model call uses `fetch`).
6. **Answers in the evaluation set are human labels.** Never derive or overwrite them from code.
7. One change per commit, tests between, the reason in the message.
