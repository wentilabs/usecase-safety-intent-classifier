# Safety intent classifier

> **With the message just sent, the two text messages before it, and whatever it is
> replying to, a model can tell exactly what the sender intends — without hard rules.**

That sentence is the whole repo. Everything here exists to give a model that slice of
conversation, well described, and to measure how accurately it reads it.

## What goes in

    {
      "domains": ["safety"],
      "message": { … the message just sent … },
      "recent":  [ { … }, { … } ],      // the two previous messages that have text, oldest first
      "quoted":  { … },                 // the message it replies to, if any
      "facts":   { … }                  // optional: what the caller happens to know
    }

The two previous text bodies are the point. They carry what a person scrolling up would
see — a photo's description sent a moment after it, a "same" that only makes sense
after the line above, the question an answer is answering. The model reads them; no
rule has to anticipate them.

`facts` are optional and never required: "the quoted message is recorded issue #12,
open", "the deleted message closed issue #7". Anything not supplied is unknown, and the
model decides from the conversation.

## What comes out

    { "intent": "safety.closure", "reason": "…", "confidence": 92 }

One intent from the requested domains, or `other`.

It is deliberately narrow. It does not fetch anything, write anything, or reply to
anyone. What comes before it (gathering context) and after it (acting on the intent)
belongs to the caller.

## Composable

Safety is one **domain**. Each domain publishes a spec — its intents, instructions,
worked examples and the facts it understands — and a caller combines the domains it
needs:

    GET /spec?domains=safety            → safety's intents + one `other`
    GET /spec?domains=safety,manpower   → both, + one `other`   (when manpower exists)

`other` is added once by the composition: "none of the requested domains applies".

With several domains, `POST /classify` judges in two steps: each domain alone first
(its own intents and `other`), then only the domains that did not say `other`, together.
None left gives `other`; one left, its answer stands. Each first answer is returned in `perDomain`.

## Safety intents

| intent | meaning |
|---|---|
| `new_issue` | a new issue, complete: description, photo, someone named to act |
| `new_issue_missing_pic` | complete except nobody is named as responsible |
| `new_issue_missing_photo` | clearly a report, but no photo |
| `new_issue_missing_severity` | the project requires P1–P3 and none was stated |
| `closure` | a recorded open issue reported fixed, with photo and words |
| `closure_missing_photo` | claims fixed, no after-photo |
| `closure_missing_description` | after-photo, no words |
| `late_after_photo` | after-photo for an already-closed issue |
| `recurrence` | "same" — a recorded issue has happened again |
| `pic_answer` | answers the desk's "who is responsible?" |
| `edited_new_issue` / `edited_closure` | edits a message that created / closed an issue |
| `deleted_new_issue` / `deleted_closure` / `deleted_after_photo` / `deleted_pic_answer` | deletes a message that did that — so the caller knows what to undo |

Full definitions: `domains/safety/spec.js`, or `GET /domains/safety`.

## Configuration

Three environment variables, nothing else:

| variable | used for |
|---|---|
| `OPENAI_API_KEY` | the one model call |
| `SUPABASE_URL` | reading the chat archive (`whatsapp_listener`) and the main photo |
| `SUPABASE_SECRET_KEY` | the same, read-only |

Which listener's copy counts as "ours" comes from the payload's own `clientIdentifier`.
The model is `gpt-6-luna` unless the request names another (`model`).

## Run

    npm test
    npm start          # http://127.0.0.1:4400
