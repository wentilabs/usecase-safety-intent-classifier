# Safety intent classifier

Safety-intent classification as a service. Give it a site group-chat message — plus
whatever related messages and context you have — and it returns **one intent**: what
the sender means, in safety terms.

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

## Run

    npm test
    npm start          # http://127.0.0.1:4400
