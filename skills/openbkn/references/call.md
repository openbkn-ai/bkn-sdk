# call — raw API passthrough (alias `curl`)

```bash
openbkn call <path-or-url> [-X <method>] [-H "Name: value"] [-d '<body>'] [-F field=@file] [-v]
```

Auth headers + `x-business-domain` are injected automatically; JSON bodies are pretty-printed (other content passed through). Exit 1 on HTTP ≥ 400. `openbkn admin call <url> …` is the operator-scoped equivalent.
