---
apply: auto
locked: false
source: claude@ubuntu-01 on AW-7
---
# Reset the test database before the invoice tests

Run `make db-reset` before `npm test -- invoice`. Old rows make the totals wrong.
